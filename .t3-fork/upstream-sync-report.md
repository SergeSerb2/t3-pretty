# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260819.1133`
- Previously integrated parent nightly: `v0.0.34-nightly.20260819.1132`
- Conflict resolver: manual composition (four-file merge; generated lockfile resolved deterministically)

## T3 Pretty changes preserved at conflict boundaries

- `apps/desktop/src/app/DesktopLifecycle.ts` — Child-process-gone log annotations stay exported so Pretty can record stable Electron process-exit fields.
- `apps/desktop/src/app/DesktopLifecycle.test.ts` — The child-process-gone mapping test remains, and test fixtures keep the T3 Pretty app name plus the fork's local crash-reporter stub.
- `docs/user/background-service.md` — Surge Connect branding is kept at the Connect onboarding shortcut and sign-out copy.

## Parent changes integrated at conflict boundaries

- `apps/desktop/src/app/DesktopLifecycle.ts` — Registration now includes `ElectronWindow` so quit can destroy windows before waiting for backend shutdown.
- `apps/desktop/src/app/DesktopLifecycle.test.ts` — Shared Electron test helpers and the new destroy-before-shutdown coverage from the parent nightly.
- `docs/user/background-service.md` — macOS launch-agent support and the Connect shortcut no longer claim the background service is Linux-only.
- `pnpm-lock.yaml` — took the parent nightly's generated lockfile wholesale instead of AI-splicing it; fork-only dependency entries are re-derived by lockfile regeneration against the merged package manifests.

## Parent changes intentionally omitted

- `docs/user/background-service.md` — parent "T3 Connect" naming at the conflict boundary. Reason: T3 Pretty's user-facing Connect product is Surge Connect.
- `.github/workflows` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned
