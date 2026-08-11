# T3 Pretty CPU performance audit

- Date: 2026-08-11
- Installed build: `0.0.34-nightly.20260811.1067000070`
- Source commit: `0027a8a4`
- Machine: Apple M5 Pro, 18 CPU cores, 20 GPU cores, 48 GB RAM
- Active display: 2560×1440 at 240 Hz

## Result

The common 50-60% CPU report is a renderer/GPU problem, not server or provider
orchestration. The dominant source is the fork's thinking-orb animation layer:
each visible canvas had its own uncapped `requestAnimationFrame` loop, so it
repainted at the display's full 240 Hz. One active thread can render the orb in
the timeline and sidebar; parallel working threads add up to 12 more sidebar
canvases. World Scenery's glass surfaces then make those continuous updates more
expensive to composite.

A second, streaming-specific cost came from `SceneryMotion`: its body-wide
`MutationObserver` scheduled a full selector/layout scan for every child-list
mutation, including ordinary streamed Markdown and one-second label updates.

The server, resource monitor, one-shot transitions, and invalidation-driven
terminal canvas did not match the sustained load signature.

## Live evidence

The installed app and source were the same build. Eight one-second `top` samples
while a turn was active showed:

| Process             |                Observed CPU | Interpretation                                       |
| ------------------- | --------------------------: | ---------------------------------------------------- |
| Electron GPU helper |                  65.8-71.8% | Sustained compositing/raster work                    |
| Electron renderer   |                  23.4-34.1% | Animation callbacks, canvas drawing, DOM/layout work |
| T3 server           | 0.1-3.1%, normally below 1% | Not the dominant source                              |
| Resource monitor    |                    0.4-1.9% | Small, bounded contribution                          |
| Electron main       |                    about 0% | Not the dominant source                              |

The two busy helpers together consumed roughly 89-106% of one CPU core during
the sample window. App-level meters may group or smooth helpers differently,
which explains why a user-facing reading can appear closer to 50-60%.

Eight-second native samples showed active `CVDisplayLink`, Chromium compositor,
QuartzCore/IOSurface, and Metal command-queue stacks in the GPU helper. The
renderer sample showed continuous V8/compositor activity. Production Electron
symbols do not identify the originating JavaScript function, so source-level
attribution comes from matching that process signature against the persistent
frame producers below.

## Findings

| Priority         | Source                        | Evidence                                                                          | Verdict                                                                                                                |
| ---------------- | ----------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| HIGH             | `orbs/vendor/ThinkingOrb.tsx` | One independent, uncapped rAF loop per canvas                                     | Primary sustained CPU/GPU source                                                                                       |
| HIGH             | Sidebar orb portals           | Up to 12 persistent working-thread canvases; each duplicated the active animation | Primary multiplicative source                                                                                          |
| HIGH             | `SceneryMotion.tsx` observer  | Every body child-list mutation triggered global queries and layout reads          | Streaming-time renderer amplifier                                                                                      |
| MEDIUM           | World Scenery glass           | 14-24 px backdrop blur on sidebar/header/composer                                 | Static alone is not the source, but raises the cost of continuous descendants/background changes                       |
| LOW, conditional | `ultrathink-*` CSS            | Infinite background-position and hue/filter animations                            | Can add GPU work only when Claude's prompt-controlled Ultrathink treatment is active; it was not active in this sample |

### Why the orb path dominates

The old upper bound was:

```text
visible canvases × display refresh rate
```

On this display, six visible orbs meant up to `6 × 240 = 1,440` canvas paints
per second. The component's `IntersectionObserver` stopped offscreen canvases,
but visible sidebar rows remained active, and `document.visibilityState` did
not stop an unfocused but unobscured Electron window.

Each frame clears the canvas, allocates and sorts dot geometry, emits many 2D
canvas path operations, uploads the changed surface, and asks Chromium to
composite it. The pure geometry math is small; the repeated canvas raster and
surface/compositor work is the costly part, which matches the much higher GPU
helper CPU.

### Why the observer matters during streaming

The observer coalesced mutations to one rAF, but each scheduled sync still:

1. queried every timeline wrapper;
2. read `getBoundingClientRect()` for seen and unseen rows;
3. queried and sorted all timeline rows again to infer the orb verb;
4. searched the working row, scroll pill, hero, and all sidebar status icons;
5. reconciled portal slots.

Streaming Markdown creates frequent child-list mutations without changing any
of those structural targets. Running the full sync for those mutations spent
main-thread time and could force layout before paint.

## Remediation in this change

The patch applies two bounds:

1. All animated orbs share one rAF scheduler capped at 30 FPS. Offscreen,
   hidden, and unfocused windows unsubscribe. Sidebar status orbs render one
   static representative frame, and their labels use a fixed quiet opacity
   rather than an infinite animation. In normal foreground chat the remaining
   upper bound is 30 paints/second for the working row, or 60 if its scroll pill
   is also visible. In the background it is zero.
2. The body observer now ignores text nodes, streamed Markdown descendants,
   portal canvases, timer text, and unrelated chrome. It schedules a sync only
   when an added/removed subtree can change a timeline row, working state,
   approval, scroll pill, hero, or sidebar working icon, or when the observed
   row id/kind attributes change.

This preserves the active orb artwork, verb changes, row-arrival motion,
reduced-motion behavior, focus/accessibility semantics, and the Motion toggle.
It changes no server, wire contract, provider adapter, desktop IPC, or mobile
code.

## Other audited paths

- The Ghostty terminal surface uses rAF as an invalidation queue: it requests a
  frame only after input/resize/dirty state, not continuously.
- Status dots and loading ghosts use stepped/duty-cycled compositor animations.
  They are smaller contributors and the working-row dots are hidden while an
  orb is present.
- Photo fades, drawers, panels, row arrivals, and press feedback are short,
  event-driven transitions. Some animate layout during a 150-200 ms open/close,
  but none explains sustained idle/working CPU.
- The native resource monitor was measured directly and remained around 1%.
- Provider/server work was measured directly and remained near idle during the
  high renderer/GPU readings.

## Verification

- Focused scheduler, mutation-filter, and scenery contract tests.
- Web TypeScript check.
- Touched-file lint and formatting checks.
- Native process and call-stack sampling against the matching installed build.

A final patched-client A/B should compare the same visible thread, working
thread count, window focus, and 240 Hz display state. The target is no scheduled
orb canvas work while unfocused, no animated sidebar canvases, at most one shared
rAF callback, and no more than 30 draws/second per remaining visible animated
orb.
