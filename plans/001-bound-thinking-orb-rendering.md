# 001 — Bound thinking-orb rendering work

- **Status**: IMPLEMENTED
- **Commit**: 0027a8a4
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 3 files, about 180 lines including tests

## Problem

Every mounted thinking orb owns an independent, uncapped `requestAnimationFrame`
loop. On the profiled 240 Hz display this repaints each canvas up to 240 times
per second. The chat can mount an active-row orb, a scroll-pill orb, a 64 px hero
orb, and up to 12 sidebar orbs at once.

`apps/web/src/scenery/orbs/vendor/ThinkingOrb.tsx:64` currently contains:

```tsx
const loop = () => {
  frame((performance.now() / 1000) * effSpeed);
  if (running) raf = requestAnimationFrame(loop);
};
```

`apps/web/src/scenery/SceneryMotion.tsx:404` also animates every visible sidebar
indicator even though those indicators are secondary, persistent status chrome:

```tsx
<ThinkingOrb
  state="working"
  size={20}
  theme={orbTheme}
  style={{ width: 16, height: 16 }}
  aria-hidden
/>
```

Live sampling of the matching installed build showed the Electron GPU helper at
66-72% CPU and the renderer at 23-34%, while the server stayed around 0-1%.
Native samples showed continuous display-link, compositor, IOSurface, and Metal
work. This makes the canvas repaint path the primary CPU source, not server or
WebSocket orchestration.

## Target

- All animated orbs share one animation-frame scheduler.
- The scheduler draws at no more than 30 frames per second, independent of the
  display refresh rate.
- It owns no scheduled frame when it has no subscribers.
- Orbs stop scheduling when offscreen, when the document is hidden, or when the
  app window is unfocused; they resume on visibility/focus.
- Sidebar orbs render one representative static frame, and their labels use a
  fixed quiet opacity instead of an infinite animation. The active working-row
  orb remains animated; the scroll pill and hero retain their intended motion.
- Reduced-motion and explicit `paused` rendering take the static path without
  installing observers or event listeners.

## Repo conventions to follow

- Keep the vendored canvas engine dependency-free under
  `apps/web/src/scenery/orbs/vendor/`.
- Preserve the existing `IntersectionObserver` offscreen guard and the static
  reduced-motion frame in `ThinkingOrb.tsx`.
- Keep animation state local to the scenery module; do not change contracts,
  server behavior, or persisted thread state.
- The repo's motion duration/easing tokens are irrelevant to this continuous
  painter; the exact performance budget is 30 FPS.

## Steps

1. Add a small shared scheduler beside `ThinkingOrb.tsx`. Give it injectable
   request/cancel functions so its cadence and teardown can be unit tested.
2. Replace each component-owned rAF loop with scheduler subscription and use the
   scheduler timestamp as the shared clock.
3. Combine intersection, document visibility, and window focus into one running
   condition. Draw once and return immediately for reduced motion or `paused`.
4. Pass `paused` to the sidebar `ThinkingOrb` instances in
   `SceneryMotion.tsx`, and replace the sidebar label's infinite opacity
   animation with its fixed resting opacity.
5. Add focused tests for one shared pending frame, the 30 FPS cadence, subscriber
   removal, and cancellation when the last subscriber leaves.

## Boundaries

- Do NOT change orb artwork, presets, state-to-mode mappings, colors, or sizes.
- Do NOT add a package or worker.
- Do NOT change server, desktop IPC, mobile, or provider code.
- Do NOT remove the user's Motion toggle or reduced-motion support.
- If the canvas component no longer owns a simple rAF loop, stop and re-audit
  instead of layering a second scheduler on top.

## Verification

- **Mechanical**: run the new scheduler test, then
  `vp test run apps/web/src/scenery/sceneryMotionContract.test.ts`, web
  typecheck, touched-file lint, and formatting check.
- **Feel check**: with Motion on, confirm the active working orb, scroll pill,
  and hero still move smoothly; sidebar orbs and labels remain legible but
  static. Switch focus away from T3 Pretty and verify renderer/GPU CPU settles
  rather than continuing to repaint. Toggle reduced motion and confirm every
  orb is static.
- **Done when**: there is at most one pending rAF for all orb instances, draws
  are capped at 30 FPS, inactive windows schedule no canvas frames, and the
  sidebar creates no continuous canvas work.
