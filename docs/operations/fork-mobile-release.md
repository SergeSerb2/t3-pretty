# T3 Pretty mobile release train

The iOS app auto-updates through the same two mechanisms as the desktop apps:
merge-driven releases from CI, and upstream ingestion every four hours with
local build delivery.

## Upstream ingestion (shared with desktop)

`.buildkite/pipeline.yml` runs `scripts/fork/run-upstream-sync.sh` every four
hours at 00:00, 04:00, 08:00, 12:00, 16:00, and 20:00 UTC on `macos-release`.
The job merges the newest upstream nightly tag (AI-resolving conflicts via
`scripts/fork/resolve-git-conflicts.mjs`) and lands it on Origin `main` through
an auto-merged pull request. Mobile code rides along — there is no separate
mobile sync. The imported `fork-upstream-sync.yml` wrapper is not scheduled.

## Merge-driven releases

`.buildkite/pipeline.yml` runs `scripts/fork/publish-mobile-release.sh` on
every push to Origin `main` that is not the four-hour schedule. The job lives
on `macos-release` (m1-dev), the same native queue as the signed DMG. It is
not imported GitHub Actions: the importer cannot load `EXPO_TOKEN` or Apple
keys, so those jobs died in about two seconds and TestFlight never moved.

The script skips when the commit does not touch mobile-relevant paths. A
release publishes an OTA update on the production channel, then compiles a
production iOS IPA on that same Mac when the native fingerprint changed, or
when `.t3-fork/ios-native-submit` is missing. That marker is written only
after this native job actually uploads an IPA. A fingerprint left behind by
the old GitHub Actions importer is not enough — Buildkite #183 published
OTA and skipped TestFlight for that reason, so testers watching
TestFlight.app saw no new build. The runner also writes
`~/.cache/t3-pretty-release/ios-native-submit` immediately after submit, and
later jobs treat `origin/main`'s copy of the git marker as enough. Queued
jobs on older SHAs therefore do not each compile another IPA while the
marker pull request is still landing. Set `T3CODE_FORCE_IOS=1` (or
`T3CODE_MOBILE_MODE=build`) on a Buildkite rebuild to compile and submit
even when the fingerprint matches.

OTA still reaches already-installed TestFlight binaries whose native
fingerprint matches. JS-only changes therefore show up as an in-app update
after the Mac job finishes. Testers who need a brand-new TestFlight binary
(new devices, or a native module change) get one when the fingerprint
changes. TestFlight.app itself only lists new IPAs.

Local `eas build --local` IPAs do not create hosted EAS Build records, so
`eas build:list` alone cannot describe the last submitted binary. After a
successful TestFlight submit the script commits the fingerprint to
`.t3-fork/ios-production-fingerprint` and records
`.t3-fork/ios-native-submit`. Because `main` requires pull requests, the
bot commit lands through a short-lived `automation/ios-fingerprint-*`
Origin pull request that `scripts/fork/origin-forge.mjs` merges. Those
files are outside every release path filter, so the record itself
schedules no further release. The iOS step has a higher Buildkite priority
than Origin PR review so a feature-branch review cannot occupy m1-dev in
front of TestFlight.

iOS store binaries cannot be compiled on the Windows runner. Registering a
second Mac (for example m5-dev) with the same `self-hosted`, `macOS`,
`ARM64`, `t3code-fork`, `release-only` labels lets GitHub run a desktop
DMG and an iOS compile in parallel. Use `scripts/fork/setup-macos-runner.sh`
and install a full Xcode.app first — Command Line Tools cannot produce an
IPA. An M5 Pro (18-core, 48 GB) should compile the current IPA in roughly
7–10 minutes versus ~13 minutes on m1-dev; the larger win is that the two
Macs stop taking turns.

The four-hour upstream job uses the same whole-repository merge and
gpt-5.6-sol/xhigh conflict resolver as desktop. After the Origin merge, if
that integration changed mobile-relevant paths, the sync job runs
`publish-mobile-release.sh` on macos-release so a missed merge push still
publishes OTA. The script takes `/tmp/t3-pretty-ios-mobile.lock`, so a
follow-up native `ios-mobile` job cannot overlap eas update or a local IPA.
A leftover lock from a killed job is removed when no publisher process is
still running; waiting on a live lock fails after 15 minutes instead of
sitting until the 90-minute step timeout.
Server/web-only parent changes do not publish OTA or compile an IPA.

The job fails early when required release credentials are missing instead
of reporting a green release that shipped nothing. To activate:

1. Keep `EXPO_TOKEN` on the macos-release agent (cluster secret or
   `/Users/m1-dev/.config/t3-pretty/EXPO_TOKEN`). Installed TestFlight
   binaries poll the fork Expo Updates URL baked into the IPA; eas-cli on
   this Mac publishes that channel. IPA compilation is local. Do not import
   a GitHub Actions mobile workflow for this.
2. Set `APPLE_API_KEY`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` from a Team
   App Store Connect API key with the Admin role and **Access to Certificates,
   Identifiers & Profiles** enabled, plus `APPLE_TEAM_ID`. The
   script exposes Expo's supported ASC CI variables so local EAS can create or
   repair distribution credentials, and injects the same key into the submit
   profile for TestFlight upload.
3. In App Store Connect, create the iOS app record once (`T3 Pretty`, bundle ID
   `com.sergeserbinenko.t3pretty`, SKU `t3-pretty-ios`).
4. Initialize EAS credentials once from an interactive local terminal with
   `eas build --platform ios --profile production --local`. After it creates
   the first Apple Distribution certificate and both provisioning profiles,
   normal mobile releases are fully non-interactive. Do not use a cloud
   `eas build` for this bootstrap unless you intend to spend an Expo iOS
   build credit.
5. On the Mac runner: Xcode (stable `Xcode.app` or `Xcode-beta.app`),
   CocoaPods, and Fastlane. The script selects the first of those that
   contains `xcodebuild`, then installs CocoaPods or Fastlane via Homebrew
   only when they are missing. Command Line Tools cannot compile an IPA;
   if `xcode-select -p` still points at them, run once:
   `sudo xcode-select -s /Applications/Xcode-beta.app/Contents/Developer`.
   The script retries that switch with passwordless sudo during the job.
   Local EAS on macOS 26 / Xcode 27 also needs the `security` PATH shim in
   `scripts/fork/security-eas-local-keychain` so Prepare credentials does not
   reject a successfully imported distribution certificate.
6. Configure in `.env` (or CI env): `T3CODE_MOBILE_UPDATE_URL`,
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
binaries come from `scripts/fork/publish-mobile-release.sh` on the
Origin-connected Mac release runner.

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
