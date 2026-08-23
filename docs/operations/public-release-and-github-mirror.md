# Public release and GitHub mirror

Cursor Origin `main` is the source of truth. Buildkite's `github-mirror` step
pushes only Origin `main` and tags matching `GITHUB_MIRROR_TAG_PATTERN` to the
configured GitHub repository. It never mirrors branches back.

GitHub-only `public-v*` release tags are intentionally retained and never
mirrored back to Origin or pruned by the Origin tag pass.

The first run preserves the old GitHub `main` tip in
`archive/pre-origin-migration-2026-08-23` before replacing `main`. Once that
archive exists, any non-ancestor GitHub `main` tip aborts the mirror. Configure
`GITHUB_MIRROR_SSH_KEY` as a dedicated deploy key with write access only to the
mirror repository, and allow deploy keys to bypass the GitHub `main` pull-request
ruleset. Do not use a personal token.

`.github/workflows/public-release.yml` is manual-only and sets
`T3CODE_BUILD_FLAVOR=public`. It builds unsigned macOS DMG, Windows NSIS, and
Linux AppImage artifacts, packs the CLI tarball, exports the mobile bundle, and
builds a Pages-ready hosted web artifact. The required `version` input is a
numeric semver. Set `publish_release` to attach the artifacts to a GitHub
Release tagged `public-v<version>`; otherwise they remain workflow artifacts.
Desktop updater metadata uses the GitHub `releases/latest/download` feed, while
exact-version CLI assets are attached to the immutable release tag.

Set `deploy_pages` to publish the hosted web build to GitHub Pages. Set
`queue_mobile_builds` to queue public iOS and Android builds on EAS. That option
requires the repository Actions variables
`T3CODE_PUBLIC_MOBILE_EAS_PROJECT_ID`, `T3CODE_PUBLIC_MOBILE_EXPO_OWNER`, and
`T3CODE_PUBLIC_MOBILE_EXPO_SLUG`, plus the `EXPO_TOKEN` Actions secret. The
workflow does not submit mobile binaries to stores or publish OTA updates.

One-time repository setup: enable GitHub Actions for Pages with the `github-pages`
environment, add the three public EAS variables if mobile builds are needed, and
add `EXPO_TOKEN` only if `queue_mobile_builds` will be used. Keep token values in
Actions secrets; this document intentionally names settings, not their values.

The internal and public production mobile apps have different app IDs and can be
installed side by side, but both register the `t3code://` URL scheme. Installing
the last one changes which app receives that scheme.

The workflow does not sign installers, maintain a separate updater feed, submit
mobile binaries to stores, or change the internal Buildkite release path.
