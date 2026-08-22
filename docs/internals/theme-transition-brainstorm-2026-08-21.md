# Smoothing the dark↔light transition in World Scenery

Brainstorm, 2026-08-21. Problem: with World Scenery active, flipping between
dark and light mode is a harsh 250 ms full-root View Transition crossfade
(`apps/web/src/hooks/useTheme.ts:357-373`, `apps/web/src/index.css:1460-1470`).
Everything dissolves in lockstep at one duration, which is exactly why it feels
abrupt next to the scenery's other motion — especially the fog arrival
(`apps/web/src/scenery/SceneryArrival.tsx`) users already love.

This doc is the output of a divergent ideation pass (five isolated framings:
game design, assumption removal, platform speedrunning, on-call resilience,
biology) followed by scoring, clustering, and code-grounded deepening of the
top three directions. Score chips are `[N novelty · V viability · F fit]`,
each 0–10.

## Constraints that shape every idea

- **No continuously repainting animations.** Finite, compositor-friendly
  motion only (transform/opacity); the fog overlay unmounts at `settled` for
  exactly this reason.
- **`rgb()` with CSS-var channels can't interpolate**, which is why light and
  dark washes are duplicate layers crossfaded by opacity
  (`apps/web/src/scenery/scenery.css:115-158`). Any design either works with
  that pair or hides the swap.
- **Two view-transition paths already exist and are mutually exclusive**: the
  theme swap (`useTheme.ts:380-383`) and the per-thread ink override
  (`apps/web/src/scenery/sceneryInkTransition.ts:62-84`). A third participant
  must join that exclusion or replace it.
- `useInkOverride`'s MutationObserver re-asserts its variant on any
  class/style stomp on `<html>` (`apps/web/src/scenery/useInkOverride.ts:78-94`).
- Three motion gates apply everywhere: OS reduced-motion, the Motion toggle,
  and `.no-transitions`.
- Mobile has scenery but flips instantly with a single wash view
  (`apps/mobile/src/features/scenery/SceneryBackdrop.tsx:79-103`) — whatever
  ships needs at least a decision there.

## The wide set, clustered

### A. Occlusion plays — hide the swap under fog

All five framings independently landed here, which is a strong signal.

- Re-run a shortened fog arrival as the theme's cover: gather ~250 ms, commit
  the palette at peak density, clear ~600 ms. `[N5 V9 F9]`
- Direction-aware tint: going dark = cool dusk fog (`--fog-ink: 20 26 38`),
  going light = warm dawn fog (`246 240 228`). `[N6 V9 F8]`
- Direction-aware motion: to-dark banks roll in from the top, to-light from
  the bottom, by flipping the sign of the existing `--fog-in-y`/`--fog-out-y`.
  Legible peripherally where tint alone is not. `[N7 V8 F8]`
- Name the mood at peak density — "Dusk" / "Dawn" in the arrival copy slot,
  reusing its `aria-live` region, which also gives assistive tech an
  announcement for an appearance change that is currently silent. `[N7 V8 F7]`

### B. Terminator-line plays — the change travels across the scene

- A soft day/night boundary sweeps once diagonally across the viewport
  (~600–800 ms): old theme ahead of the line, new theme behind, ~25 vh
  feathered edge — a planetary shadow crossing a valley. `[N8 V7 F9]`
- Implementation trick: keep the existing theme-swap View Transition, but
  animate `clip-path` on `::view-transition-new(root)` (snapshots are static
  textures, so this is a compositor clip), with a pre-painted oversized
  gradient veil riding ahead of the clip edge via `translate` for the soft
  edge. `[N8 V7 F8]`
- Sweep from the toggle, not a fixed corner: write the clicked control's rect
  into `--terminator-origin` so the user's own click pushes the light across
  the room. `[N7 V8 F8]`
