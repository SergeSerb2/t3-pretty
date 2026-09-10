# Public release and GitHub mirror

Cursor Origin `main` is the source of truth. Buildkite's `github-mirror` step
pushes only Origin `main` and tags matching `GITHUB_MIRROR_TAG_PATTERN` to the
configured GitHub repository. It never mirrors branches back.

GitHub-only `public-v*` release tags are intentionally retained and never
mirrored back to Origin or pruned by the Origin tag pass. Mirroring a git tag
does not create or promote a GitHub Release; only the manual public workflow
marks `releases/latest`.

The first run preserves the old GitHub `main` tip in
`archive/pre-origin-migration-2026-08-23` before replacing `main`. Once that
archive exists, any non-ancestor GitHub `main` tip aborts the mirror. Configure
`GITHUB_MIRROR_SSH_KEY` as a dedicated deploy key with write access only to the
mirror repository, and allow deploy keys to bypass the GitHub `main` pull-request
ruleset. Do not use a personal token. Do not expand that variable in the
Buildkite `command:` block: the agent interpolates `${}` before
`load-buildkite-secrets.sh` runs, so a YAML `test -n "${GITHUB_MIRROR_SSH_KEY:-}"`
becomes `test -n ""` and the step dies with the key still on disk.

`.github/workflows/public-release.yml` is manual-only and sets
`T3CODE_BUILD_FLAVOR=public`. It builds unsigned macOS DMG, Windows NSIS, and
Linux AppImage artifacts, packs the CLI tarball, exports the mobile bundle, and
builds a Pages-ready hosted web artifact. The required `version` input is a
numeric semver. Set `publish_release` to attach the artifacts to a GitHub
Release tagged `public-v<version>`; duplicate or older public versions are
rejected. Otherwise, the files remain workflow artifacts.
Desktop updater metadata uses the GitHub `releases/latest/download` feed, while
exact-version CLI assets are attached to the immutable release tag.

Set `deploy_pages` to publish the hosted web build to
`https://sergeserb2.github.io/t3-pretty/`. The build includes a `404.html` copy
of the app entry point so direct browser-history pairing routes load under the
`/t3-pretty/` project path. This is the manual T3 Pretty
public target; `https://app.t3.codes` remains the upstream T3 Code deployment.
Web and desktop pairing links use the Pages client. Its CLI OAuth routes are
disabled so the CLI keeps upstream's registered
`https://app.t3.codes/connect/callback` URI.

Set `queue_mobile_builds` to queue public iOS and Android builds on EAS. That
option requires the repository Actions variables
`T3CODE_PUBLIC_MOBILE_EAS_PROJECT_ID`, `T3CODE_PUBLIC_MOBILE_EXPO_OWNER`, and
`T3CODE_PUBLIC_MOBILE_EXPO_SLUG`, plus the `EXPO_TOKEN` Actions secret. The
workflow does not submit mobile binaries to stores or publish OTA updates.

Public Android closed testing is separate from that GitHub artifact workflow.
Start a Buildkite UI build of Origin `main` with
`T3CODE_PUBLIC_ANDROID_RELEASE=1`; it builds package
`com.sergeserbinenko.t3pretty.app` against official T3 Connect and submits the
exact AAB to Google Play's internal track. The public EAS project identifiers
live on `macos-release`, and its Google service-account key lives in EAS—not in
GitHub or Buildkite.

One-time repository setup: enable GitHub Actions for Pages with the `github-pages`
environment, add the three public EAS variables if mobile builds are needed, and
add `EXPO_TOKEN` only if `queue_mobile_builds` will be used. Keep token values in
Actions secrets; this document intentionally names settings, not their values.

The internal and public production mobile apps have different app IDs and can be
installed side by side, but both register the `t3code://` URL scheme. Installing
the last one changes which app receives that scheme.

Pre-split T3 Pretty releases belong to the internal lineage. T3 Pretty Internal
keeps their `~/.t3`, `T3 Code (Alpha)`, and `t3code.service` identities. The new
public build deliberately starts from its separate identities instead of
adopting that state, which keeps public and internal installations independent.

The workflow does not sign installers, maintain a separate updater feed, submit
mobile binaries to stores, or change the internal Buildkite release path.

## Internal release path

Buildkite continues to publish the internal CLI and desktop artifacts to the
existing R2 feed. Install the internal CLI with:

```sh
curl -fsSL https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/install.sh | sh
```

That build uses Surge Connect, stores state under `~/.t3`, and keeps the legacy
`t3code.service` and `com.t3tools.t3code.service.plist` background-service names.
