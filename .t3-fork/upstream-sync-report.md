# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261012.3021`
- Previously integrated parent nightly: `v0.0.46-nightly.20261012.3010`
- Conflict resolver: hand-merge after scheduled Buildkite #3422 blocked on the learned-route TLS guard. Text conflicts were the modify/delete of `.github/workflows/release-desktop.yml` plus content in `DesktopEarlyElectronStartup.test.ts` and `NativeWorkspaceColumns.ios.tsx`.

## T3 Pretty changes preserved at conflict boundaries

- `.github/workflows` — fork-owned sync, signing, release, and security workflows stay pinned to Pretty main. Parent `release-desktop.yml` remains deleted.
- `apps/desktop/src/app/DesktopEarlyElectronStartup.ts` — auto-merged. Pretty `buildFlavor` / `.t3-pretty` / `t3pretty` Linux identity stays; parent Hyprland `resolveLinuxDisableFeaturesSwitch` is integrated.
- `apps/desktop/src/app/DesktopEarlyElectronStartup.test.ts` — Pretty public-flavor identity assertion stays; parent Hyprland color-manager cases are added beside it.
- `apps/desktop/src/app/DesktopPreReadyPlatform.ts` — auto-merged. Pretty Windows GPU switches, bounded settings read, and `T3CODE_BUILD_FLAVOR` branding stay; parent Hyprland `--disable-features` wiring is integrated.
- `apps/mobile/src/native/NativeWorkspaceColumns.ios.tsx` — Pretty `nativeWorkspaceColumnsAreReady` helper stays. Parent's waiting-only timer is used so iPad and older clients do not start a fail-open clock; the tested helper still decides readiness.

## Parent changes integrated at conflict boundaries

- `apps/desktop/src/app/DesktopEarlyElectronStartup.ts` — Hyprland 0.48–0.50 Wayland color-manager disable-features probe.
- `apps/desktop/src/app/DesktopPreReadyPlatform.ts` — applies that probe before Electron is ready.
- `apps/mobile/modules/t3-native-controls/ios/T3LayoutMetricsView.swift` — `assumeNoHingeIfSilent` so ordinary iPhones publish metrics instead of staying blank.
- `apps/web/src/lib/contextWindow.ts` — context meter no longer treats just-under-a-million tokens as 1000k.
- Forgejo pull-request head commit reporting and the Windows ACP terminal-kill test fix.

## Parent changes omitted to protect T3 Pretty

- `.github/workflows/release-desktop.yml` — parent Windows ARM PowerShell release-workflow change was omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned.

## Hand-complete notes

- Scheduled sync #3422 resolved the text conflicts, then refused publication because `connectionRoutes` still attempted persisted learned `http://` / `ws://` when `allowInsecure` defaulted true. That TLS regression is fixed in the follow-up commit on this branch; the guard script is unchanged.
- Pretty already had the iPhone LayoutMetrics fail-open as `nativeWorkspaceColumnsAreReady`. Parent 3021 shipped the first-party Swift no-hinge fallback plus an inlined JS timeout; the helper is kept and the Swift change is taken.

## Post-merge repairs

- `packages/client-runtime/src/connection/routes.ts` — `connectionRoutes` always requires https/wss for learned routes. `allowInsecure` still lets mergeLearnedRoutes label explicitly saved plaintext and never learns or selects learned http/ws.
- `packages/client-runtime/src/connection/routes.test.ts` and `registry.test.ts` — cover the drop of persisted learned plaintext and label Tailscale over HTTPS.