- Grain only in the feather band (multiply the existing `--surface-grain`
  data-URI into the veil's alpha ramp): the boundary reads as thin atmosphere,
  not dirt on the screen. `[N7 V8 F7]`
- Source sets tempo: an automatic `prefers-color-scheme` flip (sunset) runs
  slow ~1.2 s like weather; a deliberate toggle runs ~600 ms like a switch.
  `[N8 V8 F8]`

### C. Layered-clock plays — depth stagger instead of lockstep

- Chrome and glass re-tint fast (~180–250 ms) so the UI feels instantly
  responsive; the scenery wash crossfade takes ~600–900 ms behind it; the
  world catches up. `[N7 V8 F9]`
- The backdrop photo does one finite parallax breath —
  `scale(1) → 1.02 → 1` over ~1 s, zero net displacement — so the crossfade
  has physical weight. `[N6 V9 F8]`
- Accent details (status dots, focus rings) re-ignite last in a short indexed
  stagger, like fireflies after sunset — a payoff beat once the background
  settles. `[N8 V8 F7]`
- Ink lands **last**, not first: wash and edges lead, chrome follows, text
  color arrives once the surface it must be legible on has committed. (See
  the contrast risk below — this ordering is what makes the cluster safe.)
  `[N7 V9 F9]`

### D. Origin plays — the toggle is the light source

- A warm-to-cool bloom expands from the clicked control's coordinates.
  `[N6 V8 F7]`
- Largely subsumed by B's "sweep from the toggle" child; kept separate only
  if the sweep proves too heavy.

### E. Photographic reframing — exposure, not palette

- Dark and light as two exposures of the same moment: an exposure/aperture
  pull (brightness + slight scale breath) instead of a palette dissolve.
  `[N8 V6 F7]`
- Dark adaptation curve: overshoot to near-black for ~180 ms, then bloom back
  in two stages (fast cone recovery, slow rod recovery). The overshoot doubles
  as cover for the wash swap. `[N9 V6 F7]` — also the natural shape for the
  reduced-motion "dip to ink" fallback in cluster A.

### F. Orchestration hygiene — applies to whichever visual wins

- Declarative CSS transitions wherever possible: natively interruptible and
  reversible from any midpoint, no generation counters, no promise plumbing.
  `[N4 V10 F9]`
- Toggle-mash escalation: the third flip inside ~1 s zeroes durations for the
  rest of the burst (reusing `.no-transitions`), decaying after ~2 s of quiet.
  Someone A/B-ing themes wants comparison, not choreography. `[N7 V9 F9]`
- Motion owed on focus: a system flip arriving while `document.hidden`
  commits instantly and stashes a flag; the next focus plays only the photo
  breath and accent re-ignite — never a replayed ink tween, which would lie
  about when the change happened. `[N8 V8 F8]`
- Commit the native chrome at the covered moment too: Electron titlebar and
  `<meta name="theme-color">` flip in the same rAF as the occluded commit,
  otherwise the frame _outside_ the web view is the visible tell no in-page
  animation can hide. `[N7 V9 F8]`
- Transcript opts out by construction: scope re-tint transitions to a curated
  chrome selector list and let transcript rows inherit color from one
  tweening ancestor, so rows mounting mid-flip during streaming arrive
  already-correct instead of each starting a stale tween. `[N7 V9 F9]`

### Traps (attractive, rejected)

- **Dusk-plate photo pairs** (swap to a real dusk photo of the same
  location): needs curated aligned asset pairs across the whole Unsplash
  seed pool. Asset cost is unbounded.
- **`backdrop-filter: invert()` solarize moment**: animated full-screen
  backdrop-filter is per-frame repaint — precisely the GPU spike the
  guardrail bans — and the negative flash is a taste gamble.
- **Theme scrubber** (hold-to-sweep through dusk): interaction machinery for
  a settings toggle used a few times a week. YAGNI.
- **`@property`-driven gradient sunset arc**: interpolating an angle that
  feeds gradient stops repaints the full-screen layers every frame for the
  whole tween. Same guardrail, subtler violation.

## Shortlist

1. **★ Fog-covered swap (A)** — reuses the motion vocabulary users already
   love, makes the un-interpolable palette swap _unobservable_ instead of
   smooth, and can collapse the theme-swap/ink-override mutual exclusion into
   one cover primitive. The non-obvious part isn't the fog — it's that the
   commit happens off-camera, so the hardest rendering problem disappears.
2. **Terminator sweep (B)** — the most cinematic option and the best fit for
   a _landscape_ backdrop; higher platform risk (see below), so it's the
   stretch goal, not the base.
3. **Layered clocks (C)** — the least code and the most honest fix for the
   stated complaint (lockstep at one wrong duration). Also the natural
   _mobile_ answer, since RN has no View Transitions and mobile currently
   hard-cuts.
4. **Hygiene bundle (F)** — ships with any of the above; several items
   (mash escalation, native-chrome timing, transcript opt-out) fix harshness
   users feel today even if no new visual ships.

These compose rather than compete: C is the base layer, A is the deliberate
big-toggle moment on top of it, B is a later upgrade if the platform check
passes, F is non-negotiable hygiene.

## Deepened branches

### 1. Fog-covered swap

**Sketch.** Lift the four-band markup out of `SceneryArrival.tsx`'s overlay
(`SceneryArrival.tsx:314-321`) into a shared `<FogBanks />` and mount a second
consumer under `.scenery-arrival[data-veil="theme"]`, inheriting all the
depth/drift/grain CSS in `scenery.css:406-586` unchanged with only duration
overrides. In `useTheme.ts`, the animated branch calls `runUnderFog(commitTheme)`
instead of `startViewTransition(commitTheme)`: publish phase `fog`, gather
~250 ms, run `commitTheme()` + `syncBrowserChromeTheme()` in one rAF at peak
density, publish `reveal`, clear ~600 ms keeping the existing near→far stagger
ratios. Tint via the existing `data-fog` attribute using the _incoming_
appearance, with dusk/dawn variants. The exclusion problem gets simpler: the
codebase already models "fog covers this, skip the view transition" as
`sceneryArrivalCoversSwap()` (`sceneryArrivalLogic.ts:129-131`), so the ink
path extends its existing bail rather than gaining a third special case.
Reduced motion / Motion-off never mount the overlay.

**Load-bearing risk.** The occlusion premise is currently false: at peak the
banks composite to roughly 0.78 ink at the edges and ~0.58 through the center
— a full palette inversion committed under that flashes exactly where the
user is looking. Raising alphas to opaque changes the beloved arrival (shared
CSS). Secondary: deferring the commit to peak makes `applyTheme` async, so a
mid-veil second toggle or cross-tab storage apply can commit out of order or
strand the overlay with its drift keyframe running.

**First step.** Falsify before building: pin the arrival overlay at peak
(`data-phase="fog"` + `documentElement.dataset.sceneryArrival = 'fog'`),
toggle the theme underneath, capture a frame. Invisible → this is ~40 lines
in `useTheme.ts` plus one CSS block. Flashes → add a
`[data-veil="theme"]`-only opaque plate beneath the banks and retest before
touching `useTheme.ts`.

**Children.** One cover primitive for every occluded commit (theme, ink
flip, wallpaper reshuffle) replacing both view-transition paths; native
chrome committed at the covered moment; directional bank motion
(top-in for dusk, bottom-in for dawn); reduced-motion dip-to-ink (a single
flat 120 ms plate — today's fallback is a hard snap, the harshest version of
the thing being fixed); "Dusk"/"Dawn" label in the arrival copy slot with its
existing `aria-live` wiring.

### 2. Terminator sweep

**Sketch.** Keep the existing theme-swap View Transition and change only what
the snapshot pair does: hold `::view-transition-old(root)` fully opaque and
animate a `clip-path` polygon on `::view-transition-new(root)` so the new
theme wipes in diagonally over ~700 ms — snapshots are static textures, so
the clip is compositor work, not live-DOM repaint. The hard clip edge is
softened by a separate pre-painted ~250%-viewport veil (its own
`view-transition-name`) carrying a static diagonal gradient in the old wash
color multiplied with the `--surface-grain` turbulence already in
`index.css`, translated in lockstep ahead of the clip edge. Nothing animates
mask-position, gradient stops, or filters. Direction and duration live in two
custom properties on `html[data-theme-swap]`; gating reuses
`canAnimateSceneryInkTransition()`, falling back to today's crossfade.

**Load-bearing risk.** `clip-path` animation on a full-viewport snapshot is
only cheap if the engine composites it. Chromium generally does; Safari (and
Chromium under some stacking/blend combinations) can re-clip the full-screen
texture every frame — the exact 120 Hz GPU spike the guardrail exists to
prevent, and at 700 ms it would be nearly three times the duration of the
crossfade it replaces.

**First step.** A one-file, zero-DOM spike: edit `index.css:1460-1470` in
place (old snapshot `animation: none; opacity: 1`; new snapshot gets the
700 ms clip sweep), then flip the theme with paint-flashing and the frame
chart open on both Chromium and Safari. Ten minutes kills or confirms the
whole idea.

**Children.** Sweep origin from the clicked toggle's rect (defaulting to a
corner for palette/keybinding entry points); a transform-only Safari fallback
that sweeps just the duplicated wash pair via the counter-translate
mask-window trick; grain confined to the feather band; source-sets-tempo
(automatic flips run slow like weather, deliberate toggles run fast like a
switch); if the sweep proves cheap, reuse it for scenery photo swaps on
thread switch, collapsing two transitions into one vocabulary.

