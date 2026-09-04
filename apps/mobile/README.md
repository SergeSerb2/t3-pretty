# T3 Pretty Mobile

T3 Pretty Mobile supports iOS and Android. Buildkite submits Internal Android
releases automatically once the Play app is enabled, and submits the separate
public app only from an explicit closed-testing build. iOS continues through
the fork's OTA and TestFlight train.

## Quickstart

> [!NOTE]
> Uses native modules so using Expo Go is not supported. You need to use the Expo Dev Client.

This app has three variants:

- `development`: Expo dev client, installable side-by-side as `T3 Pretty Dev`
- `preview`: persistent internal preview build, installable side-by-side as `T3 Pretty Preview`
- `production`: public `T3 Pretty` or internal `T3 Pretty Internal` release build

Development and preview are shared maintainer-only identities across build flavors. Only production
supports installing the public and internal apps side by side.

Run commands from `apps/mobile`.

T3 Connect is optional. Public builds use `.env.example`; internal builds select the compatible
Surge Connect defaults with `T3CODE_BUILD_FLAVOR=internal`. Overrides belong in the repository-root
`.env` or `.env.local`, not an `apps/mobile/.env` file.

## Development

Start Metro for the dev client:

```bash
vp run dev:client
```

Metro keeps its transform cache between ordinary starts. If the cache itself is causing stale or
invalid output, clear it for one development-client start:

```bash
vp run dev:client:reset
```

Run that reset once after installing or changing the Uniwind dependency patch. Cached transforms
can otherwise reference its previous pnpm package path. Ordinary Metro starts still keep the cache.

Component edits use Fast Refresh. Connection-runtime edits replace the active Effect layer through
a stable atom runtime, preserving navigation and existing atom subscribers. Replaced registries
and managed runtimes dispose their resources; the app does not force a JavaScript reload. The Uniwind patch
skips global style invalidation when generated styles and themes are unchanged, while real style
changes still refresh. See [mobile development lifecycle](../../docs/internals/mobile-development.md)
for the lifetime boundaries.

Build and run the local iOS dev client:

```bash
vp run ios:dev
```

If your Xcode account only has a Personal Team, use a bundle identifier you control and opt into the
reduced-capability local build. Personal Team builds omit the widget and share extensions, push,
Associated Domains, and native Sign in with Apple entitlements; builds without this opt-in are
unchanged.

```bash
T3CODE_IOS_PERSONAL_TEAM=1 \
T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID=com.example.t3code.dev \
vp run ios:dev
```

Build and install a self-contained Release app that does not need Metro:

```bash
vp run ios:release
```

The Personal Team equivalent also needs a unique bundle identifier:

```bash
T3CODE_IOS_PERSONAL_TEAM=1 \
T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID=com.example.t3code \
vp run ios:release
```

Build and run the local iOS preview app:

```bash
vp run ios:preview
```

Force the review diff highlighter engine:

```bash
EXPO_PUBLIC_REVIEW_HIGHLIGHTER_ENGINE=javascript vp run ios:dev
```

`javascript` is the default and recommended setting for the review diff screen. Set `EXPO_PUBLIC_REVIEW_HIGHLIGHTER_ENGINE=native` only when you explicitly want to test the native Shiki engine.

Inspect the resolved Expo config for a variant:

```bash
vp run config:dev
vp run config:preview
```

Run static checks for mobile native code:

```bash
node ../../scripts/mobile-native-static-check.ts
```

The native lint task runs SwiftLint for Swift plus ktlint and detekt for Kotlin. Missing native tools are reported as warnings and skipped locally. CI installs the default toolset from `apps/mobile/Brewfile` before running the native checks.

## Production builds

CI publishes production OTA through the fork-owned EAS project. Installed
TestFlight binaries pick that up. When the native fingerprint changes, a new
IPA is compiled locally with stable `Xcode.app` or the Apple-listed beta build
configured by `T3CODE_ACCEPTED_XCODE_BETA_BUILD`. Older beta builds fall back
to EAS cloud. The resulting IPA is uploaded as a TestFlight build; neither path
submits the app for App Store review.

Android production binaries use Google Play's internal testing track:

- `T3 Pretty Internal` uses package `com.sergeserbinenko.t3pretty` and the
  private Internal relay. Its Buildkite step runs on each non-scheduled `main`
  build after `T3CODE_INTERNAL_ANDROID_RELEASE_ENABLED=1` is configured.
- public `T3 Pretty` uses package `com.sergeserbinenko.t3pretty.app` and official
  T3 Connect at `https://relay.t3.codes`. It runs only from a Buildkite UI build
  with `T3CODE_PUBLIC_ANDROID_RELEASE=1`.

Both stay on Play internal testing until the release policy is deliberately
changed. See `docs/operations/fork-mobile-release.md` for the one-time Play and
EAS credential setup.

Preview and production variants use Expo fingerprinting so OTA updates only reach binaries with matching native dependencies, config plugins, and patches. CI uses the `preview:dev` profile to reuse a compatible native build when possible.

The development variant uses `appVersion` to avoid recalculating the native fingerprint for each Metro launch manifest. `MOBILE_VERSION_POLICY` can override either default. If you distribute a custom Release build with the development identity and publish OTA updates to it, set `MOBILE_VERSION_POLICY=fingerprint` for both its build and updates. Changing the runtime policy requires a native rebuild for OTA matching; an existing dev client can still load local Metro bundles.

Use `vp run ios:release` only when you want a self-contained local Release
app that does not need Metro.
`vp run eas:ios:*` still starts a **cloud** build and counts against the Expo
monthly iOS quota — do not use those unless you intend to.

Create a local production IPA (Mac with Xcode):

```bash
vp run ios:prod:local
```

Create a PR preview dev-client build manually (cloud, counts against quota):

```bash
vp run eas:ios:preview:dev
```

Create a cloud dev-client build:

```bash
vp run eas:ios:dev
```

Create a persistent preview build:

```bash
vp run eas:ios:preview
```

Android development equivalents (still cloud):

```bash
vp run eas:android:dev
vp run eas:android:preview:dev
vp run eas:android:preview
```
