# Manual public releases

Cursor Origin `serbinenko/t3-pretty` is private, independent, and the source of truth.
Keep `origin` pointed there. Development branches, pull requests, upstream integration,
and internal releases stay on Origin. Its four-hour upstream sync and R2 release feed
continue to run independently.

GitHub `SergeSerb2/t3-pretty` contains public stable source snapshots cut manually by
Serge. There is no automatic Origin mirror, upstream sync, nightly publisher, or
internal mobile publisher on GitHub. A cut adds one commit on top of the previous
GitHub `main`; it does not copy new internal commit history. Existing GitHub history,
archive branches, tags, and release assets are retained.

## Cut a public version

Choose a tested, merged Origin commit and a new numeric version such as `0.1.0`.
The command requires the full source SHA and refuses duplicate or older public versions.
It runs outside CI and uses the current checkout's Git credentials. Use a maintainer-only
GitHub write key that can bypass the existing `main` pull-request ruleset. Keep this key
outside Buildkite and GitHub Actions. The maintainer key lives at
`~/.ssh/t3-pretty-public-release`. Select it for the push with
`export GIT_SSH_COMMAND="ssh -i ~/.ssh/t3-pretty-public-release -o IdentitiesOnly=yes"`.
Do not restore the retired automated mirror key.

Preview the cut from an Origin checkout:

```sh
node scripts/fork/cut-public-release.mjs --version 0.1.0 --commit <full-Origin-SHA>
```

The output gives the previous public commit and the proposed snapshot commit. Review
them with `git diff <previous-main> <snapshot>`. The command uses a separate temporary
Git index, so it does not switch branches or change staged files and working files.

Run the same command with `--push` when the snapshot is ready. It atomically advances
GitHub `main` and creates `public-v0.1.0`, without force pushes or copying other tags.
A concurrent cut fails instead of overwriting it. The snapshot records its version and
Origin SHA in `.t3-fork/public-release.json`, uses the public README, removes Buildkite
configuration, and keeps only the manual public-release GitHub workflow.

Build the exact snapshot in a clean, disposable checkout. Do not run the internal
worktree env-linking setup there. Use local workers for compilation and signing;
do not dispatch hosted build runners or queue EAS cloud builds as part of this route.
Do not move a public tag after a cut. Use a new version when source needs to change.

## Build public artifacts locally

Install the Node version from `package.json`, install Vite+, and run
`vp i --frozen-lockfile`. Set the numeric release version and an absolute artifact directory:

```sh
export VERSION=0.1.0
export ARTIFACTS=/absolute/path/to/public-artifacts
export T3CODE_BUILD_FLAVOR=public
export T3CODE_PUBLIC_RELEASE=1
export T3CODE_DESKTOP_UPDATE_FEED_URL=https://github.com/SergeSerb2/t3-pretty/releases/latest/download/
node scripts/update-release-package-versions.ts "$VERSION"
vp run --filter t3 build
node apps/server/scripts/cli.ts pack --app-version "$VERSION" --out-dir "$ARTIFACTS" --verbose
cp "$ARTIFACTS/t3-$VERSION.tgz" "$ARTIFACTS/t3.tgz"
cp scripts/fork/install-cli.sh "$ARTIFACTS/install.sh"
```

The full CLI build includes its web client. The packer includes the root MIT license
and restores temporary packaging files afterwards.

Build each desktop installer on its supported host, with that host's verified signing
credentials. For example, a signed Apple Silicon macOS build uses:

```sh
vp run dist:desktop:artifact --platform mac --target dmg --arch arm64 \
  --build-version "$VERSION" --verbose --signed
```

Windows uses `--platform win --target nsis --arch x64`; Linux uses
`--platform linux --target AppImage --arch x64`. Keep the required verified WSL
runtime inputs for Windows. See [fork release operations](fork-release.md) for the
platform signing and native-runtime prerequisites. Do not substitute unsigned assets
for a release that requires signatures.

Build the Linux AppImage and Debian package separately, using distinct output
directories so one build does not overwrite the other build's updater manifest:

```sh
vp run dist:desktop:artifact --platform linux --target AppImage --arch x64 \
  --build-version "$VERSION" --output-dir "${ARTIFACTS}-appimage" --verbose
vp run dist:desktop:artifact --platform linux --target deb --arch x64 \
  --build-version "$VERSION" --output-dir "${ARTIFACTS}-deb" --verbose
```

Keep both installers. Publish one `latest-linux.yml` whose `files` entries include
both installers, with each file's final SHA-512 and size. Preserve the AppImage's
`path`, `sha512`, and `blockMapSize` metadata. Verify the combined manifest against
the final files before publication. Debian installations download the `.deb` named
in that manifest.
The public Debian package is `t3pretty`, with the `t3pretty.desktop` launcher.
The internal Debian package remains `t3code`.

### Signed Android APK and AAB without EAS

