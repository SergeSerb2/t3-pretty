# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260815.1097`
- Previously integrated parent nightly: `v0.0.34-nightly.20260814.1096`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/index.css` — T3 Pretty's 200ms inline right-panel gap/surface animation, including synchronized resize behavior, closed-state translation, and maximized-panel exit handling.
- `apps/web/src/index.css` — T3 Pretty's terminal drawer animation with a closed cascade default, preventing the docked chat composer from wiggling during initial open.
- `apps/web/src/index.css` — Reduced-motion fallbacks for both the right-panel and terminal-drawer transitions.

## Parent changes integrated at conflict boundaries

- `apps/web/src/index.css` — Applied the parent cleanup that removes the legacy workspace-titlebar-controls, surface-subheader, and inline preview-subheader declarations from this stylesheet.
- `apps/web/src/index.css` — Applied the parent removal of the legacy chat-composer-horizontal-inset and chat-composer-glass declarations, allowing the shared chat-composer-glass-shell implementation that follows to remain authoritative.

## Parent changes intentionally omitted

- `.github/workflows/publish-aur.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned
- `.github/workflows/release.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned
