# T3 Pretty macOS and iOS performance audit

- Date: 2026-08-12
- Scope: desktop host, web renderer used by desktop, mobile thread UI, shared
  client reducer, server projection, and native resource telemetry
- Goal: reduce idle energy, streaming main-thread work, allocations, and
  pathological payload cost without removing user-visible behavior

This is a source-led follow-up to the
[CPU performance audit](./t3-pretty-performance-audit.md), which identified and
bounded the fork's continuously animated orb and scenery work. The earlier fix
removed the dominant sustained foreground GPU load. This pass concentrates on
hidden-window energy, active-output smoothness, recording memory, and long
session scaling across macOS and iOS.

## Result

The patch bounds eight independent sources of repeated or cumulative work:

| Surface          | Hot path                     | Previous behavior                                                                                        | New bound                                                                                                                |
| ---------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| macOS            | Hidden main window           | Chromium background throttling was disabled permanently                                                  | Normal hidden work throttles; an active PiP/recording source temporarily holds an explicit exemption                     |
| macOS            | Preview recording and PiP    | JPEG bytes became base64, crossed IPC as a string, then became a data URL and decoded again              | IPC carries bytes; recording decodes one frame at a time and keeps only the newest pending frame; PiP keeps one blob URL |
| Desktop renderer | Local backend discovery      | Every hook consumer owned a 2-second poller and fresh equivalent arrays triggered renders                | One shared, visibility-aware external store with stable snapshots and one poller                                         |
| Desktop host     | Resource telemetry           | The native process sampler ran every second on AC even when diagnostics had no subscribers               | Five-second background cadence, one-second live diagnostics, existing 15-second constrained cadence                      |
| Web and shared   | Streaming messages           | Markdown and message/checkpoint updates repeated cumulative scans and allocations                        | Deferred markdown parse behind a memo boundary; reverse lookup and single-slot copy with stable unrelated identities     |
| Server           | Tool activity projection     | Huge output was split/normalized in full and changed-file discovery could traverse arbitrary collections | 64 KiB text, 256 MCP block, and 512 traversal-node budgets with direct file fields prioritized                           |
| iOS              | Streaming assistant Markdown | Every delta reparsed the full growing message and scheduled fenced-code highlighting                     | Latest text commits at a 64 ms cadence; code remains exact plain text while streaming and highlights once settled        |
| iOS              | Feed derivation and tracing  | Every delta remapped/resorted all messages and started an Effect/OTLP span                               | Identity-aware row reuse plus one span per environment/thread in a two-second window                                     |

No message content, Markdown feature, recording mode, PiP mode, diagnostics
screen, provider behavior, or remote connection mode was removed.

## macOS desktop findings

### Hidden-window work

The main `BrowserWindow` set `backgroundThrottling: false`, while macOS keeps the
application alive when the window is hidden or minimized. That made ordinary
renderer timers and paint work eligible to continue at foreground cadence.

The main window now uses Chromium's normal background throttling. Preview
capture is the exception: recording and PiP need the hidden guest to keep
producing frames. A per-tab capture session disables throttling only on the
current source guest, shares that lease between recording and PiP, transfers it
when the webview is replaced, and restores the guest's previous value after the
last consumer stops.

### Recording and PiP allocation path

The old 12 FPS capture path JPEG-encoded a full guest page, expanded it to
base64, copied the string over IPC, constructed a data URL, decoded it, drew it
to a canvas, and then asked `MediaRecorder` to encode the canvas. PiP performed
a similar data-URL decode.

Frames now cross the typed IPC contract as `Uint8Array`. The recording renderer
creates a JPEG `Blob` and uses `createImageBitmap`; it allows one decode in
flight and one latest pending frame, dropping obsolete intermediate work. Every
bitmap is explicitly closed. PiP revokes the prior blob URL when a newer frame
arrives and revokes the current URL after decode or unload. The existing shared
capture session and 12 FPS ceiling are unchanged.

### Repeated desktop topology polling

Local backend topology had no push event, so every consumer created its own
interval and state. The replacement `useSyncExternalStore` source performs an
initial guarded read, shares one interval, structurally compares every
bootstrap field, preserves snapshot identity for equivalent reads, sleeps while
the document is hidden, refreshes immediately on visibility return, and stops
after the last subscriber leaves.

## iOS findings

