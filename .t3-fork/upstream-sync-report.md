# T3 Pretty upstream integration report

- Parent nightly: `v0.0.43-nightly.20260927.2331`
- Previously integrated parent nightly: `v0.0.43-nightly.20260926.2318`
- Conflict resolver: not invoked; Git reported no text conflicts

## T3 Pretty changes preserved at conflict boundaries

- No text conflicts required a fork-preservation decision.

## Parent changes integrated at conflict boundaries

- No text conflicts required an AI-composed parent integration.

## Parent changes intentionally omitted

- None. The resolver did not omit any parent change to protect T3 Pretty.

## Post-merge repairs

- `desktop-typecheck` failed after merging `v0.0.43-nightly.20260927.2331` because Pretty's `DesktopPreviewRecordingFrame.data` is `Uint8Array` and recording listeners take `(frame, host)`, while the auto-merged Manager still built base64 strings and called one-argument listeners. Restored Pretty's byte encoding and host-targeted delivery so IPC consumers and the Uint8Array contract stay aligned.
  - edited `apps/desktop/src/preview/Manager.ts`
  - edited `apps/desktop/src/preview/Manager.test.ts`
