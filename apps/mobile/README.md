# T3 Pretty Mobile

T3 Pretty Mobile supports iOS and Android. This fork's automated production
binary pipeline currently builds and submits iOS releases; Android store
binaries are not wired into that workflow yet.

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
IPA is compiled locally with stable `Xcode.app`, or on EAS cloud when the
release Mac only has beta Xcode, then uploaded as a TestFlight build. Neither
path submits the app for App Store review.

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

Android equivalents (still cloud):

```bash
vp run eas:android:dev
vp run eas:android:preview:dev
vp run eas:android:preview
```