### 3. Layered clocks

**Sketch.** Delete the full-root snapshot path in the animated branch of
`applyTheme` and stop adding `.no-transitions`; set `data-theme-flip` on the
root, commit the palette synchronously, and let existing DOM layers tween on
their own clocks. The wash needs no new machinery: the dark/light wash pair
already crossfades on opacity vars (`scenery.css:126-133`) once the parking
rules at `scenery.css:164-167` stop zeroing it — give it ~280–350 ms. Chrome
and text re-tint without View Transitions because although the palette _vars_
can't interpolate, the computed `color`/`background-color`/`border-color` of
elements consuming them can: `html[data-theme-flip]` enables ~180 ms tint
transitions on a curated chrome selector list (never `*`, which would repaint
every transcript node). The photo group gets one finite
`scale(1) → 1.02 → 1` keyframe (~1 s, compositor-only). Accents re-ignite
last via `transition-delay` 260/320/380 ms. Cleanup is one timeout at the
longest clock; `document.hidden` keeps the hard-cut; re-toggling mid-flight
reverses natively from current computed values — no generation counter, and
both view-transition branches collapse into nothing.

**Load-bearing risk.** Split clocks split contrast: if ink flips in 180 ms
while the legibility wash is still hundreds of ms from finishing, there's a
window of dark text on a still-dark wash over a dark photo — unreadable, and
it lands on the transcript during streaming. The current lockstep dissolve
exists partly because it makes that window impossible. The wash must be
treated as contrast-critical (fast, coupled to ink, or ink delayed until the
wash commits); the slow clocks are reserved for layers carrying no legibility
load (photo breath, edge tints, accent stagger).