The direct Gradle route needs macOS or Linux, Java and the Android SDK used by the
installed Expo/React Native toolchain. It does not need an Expo account or EAS project.
Use a disposable checkout with no `apps/mobile/android` directory. The command refuses
an existing native tree so an internal package cannot carry into a public build.

Select the approved public key. Keep its JSON credentials file outside the checkout,
with permissions restricted to the maintainer. Its fields are `keystorePath`,
`keystorePassword`, `keyAlias`, and `keyPassword`. A relative key path resolves from
that JSON file. Key creation and rotation are separate maintainer decisions; the
build never generates a key or falls back to a debug key.

```sh
node scripts/fork/build-public-android.mjs \
  --version "$VERSION" --version-code <positive-integer> \
  --credentials-file /absolute/path/to/public-android-credentials.json \
  --out-dir "$ARTIFACTS"
```

The command verifies the resolved Expo public identity and T3 Connect settings,
disables OTA, prebuilds Android, and runs `assembleRelease` and `bundleRelease`
together. Both use the same version, version code, and explicit release key.
It writes `t3-pretty-$VERSION.apk` and `t3-pretty-$VERSION.aab`. Keep the version code
fixed for both formats and increase it for the next public Android release.
As an alternative to the JSON file, set `T3CODE_PUBLIC_ANDROID_KEYSTORE`,
`T3CODE_PUBLIC_ANDROID_KEY_ALIAS`, `T3CODE_PUBLIC_ANDROID_STORE_PASSWORD`, and
`T3CODE_PUBLIC_ANDROID_KEY_PASSWORD` in the local build environment.

The optional EAS profiles `public-apk` and `public-aab` remain for separately configured
local/manual use. They use public production identity, local credentials, no version
auto-increment, and disabled OTA. There is no public submit profile. Supply the public
signing key through the local `apps/mobile/credentials.json` and configure the distinct
public EAS project and its remote version state explicitly. EAS CLI requires that
project even with `eas build --local`, because this repository's internal release flow
uses remote version management. Do not reuse the internal project. The public workflow
does not queue EAS builds or provide signing credentials. Use the direct Gradle route
for the manual stable release.

### Verify and publish manually

Public snapshots and builds with `T3CODE_PUBLIC_RELEASE=1` reject resolved internal
Clerk, relay, passkey-domain, updater, and EAS/OTA settings after env files load.
Desktop releases use the public GitHub updater feed even in a clean local checkout.
The guard also rejects inherited client tracing settings so their tokens and internal
collection destinations cannot enter web bundles or Expo manifests.
Ordinary development and self-host builds outside a public snapshot retain their env
overrides; internal flavor keeps its existing configuration. Public mobile OTA is
disabled when no update URL is configured. An optional OTA URL must match a distinct,
explicitly selected `T3CODE_PUBLIC_MOBILE_EAS_PROJECT_ID`; never select the internal project.

Check the effective configuration in each artifact, not only strings in source.
Verify desktop signatures/notarization where applicable, updater manifests and hashes,
CLI installation and its MIT notice, APK and AAB signatures against the approved public
certificate, Android package/version fields, and startup/onboarding in an emulator
using the exact signed APK. Keep SHA-256 hashes of all assets.

Create a draft GitHub Release for the exact `public-v$VERSION` tag, upload only the
verified public assets, then verify downloaded hashes before publishing it as latest.
Do not claim an App Store, Google Play, or platform binary until that delivery is verified.

The existing `.github/workflows/public-release.yml` remains manual. It requires the
snapshot marker and public tag to match the run commit. It can build unsigned desktop
artifacts and JavaScript exports, so its green result alone is not a signed release.
Keep hosted execution and Pages deployment inactive unless separately requested.
Build and sign the native Android APK and AAB locally, then upload the verified assets
manually. The public Pages client can use T3 Connect; its CLI OAuth routes stay disabled
so the CLI retains upstream's registered `https://app.t3.codes/connect/callback` URI.

Public and internal apps keep distinct identities and state directories. Both
production mobile apps register `t3code://`; the last installation receives that scheme.
Pre-split releases and `desktop-r2-latest` remain in the internal release line.

## Retire automatic public writes

Remove the `github-mirror` step from Origin's Buildkite pipeline. Archive the separate
`t3-pretty-github-force-mirror` pipeline while preserving its build history. Revoke its
GitHub write deploy key so an old queued build cannot restore a mirror. Keep any new
manual release key local to the maintainer.

Disable GitHub's upstream-sync, fork-release, upstream release, mobile-production,
mobile-preview, mobile-showcase, relay, and one-shot force-sync workflows. Cancel queued
internal publishing runs. Keep the manual Public release workflow available. Future cuts
remove all other workflows, so an upstream merge on Origin cannot re-enable them on
GitHub. No public stable version is cut as part of this configuration change.

## Internal release path

Buildkite continues to publish internal CLI and desktop artifacts to R2:

```sh
curl -fsSL https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/install.sh | sh
```

That build uses Surge Connect, stores state under `~/.t3`, and keeps its existing
background-service names. Follow [fork releases](fork-release.md) for internal delivery.
