# T3 Pretty mobile release train

The iOS app auto-updates through the same two mechanisms as the desktop
apps: merge-driven releases from CI, and twice-daily upstream ingestion with
local build delivery.

## Upstream ingestion (shared with desktop)

`.github/workflows/fork-upstream-sync.yml` runs at 00:00 and 12:00 UTC,
merges the newest upstream nightly tag (AI-resolving conflicts via
`scripts/fork/resolve-git-conflicts.mjs`), and lands it on `main` through an
auto-merged PR. Mobile code rides along — there is no separate mobile sync.

## Merge-driven releases

`.github/workflows/mobile-eas-production.yml` now triggers on every push to
`main` that touches mobile-relevant paths and publishes an OTA update
(`eas update`, production channel, both platforms). Store builds
(`eas build --auto-submit`) remain manual via workflow_dispatch.

Both paths skip cleanly until the fork's Expo identity exists. To activate:

1. Create an Expo account + EAS project for the fork.
2. Set repo secret `EXPO_TOKEN`.
3. Configure in `.env` (or CI env): `T3CODE_MOBILE_UPDATE_URL`,
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

Configuration lives in `~/.t3-scenery-updater/ios.env` (Xcode path, team id,
personal-team bundle id, device opt-in). Disable the mobile leg entirely with
`touch ~/.t3-scenery-updater/.scenery-ios-off`.

## Versioning

The mobile app version tracks `apps/web/package.json` (the release-train
manifest rewritten during releases), trimmed to its numeric prefix for
`CFBundleShortVersionString`; `T3CODE_MOBILE_APP_VERSION` overrides it (the
local pipeline passes the upstream nightly version explicitly). The in-app
What's New sheet keys its entries by these versions.