**First step.** Deletion first: remove the wash-parking rules in
`scenery.css` and the `.no-transitions` add in the animated branch, flip the
theme, and observe whether the wash pair already crossfades acceptably on its
own. If yes, the feature is a clock table plus one data attribute; if it
flickers or double-fades, that constraint surfaces before any orchestration
code exists.

**Children.** Ink-last stagger ordering (dissolves the contrast risk by
construction); toggle-mash escalation; motion-owed-on-focus (photo breath
only — replaying the ink tween would misreport when the change happened);
transcript correctness by inheritance from a single tweening ancestor;
publish the clock table as tokens (`--flip-wash-ms`, `--flip-chrome-ms`, …)
so the arrival, ink transition, and this flip stop fighting with
independently hand-tuned durations — but only after the first step proves
the layers can self-animate.

## Recommended sequence

1. **Layered clocks + hygiene bundle** — smallest diff, fixes the actual
   complaint, deletes two view-transition coordination paths, and its
   deletion-first spike is nearly free. Mobile gets the same model (wash
   crossfade + photo breath) with Reanimated-free `expo-image`/opacity
   timing.
2. **Fog-covered swap** layered on top as the deliberate-toggle moment, once
   the occlusion spike passes (or the opaque plate variant is accepted).
3. **Terminator sweep** as the flagship upgrade if — and only if — the
   ten-minute Safari/Chromium compositor spike stays clean.

## Provocation

The scenery knows what time it is. If the OS reports "system" scheme, the
flip usually happens at sunrise/sunset — the one moment a _slow, ambient_
terminator crossing the landscape is not decoration but truth. What if the
deliberate toggle stays fast and utilitarian, and the once-a-day automatic
flip is the only place the cinematic version ever plays — an event rare
enough to stay special, like the fog arrival was?
