# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261013.3042`
- Previously integrated parent nightly: `v0.0.46-nightly.20261012.3035`
- Conflict resolver: `gpt-6.1-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/chat/MessagesTimeline.tsx` — Preserves the observeLiveActivityMotion dependency used by T3 Pretty's live-activity motion wiring.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Preserves Pretty's relocated observeVisibleAnimation import already present above the conflict.
- `apps/web/src/components/ui/button.tsx` — Pretty's 150ms ease-out transitions for shadow, background, border, text color, opacity, and scale, including transitions back when interaction ends.
- `apps/web/src/components/ui/button.tsx` — Reduced-motion protection: transitions remain disabled under motion-reduce, and press scaling remains motion-safe only.
- `apps/web/src/components/ui/button.tsx` — Press scaling continues to exclude natively disabled buttons and buttons with aria-haspopup; existing Pretty variants, styling, and Button rendering/prop wiring remain unchanged.

## Parent changes integrated at conflict boundaries

- `apps/web/src/components/chat/MessagesTimeline.tsx` — Imports isJavaScriptReplTool alongside claudeSkillInvocation for upstream JavaScript REPL tool recognition.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Retains upstream visible-animation support through the existing observeVisibleAnimation import.
- `apps/web/src/components/ui/button.tsx` — Added will-change: scale for buttons without aria-haspopup that are neither natively disabled nor aria-disabled=true, preserving the parent's complete selector and compositing optimization.

## Parent changes intentionally omitted

- None. The resolver did not omit any parent change to protect T3 Pretty.
