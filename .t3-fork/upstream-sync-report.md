# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260813.1086`
- Previously integrated parent nightly: `v0.0.34-nightly.20260813.1084`
- Conflict resolver: `grok-4.6` with manual resolution (scheduled CLIProxyAPI token returned HTTP 401)

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/preview/PreviewPanelShell.tsx` — keep the Pretty split inline/sheet layout (`right-panel-inline-frame`, exit animation, resize handle isolation)
- `apps/web/src/components/preview/PreviewPanelShell.test.ts` — keep the Pretty `createElement` helper and lifecycle/exit coverage

## Parent changes integrated at conflict boundaries

- `apps/web/src/components/preview/PreviewPanelShell.tsx` — add `max-w-full` so the preview panel cannot overflow its workspace
- `apps/web/src/components/preview/PreviewPanelShell.test.ts` — add the parent `max-w-full` regression test

## Parent changes intentionally omitted

- `apps/web/src/components/preview/PreviewPanelShell.tsx` — parent single-return `isInline ? flex-1/shrink-0 : w-full` class split. Reason: that branch is dead in Pretty's non-inline return; Pretty already owns inline sizing in the earlier return
- `.github/workflows` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned
