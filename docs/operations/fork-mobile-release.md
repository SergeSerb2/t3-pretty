# T3 Pretty mobile release train

The iOS app auto-updates through the same two mechanisms as the desktop apps:
merge-driven releases from CI, and upstream ingestion every four hours with
local build delivery.

## Upstream ingestion (shared with desktop)

`.github/workflows/fork-upstream-sync.yml` runs every four hours at 00:00,
04:00, 08:00, 12:00, 16:00, and 20:00 UTC, merges the newest upstream nightly
tag (AI-resolving conflicts via `scripts/fork/resolve-git-conflicts.mjs`), and
lands it on `main` through an auto-merged PR. Mobile code rides along — there is
no separate mobile sync.

## Merge-driven releases

`.github/workflows/fork-mobile-release.yml` triggers on every push to `main`
that touches mobile-relevant paths. A release publishes an OTA update on the
production channel for both platforms, then compiles a production iOS IPA on
the self-hosted Mac runner (`m1-dev-t3code-fork`, same labels as desktop) and
submits it to TestFlight when the native runtime fingerprint changed.

JavaScript-only changes therefore ship as an OTA without occupying Xcode or
touching Expo's cloud iOS quota. Native runtime changes still receive a new
binary instead of publishing an OTA that no installed app can consume.

Local `eas build --local` IPAs do not create hosted EAS Build records, so
`eas build:list` alone cannot gate later releases. After a successful
TestFlight submit the workflow commits the fingerprint to
`.t3-fork/ios-production-fingerprint` (a durable store `GITHUB_TOKEN` can
update; repository Variables are not writable via workflow `permissions`),
and the next release treats that value as a known production binary alongside
any hosted EAS result.

iOS store binaries cannot be compiled on the Windows runner. Registering a
second Mac (for example the M5) with the same `self-hosted`, `macOS`,
`ARM64`, `t3code-fork`, `release-only` labels lets GitHub run a desktop
release and an iOS compile in parallel.

The four-hour upstream workflow uses the same whole-repository merge and
gpt-5.6-sol/xhigh conflict resolver as desktop. Because GitHub-token-authored
merges do not recursively trigger push workflows, it explicitly dispatches the
mobile release after an upstream integration only when that integration changed
`apps/mobile`, shared packages, patches, or the lockfile. Server/web-only parent
changes do not start a mobile release.

The workflow fails early when required release credentials are missing instead
of reporting a green release that shipped nothing. To activate:

1. Create an Expo account and fork-owned EAS project. EAS Update (OTA) and
   managed credentials still go through Expo; only IPA compilation is local.
2. Set repo secret `EXPO_TOKEN`.
3. Set `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` from a Team
   App Store Connect API key with the Admin role and **Access to Certificates,
   Identifiers & Profiles** enabled, plus repo variable `APPLE_TEAM_ID`. The
   workflow exposes Expo's supported ASC CI variables so EAS can create or
   repair distribution credentials, and injects the same key into the submit
   profile for TestFlight upload.
4. In App Store Connect, create the iOS app record once (`T3 Pretty`, bundle ID
   `com.sergeserbinenko.t3pretty`, SKU `t3-pretty-ios`).
5. Initialize EAS credentials once from an interactive local terminal with
   `eas build --platform ios --profile production --local`. After it creates
   the first Apple Distribution certificate and both provisioning profiles,
   normal mobile releases are fully non-interactive. Do not use a cloud
   `eas build` for this bootstrap unless you intend to spend an Expo iOS
   build credit.
6. On the Mac runner: Xcode (stable `Xcode.app` or `Xcode-beta.app`),
   CocoaPods, and Fastlane. The workflow selects the first of those that
   contains `xcodebuild`, then installs CocoaPods or Fastlane via Homebrew
   only when they are missing.
7. Configure in `.env` (or CI env): `T3CODE_MOBILE_UPDATE_URL`,
   `T3CODE_MOBILE_EAS_PROJECT_ID`, `T3CODE_MOBILE_EXPO_OWNER`,
   optionally `T3CODE_MOBILE_EXPO_SLUG`.

The app config disables expo-updates entirely when `T3CODE_MOBILE_UPDATE_URL`
is unset: fork binaries can share runtime fingerprints with upstream's EAS
project, so pointing at upstream's update URL would let upstream OTA bundles
replace fork JavaScript.

## Local build + device delivery (active today)

`~/.t3-scenery-updater/scenery-update.sh` (launchd, every 3 h) already
rebases the `scenery` branch onto the newest upstream nightly, cherry-picks
new fork commits, gates on typecheck + scenery tests, and builds the desktop
DMG. It now also calls `scenery-ios-build.sh`, which:

- prebuilds the Expo iOS project and builds an unsigned simulator app —
  staged under `~/.t3-scenery-updater/ios/` and installed into any booted
  simulator;
- when `SCENERY_IOS_DEVICE=1` (default), builds a device app signed with the
  configured Apple Development team and installs it on the paired iPhone via
  `devicectl` whenever it is reachable, retrying on later cycles;
- never fails the desktop pipeline, and skips in O(1) when the built head is
  unchanged.

That path is Development-signed device installs, not TestFlight. Store
binaries come from `fork-mobile-release.yml` on the GitHub runner.

Configuration lives in `~/.t3-scenery-updater/ios.env` (Xcode path, team id,
device opt-in). Every assignment in that file must be `export`ed — the app
config and pod plugins read them from the environment of child processes.
Disable the mobile leg entirely with
`touch ~/.t3-scenery-updater/.scenery-ios-off`.

### Team and capabilities

The signing team (78A5P57U23) is a paid Individual Developer Program team, so
the device build ships full capabilities: widget extension (Live Activities),
app groups, push, associated domains. Personal-team mode
(`T3CODE_IOS_PERSONAL_TEAM=1`, which strips those) remains available in
`ios.env` as a commented-out fallback — see "Personal Team signing" in
`apps/mobile/README.md`.

The share extension is the one exception: its `.share` App ID needs the
`group.com.sergeserbinenko.t3pretty` container ticked under its App Groups
capability on the Developer Portal once by a human (headless provisioning
cannot attach it). Until that happens, `T3CODE_IOS_SHARE_EXTENSION=0` in
`ios.env` keeps the extension out of builds; remove the line to re-enable.

### Push delivery (Live Activities + notifications)

Remote updates are relay → APNs, so the relay needs credentials:
repo variables `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_BUNDLE_ID`,
`APNS_ENVIRONMENT` and the `APNS_PRIVATE_KEY` secret, consumed by
`deploy-relay.yml`. `APNS_ENVIRONMENT=sandbox` matches the development-signed
device installs from this pipeline; flip it to `production` once store builds
ship. Without these the features degrade gracefully in-app (settings switches
disabled), with no relay-side errors.

## Versioning

The mobile app version prefers `.t3-fork/upstream-nightly`, then falls back to
`apps/web/package.json`, and trims the selected release-train value to its
numeric prefix for `CFBundleShortVersionString`. `T3CODE_MOBILE_APP_VERSION`
remains an explicit override. This keeps TestFlight marketing versions aligned
with the upstream code integrated into the fork even before the web package
manifest advances. The in-app What's New sheet keys its entries by these
versions.