### Cumulative Markdown and code work

An assistant stream supplies the complete growing message on every delta. The
native selectable Markdown bridge reparsed that entire prefix and rebuilt its
native runs each time. A fenced code block also keyed and scheduled async
highlighting by the complete changing prefix, allowing many obsolete promises
to overlap.

Only streaming assistant text is now cadenced. The cadence keeps the newest
transport value, publishes at most once every 64 ms, and flushes the exact final
text in the settling render. Historical settled messages mount the direct
renderer with no cadence state or effects. Native fenced code is selectable
plain text during the stream; the cache key and async highlighter are not
created until the final settled value.

### Telemetry amplification

Feed derivation telemetry depended on the rebuilt feed/detail objects, so a
streaming delta could start a new Effect span and exporter path. A small keyed
LRU gate now preserves representative measurements while bounding runtime and
export work to one span per thread per two seconds.

### Feed derivation

The message reducer now preserves untouched object identity, but feed derivation
previously discarded that advantage by mapping and sorting the entire message
collection on each delta. A per-screen builder now caches sorted wrappers and
their indexes, replaces only identity-changed rows, and skips sorting for source
arrays already in chronological order. It deliberately falls back to full
stable assembly for activity changes, inserts/removals, source reorder,
timestamp correction, loaded-window boundary changes, and empty-message
visibility transitions.

In a synthetic 5,000-message, 250-delta builder loop, this reduced median work
from 1.61 ms to 0.198 ms and p95 from 2.07 ms to 0.494 ms. These are isolated
builder timings, not end-to-end frame timings.

## Shared and server findings

Streaming message updates previously searched and mapped the whole message
array. They now search from the newest end, copy the array once, replace one
message, and preserve every unrelated message object. Checkpoint rebinding also
searches from the newest end, returns the original collection when already
bound, and copies only the matching slot.

Activity projection previously performed full `split`/normalization work just
to retain an 84-character tool summary. MCP text blocks were collected and
joined in full, and changed-file traversal had depth/result limits but no work
budget. The bounded scanners preserve the first useful line, whitespace and
truncation semantics, stdout fallback, cyclic/deep safety, and direct changed
file fields. Top-level item-less MCP input is no longer shipped after file paths
are projected; current clients do not render that field, and it was another
unbounded payload route.

In a read-only in-process synthetic loop, a 10.32 MB line-rich tool output
improved from 3.347 ms median / 4.037 ms p95 to 0.503 ms median / 0.998 ms p95.
A 10 MB single-line case improved from 2.897 ms median to 0.108 ms median. These
numbers isolate projection only; they are not end-to-end application timings.

## Deliberately deferred work

The audit found larger changes that should not be folded into a low-risk hot
path patch without dedicated lifecycle and runtime validation:

- Composer images still keep base64 in draft and outbox JSON. The durable fix
  is URI-backed app-owned attachment storage with encoding only at dispatch,
  plus explicit cleanup across remove, send, retry, and failure. Changing that
  lifecycle casually risks losing offline drafts or queued sends.
- Every preview tab retains a real Chromium guest so offscreen automation keeps
  working. A dormant/LRU policy must exclude active automation, recording, and
  PiP and wake before any CDP command.
- Several mobile route/composer wrappers still have broad subscriptions.
  Granular atoms and container isolation need fallback and render-count
  coverage before changing their data ownership.
- Shell projection is coalesced per WebSocket client, but multiple clients can
  repeat the same reads and each client rebuilds shell indexes. A shared
  projection generation would require multi-client ordering tests.

## Verification

- Frozen offline install, including validation of the committed LegendList
  patch metadata.
- Focused desktop, web, mobile, shared reducer, server telemetry/projection, and
  IPC tests.
- Mobile, contracts, client-runtime, and desktop TypeScript checks.
- Production web build and desktop server bundle build.
- Mobile native static checks.
- Targeted formatting, lint, and diff checks.

The repository's full web and server typechecks still report unrelated existing
errors outside the touched paths. No app, browser, or simulator was launched in
this source pass, so an installed-build A/B remains the final runtime proof.
That comparison should separate settled, active-output, and p95 windows; record
renderer, GPU helper, server, and resource-monitor PIDs independently; and
repeat identical message, window visibility, recording/PiP, and display-refresh
conditions before and after.
