# T3 Pretty macOS architecture and performance deep dive

- Date: 2026-08-15
- Installed build: `0.0.34-nightly.20260816.1105000183` (Electron 41.5 / Chromium 146 / Node 24.15)
- Source: `6c9ea1fb2` (same lineage as the installed build; asar contents match HEAD)
- Machine: Apple M-series, 18 cores, 48 GB; display 2560×1440 @ 240 Hz at **1× DPR**;
  main window ≈ 1760×959 CSS px during sampling
- Scope: macOS desktop only — Electron shell, renderer, local server, packaging, wire
- Goal: understand what the app actually costs on macOS and lay out how to make it as
  lightweight and efficient as possible while keeping its features

This is the third performance pass. The first two ([CPU audit](./t3-pretty-performance-audit.md),
[macOS/iOS audit](./t3-pretty-macos-ios-performance-audit-2026-08-12.md)) fixed hot paths (orb
rendering, scenery mutation scans, hidden-window throttling, recording frames, tool-output
projection budgets). This one is wider: process model, startup, memory, packaging, persistence,
wire volume, and idle work. It combines live measurement of the running installed app with six
independent source sweeps (desktop shell, renderer JS runtime, GPU/compositor, server runtime,
bundle/packaging, wire protocol). Every claim is tagged **MEASURED** (from the live process,
the developer's data directory read-only, or the installed asar) or **INFERRED** (from source).

## Headline

The app is not slow because of one hot loop any more. It is heavy because of accumulation:

1. **Ships ~5× more bytes than it runs.** 455 MB `.app`; the 211 MB `app.asar` is 41 % source
   maps and 63 % `node_modules`, most of which is never `require`d. The renderer parses ~7.2 MB
   of JavaScript on every launch — 1.5 MB of it is Clerk, another ~1.3 MB is Settings/PR/CodeMirror
   that could be routed lazily — and V8's code cache is disabled for the app scheme, so nothing
   is reused between launches.
2. **Startup is serialized behind the server.** The window is created only after the server child
   answers HTTP (**1.7–1.8 s measured**), the main process spends ~0.4 s resolving ~485 externalized
   modules out of the asar, and a login-shell probe (85–100 ms) runs serially before anything else.
3. **The event store persists streaming progress as durable history.** 388,819
   `thread.activity-appended` events (952 MB) and 307,848 `tool.updated` projection rows (533 MB) for
   235 threads — about 26 rows per tool call, each a cumulative snapshot. `state.sqlite` is 2.8 GB
   and grows 5–8 KB per progress tick. Compaction is read-side only, so the visible history window
   is silently truncated to ~18 tool calls for ACP threads.
4. **Always-on diagnostics cost as much as the work.** Every Effect span (≈85 per orchestration
   event, ≈3 per streamed Claude token) is serialized to `server.trace.ndjson` at
   ~100–145 KB/s during turns; provider logs add another 522 MB on disk. That overhead is on the
   order of the server's entire measured CPU.
5. **The renderer redoes work per delta.** Because `markdownComponents` is rebuilt per streamed
   delta, react-markdown remounts the whole streaming message DOM and re-highlights every fenced
   block; shell-only components subscribe to whole-thread state; the server re-sends the full
   thread shell (2.4 KB) to every client on every message/activity event.
6. **Memory is baseline, not data.** Server: 158 MB footprint with an empty database (JS heap
   44 MB), 199 MB live. Renderer: 326 MB, ~255 MB of it V8-tagged. GPU helper: 320 MB, of which
   ~190 MB is an unattributed Metal pool; the fork's biggest lever there is the wallpaper, decoded at
   screen width (17.5 MB RGBA per photo, one per thread) instead of window/blur-appropriate width.

The plan in [§5](#5-efficiency-plan) removes most of this without dropping a feature.

## 1. Live footprint (MEASURED)

Sampled while a turn was streaming into the app (Claude, this repo).

| Process                  | phys_footprint |   peak |      RSS |          CPU during turn | Notes                               |
| ------------------------ | -------------: | -----: | -------: | -----------------------: | ----------------------------------- |
| Electron main            |         139 MB | 175 MB |   193 MB |                   ~0.1 % | Effect runtime, protocol proxy, IPC |
| GPU helper               |     320–334 MB | 641 MB | 81–96 MB |      7–11 % (burst 55 %) | see §1.2                            |
| Renderer                 |         326 MB | 479 MB |   569 MB |   6–9 % (bursts 25–33 %) | see §1.3                            |
| Server child (`bin.mjs`) |         199 MB | 246 MB |   231 MB | ~0.5 % (one 26 % second) | Electron-as-Node                    |
| Network service          |          11 MB |  15 MB |    52 MB |                     ~0 % |                                     |
| `t3-resource-monitor`    |          10 MB |  10 MB |    10 MB |                     ~0 % | Rust sidecar                        |
| `cloudflared tunnel run` |              — |      — |    32 MB |                     ~0 % | only when the tunnel is enabled     |

Total ≈ 1.0 GB physical footprint for one window, one thread open, no preview webviews.

### 1.1 Server baseline vs. data

Booting the installed `bin.mjs` against an empty scratch home (`--base-dir /tmp/…`,
`ELECTRON_RUN_AS_NODE`) reaches "Listening" in **0.83 s** and settles at **158 MB footprint /
285 MB RSS with heapUsed = 44 MB, external = 11 MB**. So ~80 % of the live server's 199 MB is
runtime baseline: Electron's Node binary pages, the 7 MB unminified bundle, Effect Schema ASTs
built at import (`effect-codex-app-server` 886 KB, `effect-acp` 313 KB of generated schema
source), and native libraries loaded at boot — `sharp` + `libvips-cpp` (15.3 MB dylib),
`@yuuang/ffi-rs` (for `@ff-labs/fff-node`), `msgpackr-extract`, `node-pty` — all present in the
idle process's memory map.

### 1.2 GPU helper composition

`vmmap --summary` of the GPU helper: `owned unmapped (graphics)` **190.5 MB** in 84 Metal
regions (37 of exactly 4 MiB — a sub-allocated pool that vmmap cannot attribute), IOSurface
**51 MB** in 59 surfaces, IOAccelerator 23 MB, App-Specific Tag 14 23 MB. The IOSurface set is
exactly the compositor's tiles + swap chain for a 1760×959 window (3 × 6.6 MB swap chain,
4 × 1.7 MB root tiles, two content/scroll layers with ~2.5 viewports of prepaint, one 240 px
sidebar scroller). Only one `--type=renderer` process existed, so no `<webview>` guest was
contributing. Peer Electron GPU helpers on the same Mac: Notion 239 MB, Codex 160 MB, Spotify
110 MB — T3 Pretty is highest but a visible Chromium-146/Graphite window has a floor well above
100 MB; a realistic target is 150–200 MB, not <100.

Native sampling of the GPU helper during a turn shows CVDisplayLink/Metal activity but production
Electron symbols do not attribute further (same limitation as the first audit).

### 1.3 Renderer composition

`vmmap`: App-Specific Tag 16 (V8) **254.8 MB dirty**, Tag 14 (Blink/PartitionAlloc) **73.7 MB**,
mapped files 6 MB. The JS heap and compiled code dominate. INFERRED composition (renderer sweep):
Chromium/V8/React baseline for this bundle 110–150 MB; `@pierre/diffs` worker pool
(2–6 dedicated workers, each with its own Shiki + oniguruma wasm) 40–120 MB plus up to ~100 MB
of AST caches after diff use; Ghostty terminal wasm memory (monotonic, never shrinks, up to 44
mounted terminals) 10–120 MB; resident thread windows (5-minute idle TTL) 15–60 MB; highlight
cache ≤ 25 MB; composer drafts with base64 images 0–50 MB.

### 1.4 Data directory

| Item                                            |           Size | Composition                                                                                                                                                                                             |
| ----------------------------------------------- | -------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state.sqlite`                                  |         2.8 GB | `orchestration_events` 1,282 MB (405,092 rows), `projection_thread_activities` 1,045 MB (365,759 rows), `orchestration_command_receipts` 78 MB (404,572 rows), indexes ~400 MB                          |
| — by event type                                 |                | `thread.activity-appended` 388,819 events / 952 MB (avg 2.5 KB); everything else < 5 MB combined                                                                                                        |
| — by activity kind                              |                | `tool.updated` 307,848 rows / 533 MB (avg 1.8 KB); `tool.completed` 30,126 / 307 MB (avg 10.7 KB); `tool.started` 11,687; `context-window.updated` 13,646                                               |
| — per thread                                    |                | largest thread 46,018 activities / 104 MB payload; 8 threads > 14,000 activities                                                                                                                        |
| `logs/server.trace.ndjson*`                     | 100 MB rolling | 10 MB file rotates every ~60–100 s during turns                                                                                                                                                         |
| `logs/provider/`                                |         522 MB | raw SDK/ACP NDJSON per thread, 10 MB × 10 per thread, 512 MB / 14 d cap                                                                                                                                 |
| `logs/desktop.trace.ndjson*`                    | 100 MB rolling | ~10 MB per 2h40m                                                                                                                                                                                        |
| Chromium profile (`Application Support/t3code`) |         2.1 GB | HTTP cache 680 MB (mostly the app's own `/api/assets/*` attachment PNGs, several cached 2–3× under different tokenized URLs), preview partitions 642 MB, `app-backups` 839 MB, **`Code Cache/js` 8 KB** |

That last number is the tell for §3.1: the V8 code cache is effectively empty.

### 1.5 Installed bundle

| Item                                                                                                     |                                                                                                                                           Size |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------: |
| `T3 Pretty (Nightly).app`                                                                                |                                                                                                                                         455 MB |
| Electron Framework                                                                                       |                                                                                                                                         214 MB |
| `app.asar`                                                                                               | 211 MB packed, 14,744 files (+25 MB unpacked natives); header 3.84 MB JSON parsed by every Node process that touches it (11.7 ms, 6.8 MB heap) |
| — `*.map`                                                                                                |                                                                         84.7 MB (44.9 web client, 18.8 server, 2.8 desktop, 18.2 node_modules) |
| — `node_modules/effect`                                                                                  |                                                                                  33.5 MB (16.6 MB `src/*.ts`, 5 MB `httpApiScalar/Swagger.js`) |
| — Clerk tree (`@clerk/clerk-js`, shared, react, zxcvbn, query-core, lodash, core-js, crypto-js, stripe…) |                           24.5 MB, ~6,700 files — pulled by `@clerk/electron`; the main process only needs `electron`/`electron-store` from it |
| — shiki/pierre tree                                                                                      |                                                                                             21 MB — server dep, already bundled into `bin.mjs` |
| — `@img/sharp-libvips-darwin-arm64`                                                                      |                                                                                                                                        15.3 MB |
| — `playwright-core`                                                                                      |                                                                                   10.2 MB — one 3.1 MB text file (`lib/coreBundle.js`) is read |
| — `@anthropic-ai/claude-agent-sdk`                                                                       |                                                                                            4.8 MB — bundled into `bin.mjs`; the copy is unused |
| Web client (`apps/server/dist/client`)                                                                   |                         19.4 MB JS in 396 chunks; entry `index-*.js` 6.2 MB minified / 2.0 MB gzip; eager critical path 7.2 MB JS + 414 KB CSS |
| Server bundle `bin.mjs`                                                                                  |                                                        7.0 MB unminified (3.9 MB minified in a test); `Schema-*.mjs` 1.0 MB (0.18 MB minified) |
| Desktop `main.cjs`                                                                                       |                   1.27 MB unminified; externalizes `effect`, `@effect/platform-node`, `electron-updater`, `@clerk/electron`, `playwright-core` |

## 2. How it runs on macOS

```
launchd → Electron main (main.cjs, Effect runtime)
           ├─ registers t3code:// scheme, proxies every asset request via net.fetch → server HTTP
           ├─ spawns server child: process.execPath bin.mjs --bootstrap-fd 3 (ELECTRON_RUN_AS_NODE)
           │    ├─ SQLite (node:sqlite, sync on the main thread), event store, projectors, WS RPC
           │    ├─ spawns t3-resource-monitor (Rust), cloudflared (opt), provider CLIs, PTYs
           │    └─ Claude runs in-process via @anthropic-ai/claude-agent-sdk (spawns `claude`)
           ├─ waits for server HTTP readiness, THEN creates BrowserWindow(t3code://app/)
           ├─ renderer: React 19 + @effect/atom-react; WS direct to ws://127.0.0.1:<port>/ws
           │    ├─ subscribeShell (all threads' metadata) + subscribeThread per open thread
           │    ├─ LegendList virtualized timeline; react-markdown + shiki; @pierre/diffs workers
           │    ├─ Ghostty terminal (wasm); CodeMirror (settings editor); Lexical (composer)
           │    └─ World Scenery: photo layer + backdrop-blur sidebar/header/composer
           ├─ <webview> guest per preview tab (each = renderer + GPU surfaces + CDP session)
           └─ GPU helper, network service, PiP panel window (on demand)
```

### 2.1 Startup timeline (MEASURED from `desktop.trace.ndjson`, three launches)

| Phase                                                   |                                               Time | Evidence                                                                                                                                                                                                              |
| ------------------------------------------------------- | -------------------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron boot + `main.cjs` + externalized `require`s    | ~400 ms class (485 modules under plain Node, warm) | `apps/desktop/vite.config.ts:51-53` bundles only `@t3tools/*`; biggest: `@effect/platform-node/NodeHttpClient` (undici, 159 ms), `electron-updater` (51 ms), `@clerk/electron/storage` → electron-store → ajv (44 ms) |
| Layer build (~30 layers) then `startup`                 |                                         146–159 ms | `DesktopApp.ts:221-291`; `DesktopTelemetryPublisher.make` awaits `app.whenReady()` inside layer construction (`DesktopTelemetryPublisher.ts:139`)                                                                     |
| — of which login-shell PATH probe, serialized first     |                            85–100 ms (5 s timeout) | `DesktopApp.ts:235`; `DesktopShellEnvironment.ts:340-341`                                                                                                                                                             |
| `bootstrap` (port scan, protocol register)              |                                           18–29 ms |                                                                                                                                                                                                                       |
| **Wait for server child HTTP readiness**                |                                 **1,682–1,841 ms** | `DesktopBackendPool.ts:292-300` → `DesktopWindow.ts:857-861` (`createMainIfBackendReady`)                                                                                                                             |
| `createMain` (incl. preview `session.fromPartition`)    |                                          49–113 ms | `DesktopWindow.ts:321`                                                                                                                                                                                                |
| Renderer load: 7.2 MB JS + 0.4 MB CSS through the proxy |                                         not traced | `index.html` modulepreloads `utils` (697 KB), `entities` (273 KB); no code cache (§3.1)                                                                                                                               |
| Server child, empty DB, to "Listening"                  |                                             830 ms | scratch-home boot                                                                                                                                                                                                     |

The blank window at launch is dominated by the server wait, which exists only because the
renderer's static assets are proxied from the server (`ElectronProtocol.ts:139-186`).

### 2.2 Data flow during a turn (source-verified)

Provider CLI → adapter → `ProviderRuntimeEvent` → `ProviderRuntimeIngestion` → command →
`OrchestrationEngine` (single worker fiber; one SQL transaction: append event, in-memory
projector, projection pipeline of 9 projectors each in its own SAVEPOINT + `projection_state`
upsert, receipt upsert) → unbounded `PubSub` → per-subscription filters in `ws.ts` →
Effect RPC stream chunk → per-client Schema encode + `JSON.stringify` + permessage-deflate → renderer
`JSON.parse` + Schema decode on the main thread → 50 ms client-side coalescer → atom families →
React. Assistant text is buffered by default (`enableLegacyTokenStreaming` false, spill at
24,000 chars), so per-token deltas do not hit the DB; tool progress does (§3.5).

## 3. Findings

Severity is impact on the macOS desktop user. **Fork** = introduced by T3 Pretty; **Upstream** =
inherited from T3 Code (candidate to upstream). S/M/L = effort.

### 3.1 Startup, bundle, packaging

| #   | Sev  | Origin                        | Finding                                                                                                                                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                     |
| --- | ---- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | HIGH | Upstream                      | V8 code cache disabled for the app: `t3code://` scheme registered without `codeCache: true`; `Code Cache/js` is 8 KB. Every launch re-parses/compiles ~7.2 MB. Static handler sends no `Cache-Control`/`ETag` (global gzip middleware does apply), and custom-scheme responses bypass the HTTP cache anyway.                                                                                           | `apps/desktop/src/electron/ElectronProtocol.ts:112-131`; `apps/server/src/http.ts:366-377`; `server.ts:523`                                  |
| A2  | HIGH | Upstream                      | Window creation gated on server HTTP readiness (1.7–1.8 s) because assets are proxied from the server.                                                                                                                                                                                                                                                                                                 | `DesktopBackendPool.ts:292-300`, `DesktopWindow.ts:857-861`, `ElectronProtocol.ts:139-186`                                                   |
| A3  | HIGH | Upstream                      | `@clerk/clerk-js` (1.41 MB + 0.11 MB clerk/react/shared) in the entry chunk for every user, via top-level `import { ClerkProvider } from "@clerk/electron/react"`; the package has no `sideEffects` field so nothing is shaken. Non-Electron builds ship it and never execute it.                                                                                                                      | `apps/web/src/main.tsx:3-5`; `@clerk/electron/dist/esm/react/index.js:4`                                                                     |
| A4  | HIGH | Upstream                      | No route-level code splitting: `tanstackRouter()` without `autoCodeSplitting`; 7 `React.lazy` sites total. Eager in entry: `settings/*` 453 KB, CodeMirror + lezer + markdown editor 492 KB (used only by `AgentInstructionsSettings`), `pullRequest/*` 151 KB, jszip + openVsx 106 KB, `LegacySidebar` 58 KB (both sidebars shipped), `JetBrainsIcons` 35 KB, terminal glue 88 KB.                    | `apps/web/vite.config.ts:159`; `AppSidebarLayout.tsx:12-13`; `OpenInPicker.tsx:45`; `AgentInstructionsSettings.tsx:55`                       |
| A5  | HIGH | Upstream                      | Main process externalizes `effect` & co: 311 files / 5 MB from `effect` + `@effect/platform-node`, 724 files / 7.6 MB total (undici 1.24 MB, fast-check 363 KB via `effect/Schema` → `testing/FastCheck`, ajv) loaded from the asar at boot; 160–190 ms measured equivalent. Root `import { Schema } from "effect"` barrels in contracts add ~54 files.                                                | `apps/desktop/vite.config.ts:51-53`; `packages/contracts/src/{previewAutomation.ts:1,canvas.ts:12,preview.ts:11}`                            |
| A6  | HIGH | Upstream                      | Source maps packaged everywhere (84.7 MB, 41 % of asar) with no runtime consumer (no `source-map-support`, `--enable-source-maps`, Sentry). Also 64 MB of maps in the published `t3` npm package.                                                                                                                                                                                                      | web `vite.config.ts:56-72,260-263`; server `vite.config.ts:41`; desktop `:46,59,73,83`; `build-desktop-artifact.ts:792-802`                  |
| A7  | HIGH | Upstream                      | Mac stage `package.json` lists **all** server deps + desktop deps and runs `vp install --prod`, although `bin.mjs` bundles them; Windows uses the runtime-externals list. Result: shiki/pierre 21 MB, claude sdk 4.8 MB, yaml… installed for nothing. `@clerk/electron` external in `main.cjs` drags the 24.5 MB / 6.7k-file clerk-js tree; `react-grab` (2.4 MB) is already bundled into the preload. | `build-desktop-artifact.ts:2960-2971` vs `:2742,:3050`; `apps/desktop/vite.config.ts:52,77`                                                  |
| A8  | MED  | Upstream                      | Server and main bundles unminified (JSDoc inlined): 7.0 → 3.9 MB and 1.27 → 0.63 MB in a minify test; no `module.enableCompileCache()`; server spawned with no Node flags.                                                                                                                                                                                                                             | server `vite.config.ts:38-52`; desktop `:41-55`; `DesktopBackendConfiguration.ts:400-408`                                                    |
| A9  | MED  | Fork (sharp) / Upstream (fff) | `sharp` statically imported by `AttachmentPreview.ts` (reached from `ProjectionPipeline.ts:57` for a path helper) → libvips dlopen'd at every server boot; `@ff-labs/fff-node` (ffi-rs) likewise via `WorkspaceSearchIndex`.                                                                                                                                                                           | `apps/server/src/assets/AttachmentPreview.ts:8`; `workspace/WorkspaceSearchIndex.ts:1-11`                                                    |
| A10 | MED  | Upstream                      | Boot-time provider probes spawn CLIs (`claude --version` is a Node boot, `cursor agent about`, `kimi`, `grok`) with `forceRefresh: true` at construction.                                                                                                                                                                                                                                              | `makeManagedServerProvider.ts:234-237`                                                                                                       |
| A11 | MED  | Upstream                      | `@pierre/diffs` worker pool (2–6 workers; 6 on this machine) is created at `ChatView` mount: each parses the 814 KB worker + 456 KB oniguruma wasm before any diff is shown. Oniguruma wasm is embedded as base64 twice (main-thread `wasm-*.js` 608 KB, worker 814 KB) plus a `.wasm` file.                                                                                                           | `DiffWorkerPoolProvider.tsx:48-58`; `ChatView.tsx:6963-6968`                                                                                 |
| A12 | MED  | Upstream                      | Eager externals in main: undici (via `NodeHttpClient.layerUndici`), `electron-updater` at import, `@clerk/electron/storage` (electron-store/conf/ajv). Login-shell probe serialized at the head of `startup`. Preview `persist:` session created at window creation. Dock icon PNG decoded twice. Updater polls every 4 min.                                                                           | `main.ts:238`; `ElectronUpdater.ts:7`; `DesktopClerk.ts:1-2`; `DesktopApp.ts:235,271,286`; `DesktopWindow.ts:321`; `DesktopUpdates.ts:45-46` |
| A13 | LOW  | Fork                          | `ActiveScenery` chunk is 423 KB, of which 401 KB is `seedPool.json` (377 photos) inlined as a JS literal; `getSceneryPool()` rebuilds a 377-entry Map per call. Lazy, but parsed into heap whenever scenery is on (the default look).                                                                                                                                                                  | `apps/web/src/scenery/catalog.ts`, `seedPool.json`, `sceneryStore.ts:105-114`                                                                |
| A14 | LOW  | Upstream                      | `prod-resources` (icons, dmg art, monitor binary copy) duplicated in the asar; `playwright-core` 10 MB for one 3 MB text file; asar integrity hashes computed but no fuse validates them (3.8 MB header).                                                                                                                                                                                              | `build-desktop-artifact.ts:2913-2914,2104-2119`; `PlaywrightInjectedRuntime.ts:96,175`                                                       |

### 3.2 Desktop shell (main process) at steady state

| #   | Sev | Origin   | Finding                                                                                                                                                                                                                                                                                                                               | Evidence                                                                                   |
| --- | --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| B1  | MED | Upstream | Renderer issues **2 synchronous IPC calls every 3.00 s forever** (`Stream.tick("3 seconds")` → `ipcRenderer.sendSync getLocalEnvironmentBootstraps`), not visibility-gated, each producing 5 trace records. Sync IPC stalls the renderer whenever main is busy (recording, CDP bursts).                                               | `apps/web/src/connection/platform.ts:364,570`; `desktopLocal.ts:66-80`; `preload.ts:42-48` |
| B2  | MED | Upstream | Every preview tab keeps a live CDP session with `Runtime`, `Accessibility`, `Network`, `Log` enabled from `registerWebview` for its lifetime; each CDP message forks a fiber; `diagnostics.requests` copied per network event. Hidden guests are kept mounted at −100000 px (deferred LRU policy from the previous audit still open). | `preview/Manager.ts:1072,1031-1033,866-921,1924`; `ElectronBrowserHost.tsx:20-36,79-96`    |
| B3  | MED | Upstream | Recording/PiP: full-res `capturePage()` + `toJPEG` on the main thread at 12 fps; frames broadcast to **all** windows via `sendAll`.                                                                                                                                                                                                   | `Manager.ts:2406-2460`; `ipc/methods/preview.ts:40-47`                                     |
| B4  | LOW | Upstream | Trace flush every 1 s to `desktop.trace.ndjson`; telemetry sampler 30 s active / 2 min idle / 1 s with Diagnostics open (already bounded); update check every 4 min. Nothing else polls when idle.                                                                                                                                    | `shared/observability.ts:410-413`; `DesktopTelemetryPublisher.ts:23-27,284-298`            |
| —   | OK  |          | Window config is sane for macOS: opaque, `hiddenInset`, sandbox + contextIsolation, `backgroundThrottling: true` (previous fix confirmed), no vibrancy, no GPU switches; `playwright-core` is never `require`d; no unbounded holders in main.                                                                                         | `DesktopWindow.ts:339-367`                                                                 |

### 3.3 Renderer JavaScript runtime

| #   | Sev     | Origin   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Evidence                                                                                                                                                                  |
| --- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | HIGH    | Upstream | `markdownComponents` `useMemo` depends on `renderedText` (used by one renderer) and three per-text `Map`s → **new component identities on every streamed delta** → react-markdown remounts the entire message DOM (≤ 20 Hz) and resets code-block/table state mid-stream. Also floods every body-wide MutationObserver. Likely source of the 25–33 % renderer bursts.                                                                                                                                                | `apps/web/src/components/ChatMarkdown.tsx:1521-1793` (deps at `:1791`), `:1393-1427`                                                                                      |
| C2  | HIGH    | Upstream | Streaming fenced code: highlight cache skipped while streaming and `codeToHtml` runs synchronously; with C1 every block in the streaming message is re-tokenized per delta on the main thread. The iOS "plain text while streaming, highlight once settled" fix from the previous audit was never ported to web.                                                                                                                                                                                                     | `ChatMarkdown.tsx:737-810,1748-1773`                                                                                                                                      |
| C3  | HIGH    | Upstream | Whole-thread `useThread` (messages + activities) in shell-only consumers: `useHandleNewThread` (mounted in `Sidebar`, `CommandPalette`, `useActiveProjectTarget`), `BranchToolbar*`, `GitActionsControl` (in `ChatHeader`), `DiffPanel`, persistent terminal drawer/panel (up to 11 instances), route wrapper; `ChatComposer` receives `activeThread` but reads three fields. Each re-renders per detail delta **and** per shell upsert (~20–40 Hz on the routed thread). ≈ most of the measured 6–9 % renderer CPU. | `hooks/useHandleNewThread.ts:466`; `Sidebar.tsx:1765`; `BranchToolbar.tsx:400`; `GitActionsControl.tsx:1037`; `DiffPanel.tsx:126`; `ChatView.tsx:702,1094,6661`           |
| C4  | MED     | Upstream | Per-delta O(window) derivations (`deriveTimelineEntries` with `toSorted`/`localeCompare`, minimap, attachment maps, revert counts) and a fresh `latestTurn` object per delta; ~7 `useMemo`s over the whole activities array per publish.                                                                                                                                                                                                                                                                             | `session-logic.ts:1668-1701`; `MessagesTimeline.logic.ts:449-480`; `ChatView.tsx:2323-2411,2694`; `threadReducer.ts:377-406`                                              |
| C5  | MED     | Upstream | Persistence: full-snapshot Effect Schema encode + `JSON.stringify` of the whole thread window on settle, and of **all** thread shells after any shell change (500 ms debounce, ~1 MB for 500 threads); Schema decode on open. 10–100 ms main-thread stalls at exactly the wrong moments. Every new WS session re-downloads the full shell over HTTP even with a valid cursor.                                                                                                                                        | `connection/storage.ts:490-503,539-583`; `state/shell.ts:96-101,178,190-215`; `threads.ts:216-220,268-300`                                                                |
| C6  | MED     | Upstream | Composer drafts: zustand `persist` stringifies **all** drafts incl. base64 image `dataUrl`s per keystroke (only the `setItem` is debounced); no size cap.                                                                                                                                                                                                                                                                                                                                                            | `composerDraftStore.ts:70-76,84-90,1917,3712-3714`                                                                                                                        |
| C7  | MED     | Fork     | `ComposerAttachControl` runs an unfiltered `MutationObserver(document.body, {childList, subtree})` → rAF → two document-wide `querySelectorAll` per changed frame; mounted unconditionally by `SceneryHost`. Same anti-pattern plan 002 fixed for `SceneryMotion`.                                                                                                                                                                                                                                                   | `scenery/ComposerAttachControl.tsx:172-240`; `SceneryHost.tsx:30`                                                                                                         |
| C8  | MED     | Upstream | Memory: diff worker pool sized `clamp(cores/2, 2, 6)` = 6 here, mounted around every `ChatView`, torn down only when the last provider unmounts, two 240-entry AST LRUs; Ghostty shared `WebAssembly.Memory` never shrinks, `MAX_SCROLLBACK_ROWS` 10,000, `MAX_HIDDEN_MOUNTED_TERMINAL_THREADS` 10 (×4 per group), hidden canvases keep their backing store; thread detail idle TTL 5 min keeps subscription + reducer + window alive; main-thread Shiki grammars never disposed.                                    | `DiffWorkerPoolProvider.tsx:50-71`; `terminal/ghostty/runtime.ts:213-221`, `core.ts:11`; `ChatView.logic.ts:26`; `threadRetention.ts:3`; `lib/syntaxHighlighting.ts:9-29` |
| C9  | LOW–MED | Upstream | Sidebar root re-renders per shell upsert to re-sort/group all threads; `WorkingDuration` = one `setInterval(1000)` + commit per running row, not visibility-gated; per-row `subscribeVcsStatus` per distinct cwd.                                                                                                                                                                                                                                                                                                    | `Sidebar.tsx:232-240,782-790,1684,1886`                                                                                                                                   |
| C10 | LOW     | Upstream | Dead client tracing runtime (`ClientTracingLive` never provided; 1 s OTLP flush loop with empty buffer); `matchMedia` inside `getSnapshot` (20–40×/s via ChatView, ×2 in `ActiveScenery`); dep-less layout effect in `BranchToolbar`; scenery store persists raw `localStorage` on every `set`; wake-up resubscribes every live thread.                                                                                                                                                                              | `observability/clientTracing.ts:16,44-49`; `hooks/useMediaQuery.ts:77-80`; `ActiveScenery.tsx:54-68`; `sceneryStore.ts:322-341`                                           |
| —   | OK      |          | Timeline is genuinely virtualized (LegendList); reducer keeps identities; no client-side polling in `client-runtime`; blob URLs revoked; CodeMirror instances destroyed; IndexedDB thread persistence skipped while running.                                                                                                                                                                                                                                                                                         |                                                                                                                                                                           |

### 3.4 Renderer GPU, paint, and the World Scenery layer

Corrections to the earlier audits first: **the display is 1× DPR** (2560×1440 "looks like"
2560×1440), so full-window layers are 6.6–14.7 MB, not 59 MB; and **thinking orbs no longer exist**
(`91352b232 fix(web): remove thinking orbs and restore pulse-dot status`), so plan 001's subject
is gone. What remains:

| #   | Sev               | Origin        | Finding                                                                                                                                                                                                                                                                                                                                                                                      | Evidence                                                                               |
| --- | ----------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| D1  | HIGH (memory)     | Fork          | Wallpaper decoded at **screen** width × DPR (rounded to 256, cap 3840) although the CDN pre-blurs it (`blur=50`) and it is drawn under a 0.68-alpha wash: 2560×1707 = **17.5 MB RGBA (+33 % mips) per photo**, one photo per thread, old photos linger in Chromium image caches. Best fork-controlled candidate for the unattributed 190 MB Metal pool; 39 MB per photo on a Retina display. | `scenery/unsplash.ts:173-190`; `SceneryLayer.tsx:111-163,171-177`                      |
| D2  | MED               | Upstream      | `topbar-scroll-fade` `mask-image` on the whole timeline scroller (and settings/PR scrollers) forces a chat-column render surface + mask that is fully redrawn on every scroll/stream frame (240 fps during momentum scroll).                                                                                                                                                                 | `index.css:347-389`; `MessagesTimeline.tsx:603-606`; `settingsLayout.tsx:250`          |
| D3  | MED               | Shared        | Frame count is the GPU cost, not blur area: each streamed delta re-renders (only `useDeferredValue`, no cadence), scrolls the list, re-blurs the composer glass and swaps; stepped `status-pulse`/`status-ping` compositor animations keep BeginFrames ticking at 240 Hz for the whole turn. This is the ~8–10 % GPU-helper CPU.                                                             | `ChatMarkdown.tsx:1373`; `MessagesTimeline.tsx:1341-1343`; `index.css:141-143,229-243` |
| D4  | LOW–MED           | Fork          | Persistent backdrop-filter surfaces under scenery: sidebar (14 px), header (24 px), composer `::before` (24 px + saturate 1.35), attribution pill/trigger (12 px). Only ≈ 4 MB of surfaces at this window size, but any backdrop-filter quad disqualifies CALayer overlay promotion; the composer one re-blurs whenever content scrolls beneath it.                                          | `scenery.css:517-521,540-545,572-579,224-225,298-299`; `index.css:790-802`             |
| D5  | LOW–MED           | Upstream/Fork | Full-window blur while dialogs/command palette/sheets are open (`dialog-backdrop` 4 px + `dialog-glass` on top; `sheet` `backdrop-blur-xs`); under a pre-blurred photo the 4 px buys nothing visible.                                                                                                                                                                                        | `index.css:302-330`; `dialog.tsx:33`; `command.tsx:34`; `sheet.tsx:25`                 |
| D6  | LOW–MED           | Fork          | Thread switch: outgoing + incoming photo composited during 0.6/0.45 s fades; ink flips snapshot the page via view transitions and re-raster every layer; +20–35 MB transient here (180–300 MB on Retina) — plausible driver of the 641 MB GPU peak. Scenery fades honor `prefers-reduced-motion` but not the app's Motion toggle.                                                            | `scenery.css:82-113,195-206`; `sceneryInkTransition.ts:49-85`; `useInkOverride.ts`     |
| D7  | LOW (conditional) | Upstream      | `ultrathink-frame::before` animates `background-position` 10 s infinite and `.ultrathink-chroma` animates `filter: hue-rotate`, no reduced-motion guard — 240 fps repaint while active.                                                                                                                                                                                                      | `index.css:1999-2059`                                                                  |
| —   | OK                |               | No Ken Burns/parallax; `will-change` at 7 small/transient sites; only canvas is the invalidation-driven Ghostty terminal; `motion.css` is one-shot and gated.                                                                                                                                                                                                                                |                                                                                        |

INFERRED GPU model at 1760×959: swap chain 20 MB + root tiles 7 MB + timeline tiles/mask ~22 MB +
backdrop surfaces ~4 MB + **17.5 MB × resident wallpapers**; the remaining ~150–200 MB is
Graphite/Dawn cache high-water that only a `memory-infra` dump can attribute (see §5, P3.6).

### 3.5 Server runtime and persistence

| #   | Sev     | Origin   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Evidence                                                                                                                                                                            |
| --- | ------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | HIGH    | Upstream | Every non-terminal tool progress update becomes a durable `thread.activity-appended` event **and** a new `tool.updated` projection row with a fresh id (`id: event.eventId`), payload = cumulative snapshot. ACP (Cursor/Kimi/Grok — 173 of the user's 230 threads) emits one per `tool_call_update` whenever `detail` changes; Claude via `input_json_delta` fingerprints; Codex likewise. Per tick: 1 event + 1 activity row + 5 index entries (incl. a 7-column compaction index) + 1 receipt ≈ 5–8 KB on disk. **MEASURED:** 26 rows per tool call, 952 MB of events, single thread 46K rows / 104 MB.                                                     | `ProviderRuntimeIngestion.ts:790-816`; `AcpRuntimeModel.ts:410-432,563-573`; `AcpSessionRuntime.ts:869-893,931-942`; `ClaudeAdapter.ts:2513-2560,2723-2760`; `CodexAdapter.ts:1146` |
| E2  | HIGH    | Fork     | Migration 045 "compaction" is **read-side only**: the thread-detail query takes the newest 500 activity rows _then_ drops superseded `tool.updated`; nothing deletes rows, events, or receipts (no `DELETE` on `orchestration_events` / `orchestration_command_receipts` anywhere). Consequences: unbounded growth (2.8 GB), migrations/backups that scale with it, and a visible window of ~500/27 ≈ 18 tool calls for ACP threads.                                                                                                                                                                                                                           | `ProjectionSnapshotQuery.ts:84,1172-1240,1550-1655`; `Migrations/045_*.ts`; `ProjectionThreadActivities.ts:114`                                                                     |
| E3  | HIGH    | Upstream | Unsampled span tracing to disk in production: **MEASURED** 208 spans/s, ~480 B/span, 100–145 KB/s during turns; ≈ 85 spans / 40 KB per orchestration event (9 × `runProjectorForEvent` + 9 × `apply*Projection` + 9 × `runAttachmentSideEffects` + 9 SAVEPOINT + ~22 `sql.execute` carrying full `db.query.text` + 10 `sql.transaction`); ~3 spans per streamed Claude token. Default `T3CODE_TRACE_MIN_LEVEL=Info` samples every Info span; sink does per-span object + attribute map + `JSON.stringify`, `TextEncoder` per record and `appendFileSync` on the main thread each second. INFERRED CPU 0.5–0.8 % of a core ≈ the whole measured server average. | `observability/Layers/Observability.ts:24-27,61-68`; `cli/config.ts:80-88`; `packages/shared/src/observability.ts:361-420,472-486`                                                  |
| E4  | MED     | Fork     | Merged-PR sweep every 60 s, ungated by `BackgroundPolicy`: correlated subquery walking each thread's events newest-first (**MEASURED** 176 candidates, 0.81 s cold / 0.15 s warm, synchronous on the main thread) then `git for-each-ref` per candidate; ~4.6 git spawns/s in the trace. Prime suspect for the one-second 26 % spike, together with WAL auto-checkpoints into a 3 GB file and checkpoint capture (7 git subprocesses × ≥ 2 captures per turn).                                                                                                                                                                                                 | `ThreadMergedPullRequestReactor.ts:25,229`; `ProjectionSnapshotQuery.ts:810-860`; `GitManager.ts:1948-1965`; `GitVcsDriver.ts:703-784`; `CheckpointReactor.ts:355-460`              |
| E5  | MED     | Upstream | Terminal manager spawns `ps -eo pid=,ppid=,comm=` **every 1 s** while any PTY is alive (the resource monitor already has the process tree every 5 s; `resource-telemetry.md` claims it replaced this). Port discovery runs `lsof -iTCP -sTCP:LISTEN` every 3 s while the Preview empty state is mounted.                                                                                                                                                                                                                                                                                                                                                       | `terminal/Manager.ts:79,715-745,2003-2050,2103-2113`; `PortScanner.ts:73,516-521`                                                                                                   |
| E6  | MED     | Upstream | Provider native NDJSON logs write every raw SDK/ACP message incl. per-token `stream_event`s and full cumulative `tool_call_update` payloads (522 MB on disk).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `ClaudeAdapter.ts:3532-3536`; `EventNdjsonLogger.ts:25-46`                                                                                                                          |
| E7  | MED     | Upstream | Per-event pipeline overhead is structural: 9 nested SAVEPOINTs + 9 `projection_state` upserts + 9 empty `runAttachmentSideEffects` per event; ~22 statements/event. SQL itself is ~0.35 % of wall (104 ms per 30 s measured); the Effect/span/JSON wrapping dominates. Shell re-read per client per 50 ms batch.                                                                                                                                                                                                                                                                                                                                               | `ProjectionPipeline.ts:1772-1803,1821-1832`; `ws.ts:700-732`                                                                                                                        |
| E8  | LOW–MED | Upstream | Background cadences while a client is active: `git fetch` every 30 s per subscribed cwd (correctly demand-gated), provider health 5 min + npm registry check, `fs.watch` on the userdata dir (which also holds the SQLite WAL) for settings/keybindings. Receipts table (404K rows) never pruned. No `cache_size`/`wal_autocheckpoint`/`PRAGMA optimize`.                                                                                                                                                                                                                                                                                                      | `settings.ts:539`; `VcsStatusBroadcaster.ts:27,398-470`; `serverSettings.ts:531-540`; `persistence/Layers/Sqlite.ts:36-43`                                                          |
| —   | OK      |          | Boot loads only thread metadata (messages/activities empty until touched, capped 2000/500/500 per thread); assistant text buffered by default; sessions reaped after 30 min idle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `ProjectionSnapshotQuery.ts:2166-2168`; `projector.ts:41-42,824`                                                                                                                    |

### 3.6 Wire protocol

| #   | Sev  | Origin   | Finding                                                                                                                                                                                                                                                                                                                                                                                                                             | Evidence                                                                        |
| --- | ---- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| F1  | HIGH | Upstream | Shell stream re-sends the **whole `OrchestrationThreadShell`** for any thread-aggregate event, per client, because every message/activity bumps `updatedAt`. Each = 3 SQL reads + Schema encode + `JSON.stringify` + deflate **per client**. **MEASURED** frame 2,374 B (shell 2,275 B with scenery, 1,446 B without); up to 20/s per streaming thread per client (~48 KB/s with legacy streaming, 1–2/s in default buffered mode). | `ws.ts:561-597,724-770,1208-1232`; `ProjectionPipeline.ts:925-948`              |
| F2  | MED  | Upstream | Fan-out duplicates all projection work per socket (separate coalescer, DB reads, encode). Server-side unbounded buffers per subscription; `groupedWithin(512, 50 ms)` per shell subscriber ticks 20×/s while idle.                                                                                                                                                                                                                  | `ws.ts:1226-1232,1350`; `RpcServer.ts:1428-1443`                                |
| F3  | MED  | Upstream | permessage-deflate on with context takeover for the desktop loopback socket — pure CPU on both ends, zero bandwidth benefit; `ws` cannot threshold with takeover on.                                                                                                                                                                                                                                                                | `server.ts:236-246`; `DesktopBackendConfiguration.ts:399-405`                   |
| F4  | MED  | Upstream | Streaming tool progress reaches the client as 26 separate ~1.3 KB events per tool call (~34 KB per tool call per client); the client reducer appends each as a new row with an O(N) scan + copy and **no client-side compaction** until the next snapshot.                                                                                                                                                                          | `ws.ts:1345,1390`; `threadReducer.ts:605-646`                                   |
| F5  | MED  | Upstream | Client keeps ≥ 4 live `subscribeThread` streams (open + 3 sidebar prewarm — legacy sidebar only) + 5-min TTL; sidebar rows subscribe VCS status per distinct cwd.                                                                                                                                                                                                                                                                   | `LegacySidebar.tsx:230-233,3657`; `Sidebar.tsx:781-788`; `threadRetention.ts:3` |
| F6  | LOW  | Upstream | Legacy token streaming (opt-in) wraps a 9-char delta in a ~900 B envelope (930 B frame; ~95 KB/s + 70 Acks/s per client). PTY chunks 1:1 JSON with history string rebuilt per chunk. Composer images travel as base64 `dataUrl` (≤ 14 M chars) inside `thread.turn.start`.                                                                                                                                                          | `orchestration.ts:1447-1466`; `terminal/Manager.ts:1656-1676,1716-1723`         |
| —   | OK   |          | Thread open is windowed (last 10 user turns, ≤ 500 activity candidates → ~30–100 KB gzipped for the 46K-row thread — the 104 MB never leave the server); canvas is op-based; diffs/PR/usage/storage/skills are on-demand; telemetry stream only while Diagnostics is open; `ServerConfig` is delta-typed; idle wire ≈ 30–40 B/s.                                                                                                    | `ProjectionSnapshotQuery.ts:1550-1640`; `environmentHttp.ts:525-532`            |

## 4. Where the weight is, by layer

| Layer        | Steady state                                                                                    | Turn time                                                                                                      | Startup / disk                                                        |
| ------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Main process | ~0 % CPU; 3 s sync IPC poll; 4-min updater                                                      | recording/CDP bursts                                                                                           | ~0.4 s module resolution + 0.1 s shell probe + 1.7 s server wait      |
| Renderer     | 326 MB (V8 255); TTL-retained threads, 6 diff workers, terminals                                | 6–9 % (bursts to 33 %): message remount + re-highlight + fan-out + persistence stalls                          | 7.2 MB JS parsed uncached; clerk 1.5 MB; settings/PR/CodeMirror eager |
| GPU helper   | 320 MB (190 unattributed; 17.5 MB/wallpaper)                                                    | 8–10 %: frames per delta + 240 Hz pulse ticks + composer re-blur                                               | —                                                                     |
| Server       | 199 MB (158 baseline); ~0.5 %                                                                   | 26 % second-spikes: PR sweep, WAL checkpoint, 7-git checkpoints; 100–145 KB/s trace writes; per-tick tool rows | 0.83 s boot; libvips/fff/provider probes; 7 MB unminified             |
| Disk         | 2.8 GB DB (+5–8 KB per tool tick), 100 MB traces, 522 MB provider logs, 2.1 GB Chromium profile |                                                                                                                | 455 MB app, 211 MB asar (85 MB maps, 130 MB node_modules)             |
| Wire         | 30–40 B/s idle                                                                                  | 2.4 KB shell × ≤ 20/s × clients; 1.3 KB × 26 per tool call; deflate on loopback                                | full shell over HTTP per session                                      |

## 5. Efficiency plan

Ordered by value per unit of risk. Every item keeps the current feature set unless a tradeoff is
stated. Numbers are INFERRED expectations to be verified with the protocol in §6.

### Phase 1 — no product change, small diffs (each S)

| #     | Change                                                                                                                                                                                                                                                                                                                                                                                                                                         | Where                                                                                                                    | Expected effect                                                                                  | Tradeoff                                                                                              |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| P1.1  | Add `!**/*.map`, `!**/node_modules/effect/src/**`, `!**/*.d.{ts,mts,cts}`, `!**/node_modules/**/{README*,CHANGELOG*}`, playwright extras (keep `lib/coreBundle.js`), `httpApi{Scalar,Swagger}.js`, `prod-resources` extras to `DESKTOP_FILE_EXCLUSIONS`; strip maps from the npm `t3` package                                                                                                                                                  | `scripts/build-desktop-artifact.ts:792`                                                                                  | asar 207 → ~95 MB; smaller header per process; faster updates                                    | none (maps have no runtime consumer)                                                                  |
| P1.2  | Mac/Linux stage: use the server **runtime-externals** dependency list (as Windows does); `alwaysBundle` `@clerk/electron` in `main.cjs` (preload already does) and drop the clerk-js tree + `react-grab` from staged deps                                                                                                                                                                                                                      | `build-desktop-artifact.ts:2964`; `apps/desktop/vite.config.ts:52`                                                       | asar → ~58 MB, ~10k fewer files, header ≪ 1 MB                                                   | none; the self-containment check guards it                                                            |
| P1.3  | `codeCache: true` on the `t3code` scheme; `Cache-Control: public, max-age=31536000, immutable` on hashed `/assets/*`; pre-compressed `.br` for remote clients                                                                                                                                                                                                                                                                                  | `ElectronProtocol.ts:112-131`; `http.ts:366-377`                                                                         | V8 bytecode reused across launches (today: none); remote browsers cache assets                   | none                                                                                                  |
| P1.4  | Packaged default `T3CODE_TRACE_MIN_LEVEL=Warning` (or off), Diagnostics can raise it live; `sql.*`, `runProjectorForEvent`, `runAttachmentSideEffects` spans to Debug; drop `db.query.text` from local records; scope the startup span so `startup.phase` stops annotating every later span                                                                                                                                                    | `cli/config.ts:80-88`; `Observability.ts`; `shared/observability.ts`                                                     | −100–145 KB/s disk writes; ≈ −0.5 % core sustained during turns; ~9 MB/min less I/O              | traces are opt-in instead of always-on                                                                |
| P1.5  | `await import("sharp")` inside the preview generator and move `attachmentFeedPreviewPath` out of `AttachmentPreview.ts`; lazy `@ff-labs/fff-node`; `module.enableCompileCache()` at the top of `bin.ts`; `minify: true` for server and desktop packs                                                                                                                                                                                           | `assets/AttachmentPreview.ts:8`; `WorkspaceSearchIndex.ts`; `bin.ts`; both `vite.config.ts`                              | −15–30 MB server RSS at idle; faster server boot; 7 → ~4 MB parse                                | none                                                                                                  |
| P1.6  | Fork the login-shell probe at t0 and join right before the backend spawn; lazy-`require` `electron-updater` and `@clerk/electron/storage`; replace `NodeHttpClient.layerUndici` with a fetch-based client; create the preview `persist:` session on first tab; drop the second dock-icon configure; updater poll 4 min → 30–60 min or on focus                                                                                                 | `DesktopApp.ts:235,271,286`; `main.ts:238`; `ElectronUpdater.ts:7`; `DesktopClerk.ts:1-2`; `DesktopWindow.ts:321`        | −250 ms of the ~400 ms main boot; fewer periodic wakeups                                         | none                                                                                                  |
| P1.7  | Disable permessage-deflate for loopback peers (decide per upgrade on `remoteAddress`); keep for LAN/tunnel                                                                                                                                                                                                                                                                                                                                     | `server.ts:236-246`                                                                                                      | zlib removed from every desktop frame both directions                                            | none                                                                                                  |
| P1.8  | Renderer streaming: (a) stabilize `markdownComponents` (read `renderedText` and the link maps through refs); (b) render fenced code as plain `<pre><code>` while `isStreaming`, highlight once settled; (c) filter `ComposerAttachControl`'s observer like `sceneryMotionMutations`                                                                                                                                                            | `ChatMarkdown.tsx:1521-1793,737-810`; `scenery/ComposerAttachControl.tsx:172-240`                                        | no per-delta remount/re-highlight; removes the 25–33 % bursts; halves observer work              | (b) no syntax colours until a block settles (iOS already does this)                                   |
| P1.9  | Shell-only subscriptions: `useThreadShell`/session selectors in `useHandleNewThread`, `BranchToolbar*`, `GitActionsControl`, `DiffPanel`, terminal drawer/panel; pass three primitives to `ChatComposer`                                                                                                                                                                                                                                       | see C3                                                                                                                   | Sidebar/Composer/Header leave the 20–40 Hz path; ≈ halves renderer turn-time CPU                 | none                                                                                                  |
| P1.10 | Wallpaper: size by **window** width (`innerWidth × DPR`), cap ~1024–1280 when `blur ≥ 20`; clear `src` on the outgoing image                                                                                                                                                                                                                                                                                                                   | `scenery/unsplash.ts:173-190`; `SceneryLayer.tsx:111-163`                                                                | 17.5 → 2–5 MB per photo (39 → ~5 MB on Retina); faster thread swaps                              | none at default blur 50; sharp mode (blur 0) unchanged                                                |
| P1.11 | Merged-PR sweep: persist `branch_observed_at`, restrict to `settled_at IS NULL` (7 vs 176 candidates), gate on `BackgroundPolicy`, 5 min or on push/turn-end. Terminal `ps` poll → resource-monitor snapshot or attached-only. Port scanner from monitor tree / 5–10 s / stops when hidden                                                                                                                                                     | `ThreadMergedPullRequestReactor.ts`; `ProjectionSnapshotQuery.ts:810-860`; `terminal/Manager.ts:79`; `PortScanner.ts:73` | removes the per-minute 150 ms stall + ~4–5 git spawns/s; −1 spawn/s per terminal                 | none                                                                                                  |
| P1.12 | Gate the 3 s platform poll on `document.visibilityState` and make it `invoke`-based; emit topology changes from `DesktopBackendPool` instead                                                                                                                                                                                                                                                                                                   | `connection/platform.ts:364,570`; `preload.ts:42-48`                                                                     | no sync IPC from a hidden window; no renderer stalls on a busy main                              | contract change in `DesktopBridge`                                                                    |
| P1.13 | Renderer housekeeping: skip Schema encode/decode for IndexedDB round-trips (validated data, keep a version tag); persist shell incrementally or debounce 5–10 s and skip when hidden; skip HTTP shell re-download when the cursor is within the resume gap; composer draft stringify inside the debounce and `dataUrl` out of the per-keystroke payload; remove `ClientTracingLive`; hoist `matchMedia` lists; scenery store persist debounced | C5, C6, C10                                                                                                              | removes settle-time and per-keystroke stalls                                                     | none                                                                                                  |
| P1.14 | Under scenery: `topbar-scroll-fade { mask-image: none }`; `dialog-backdrop` to a tint; composer glass 24 → 12–16 px without `saturate`; Motion toggle also parks scenery fades                                                                                                                                                                                                                                                                 | `index.css:347-389,322-330`; `scenery.css:540-545,195-206`                                                               | one chat-column surface + mask gone; no full-window blur under dialogs; cheaper composer re-blur | subtle: no soft top fade under the header; dialogs tint instead of blur over an already-blurred photo |

### Phase 2 — structural, medium diffs (M)

| #    | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Expected effect                                                                                                  | Tradeoff                                                                                                                                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2.1 | `tanstackRouter({ autoCodeSplitting: true })` (keep the thread route eager via `codeSplitGroupings` if wanted) + `React.lazy` for the Electron Clerk root, `LegacySidebar`, `ThreadTerminalDrawer`, `JetBrainsIcons`                                                                                                                                                                                                                                                                                                                             | entry 6.2 → ~3.2 MB (web/npx); desktop critical path ~4.7 MB until P3.1                                          | first open of Settings/PR/Usage fetches a chunk                                                                                                             |
| P2.2 | Bundle `effect` + `@effect/platform-node` (+ `electron-updater`) into `main.cjs`, minified; fix the three `import { Schema } from "effect"` barrels in contracts                                                                                                                                                                                                                                                                                                                                                                                 | −100–150 ms main boot; −33.5 MB asar; ~700 fewer files                                                           | two copies of effect on disk if the server keeps externalizing it (it doesn't — `bin.mjs` bundles 415 KB)                                                   |
| P2.3 | Serve `t3code://app/*` from `apps/server/dist/client` on disk (`net.fetch(pathToFileURL)`, SPA fallback), proxy only `/api`, `/oauth`, `/.well-known`; drop the readiness gate for the window; push `desktop:backend-ready` to the renderer so `buildPlatformRegistrations` runs immediately                                                                                                                                                                                                                                                     | window visible at ~T+0.4 s instead of ~T+2 s                                                                     | connecting UI visible ~1.5 s (already exists for remote); WSL path needs the same disk-serve                                                                |
| P2.4 | Stop persisting per-tick tool progress: keep the latest `tool.updated` per `(thread, itemId)` in an in-memory registry published on a live stream merged into `subscribeThread` (and included in the detail snapshot); persist `tool.started`, `tool.completed`, and coalesced progress (≤ every N s / still-running at turn end) under a **stable** id `${itemId}:progress` so it upserts one row. One-off migration deletes `tool.updated` rows superseded by a `tool.completed` in the same group and their events, then `VACUUM INTO` + swap | −1.5 GB now; ~−90 % writes during ACP turns; history window shows the last 500 real rows                         | intermediate progress of a tool that was mid-flight at a crash is lost (start/complete are kept); strict append-only broken for one kind no projector needs |
| P2.5 | Shell "thread-touched" event (`{threadId, updatedAt, sequence}` ~120 B) for message/activity kinds, full `thread-upserted` only for session/turn/pin/title/plan changes; encode each shell/thread stream item once and fan the string out to N clients; client-side `tool.updated` compaction in the reducer; cap the activity window **after** compaction                                                                                                                                                                                       | −95 % shell wire during turns; no per-client SQL reads/encode; O(tool calls) client work; correct history window | contract addition to `OrchestrationShellStreamEvent`                                                                                                        |
| P2.6 | Renderer memory: mount `DiffWorkerPoolProvider` around diff surfaces only, `poolSize` 2–3, byte-capped AST cache, idle terminate; `MAX_HIDDEN_MOUNTED_TERMINAL_THREADS` 10 → 2–3, scrollback 10k → 2–5k, hidden canvases 0×0; thread idle TTL 5 min → 60–90 s                                                                                                                                                                                                                                                                                    | −50–150 MB typical renderer footprint                                                                            | first diff after idle warms up ~100–300 ms; hidden terminals re-attach (512 KB replay); >90 s revisits decode from IndexedDB                                |
| P2.7 | Pipeline: one `projection_state` write per event, no per-projector SAVEPOINT, short-circuit empty side effects; prune receipts (24–72 h); `wal_autocheckpoint`, `PRAGMA optimize` on shutdown, `cache_size` 32–64 MB; skip raw `stream_event`/`tool_call_update` in provider logs unless verbose                                                                                                                                                                                                                                                 | −9 statements and −27 spans per event; bounded receipts; fewer WAL stalls; −500 MB logs                          | receipts only serve idempotent retries within the window                                                                                                    |
| P2.8 | Web streaming cadence 32–64 ms (mirror iOS) and identity-aware timeline derivation; replace `status-pulse` compositor animations with a JS-toggled class at ~1.5 Hz while a turn is active                                                                                                                                                                                                                                                                                                                                                       | ≤ 30 frames/s of raster + scroll + composer blur + swap instead of per delta; no 240 Hz BeginFrames from pulses  | none visible                                                                                                                                                |
| P2.9 | Preview: attach CDP lazily/scoped (never `Accessibility.enable` outside snapshots), cap `diagnostics.requests`; recording via `Page.startScreencast` or bounded `capturePage(rect)`                                                                                                                                                                                                                                                                                                                                                              | no AX-tree upkeep on guest pages; recording off the main thread                                                  | console/network history starts at first open                                                                                                                |

**P2.6 as shipped (2026-08-16).** The provider stays where it was (`ChatView`, PR code tab); the
lib's mount-scoped singleton was replaced by one page-level `WorkerPoolManager` that is terminated
right after construction and boots on the first render task, `poolSize` = `clamp(cores/2, 2, 3)`,
AST LRUs 240 → 120 entries (`@pierre/diffs` has no byte cap), and a stat-driven idle terminator that
drops workers + caches after 90 s with no mounted diff surface or task
(`DiffWorkerPoolProvider.logic.ts`); the manager re-initializes itself on demand. A theme change
while idle still boots the pool (`setRenderOptions` initializes) and it idles out again. Terminal:
`MAX_HIDDEN_MOUNTED_TERMINAL_THREADS` 3, `MAX_SCROLLBACK_ROWS` 5,000 (equal to the server's
`DEFAULT_HISTORY_LINE_LIMIT`, so the "512 KB replay" above is really "≤ 5,000 lines of history"),
and `GhosttySurface.fit()` zeroes the canvas backing store whenever its mount is 0×0 (hidden
drawers, collapsed panes) and repaints in the same ResizeObserver tick on re-show. Thread state idle
TTL 5 min → 90 s (`threadRetention.ts`; mobile keeps its 15 s override). Main-thread Shiki grammars
were left alone: `disposeHighlighter()` exists but the pool manager and markdown code blocks share
that highlighter, so there is no safe dispose point.

**P2.8 as shipped (2026-08-16).** Streaming cadence: the web already had it — every thread
subscriber is fed through the 50 ms coalescer in `packages/client-runtime/src/state/threads.ts`
(`THREAD_STREAM_COALESCE_WINDOW`, shared with mobile, whose 64 ms `streamingTextCadence` sits on
top for its native Markdown bridge), so React sees at most 20 publications/s during a stream and the
final delta lands within the same window; no second cadence was layered on `ChatMarkdown`.
Derivations, measured per publication on a synthetic 10-turn / 1,500-activity window:
`deriveWorkLogEntries` was 75 % of the chain (0.43 ms of 0.57 ms) — payload parsing, not the
`toSorted` (0.009 ms) — and now caches the parsed entry per activity object in a `WeakMap`
(activities are identity-stable across publications), 0.43 → 0.16 ms; the minimap preview
collapsed whitespace over every full message text per publication (~0.8 ms per 200 KB of loaded
text) and now reads a 1,000-char prefix. `deriveTimelineEntries` (0.03 ms) and `latestTurn` identity
were left alone — the timeline re-derives anyway because the streaming message object changes.
Pulses: `animate-status-pulse`/`animate-status-ping` infinite animations are gone; one ticker
(`apps/web/src/hooks/useStatusPulse.tsx`) writes `html[data-status-pulse]` (phase 0–5, 667 ms) that
`index.css` maps to opacity steps for `.status-pulse`, the three-dot `.status-pulse-wave` and the
connecting `.status-ping`; it runs only while a subscriber (`useStatusPulse`/`StatusPulseDot`) is
mounted, the document is visible, the Motion toggle is on and `prefers-reduced-motion` is off,
otherwise the indicators are static. The agent-browser click ripple keeps its one-off CSS ping.
`ultrathink-frame::before` / `.ultrathink-chroma` hold their static spectrum under
`html:not([data-scenery-motion])` and reduced motion.

**P2.9 as shipped (2026-08-16).** `registerWebview` no longer attaches the debugger; a guest gets
a control session only when something needs one — an automation action, a non-`system`
`prefers-color-scheme` override, or an active recording/PiP capture — and attaching enables no CDP
domain (`Manager.ts` `ensureControlSession`). Domains: `Runtime`/`Log`/`Network` are armed by the
first automation action on a guest (`armDiagnostics`) and stay on for that session, so console/
network history starts at the agent's first touch and a tab the agent never drives pays for nothing;
`Accessibility` is enabled → `getFullAXTree` → disabled inside each snapshot only; `Page` is enabled
only for the screencast. The session is released when it goes idle (`releaseIdleControlSession`:
scheme back to `system`, capture stopped, no diagnostics history). `diagnostics` is a plain in-place
map: console/network buffers `push`/`shift` at 200, in-flight `requests` evict the oldest at 500;
`onMessage` drops CDP events outside the eight it handles before forking anything. Recording/PiP:
`Page.startScreencast` (jpeg q80, ≤1600 px) is started per capture and its frames — already encoded
off the JS thread — feed the same delivery path; the 12 fps `capturePage` tick only runs while no
screencast frame arrived in the last 250 ms (`SCREENCAST_GRACE_MS`), which covers DevTools holding
the debugger, guests whose screencast starves while offscreen, and static pages, and it downscales to
the same 1600 px bound before `toJPEG`. Recording frames are sent to `wc.hostWebContents` (the window
hosting the guest, where the renderer-side recorder lives) instead of `sendAll`; the PiP window keeps
its direct channel.

### Phase 3 — needs design or upstream coordination (L)

- **P3.1** Gate the Electron `ClerkProvider` behind a persisted signed-in/cloud-enabled flag so
  clerk-js leaves the desktop critical path entirely (−1.5 MB parse per boot).
- **P3.2** Dormant/LRU policy for preview `<webview>` guests (excluding active automation,
  recording, PiP; wake before any CDP command) — deferred since the previous audit.
- **P3.3** URI-backed composer attachments (encode at dispatch only) — deferred since the previous
  audit; P1.13 is the narrow interim cut.
- **P3.4** Extract Playwright's injected script at build time (−10 MB `playwright-core`).
- **P3.5** Fixed-ink option so thread switches don't repaint every layer; default can stay auto.
- **P3.6** Attribute the GPU pool: one `memory-infra` dump of the GPU process
  (`contentTracing` with `disabled-by-default-memory-infra`) split into transfer cache, Skia GPU
  resources, shared images, atlases; plus a 30 s A/B of GPU-helper CPU with World Scenery vs a
  stock theme on the same turn.

**P3.1 as shipped (2026-08-16).** `apps/web/src/cloud/clerkGate.ts` holds a persisted, install-level
flag (`t3code:desktop-clerk-enabled:v1`); on Electron the lazy `ElectronClerkRoot` is only mounted
when it is open, so a signed-out desktop renders the app unwrapped and the clerk-js chunk is never
fetched or parsed. An unwritten flag counts as open: an install that was already signed in when this
landed must not silently drop its relay session, so the first launch still loads Clerk and the
observed session settles the flag for every launch after it. Browsers are untouched (there the provider pulls clerk-js from Clerk's CDN,
not from our bundle), so `useClerkGateOpen()` is constant `true` off Electron. The gate opens from
the two sign-in surfaces — the Settings sidebar footer and Connections → Surge Connect account row,
both of which now render a dormant sign-in button that loads Clerk — and `PendingSignInPrompt`
inside the provider replays that click as `openSignIn` once clerk-js is up, so it stays one click.
`ManagedRelayAuthProvider` writes the flag from the observed session: any launch that reports no
session clears it (for the _next_ launch only; remounting the provider mid-session would remount the
tree for nothing), a live session sets it. Every Clerk-reading surface now guards on
`useCloudUiEnabled()` (build config _and_ provider mounted): `SurgeConnectMeshSync`,
`ConnectOnboardingDialog`, the cloud link row, the cloud environment rows, and the sidebar avatar.
The `/connect` CLI-auth routes read Clerk unguarded but are hosted-app-only (`isHostedStaticApp()`
is false under the `t3code://` origin), so they cannot render without a provider. Tradeoff: opening
the gate mid-session mounts a provider above the app and remounts the tree once — accepted, because
the alternative is paying the parse on every boot for a transition that happens once per install.

**P3.2 as shipped (2026-08-16).** Residency is decided per thread, not per tab, so a thread's guests
are never half-mounted: `apps/web/src/browser/previewGuestResidency.ts` pins any thread that has a
visible surface, a mini player, picture in picture, a running recording, or an in-flight automation
request, and `ElectronBrowserHost` mounts pinned threads plus the most recently pinned others up to
`MAX_RESIDENT_PREVIEW_THREADS` (3). Automation wakes its target for the whole request:
`handleRequest` takes a ref-counted `acquirePreviewGuestThread(threadKey)` before it resolves a tab
and releases it in a `finally`, so a dormant tab is a delay (the existing `waitForDesktopOverlay`
poll covers the remount and re-registration) rather than a `PreviewTabNotFoundError`. Eviction is
just unmounting `HostedBrowserWebview`; the existing lease in `desktopTabLifetime` then closes the
main-process tab, and waking recreates it from the tab's last URL. The cost is real and is why the
pins are conservative: a woken guest reloads, so page state (scroll, form input, in-page JS) is
lost. The recording check reads module state rather than a store, which is enough to _keep_ a
recording tab resident (residency is re-evaluated on every host render) but would not wake one.

**P3.3 as shipped (2026-08-16).** The audit's premise is now only half true in this fork, so the
URI-backed attachment store was not built. `syncPersistedAttachments` — the only path that writes
image bytes into a draft document — has no caller outside its own test, so composer drafts never
carry a base64 `dataUrl` into the persisted payload or the per-keystroke stringify; attaching
produces a `File` plus a blob preview URL, and dispatch encodes base64 from that `File` at send
(`readFileAsDataUrl` in `ChatView`), which is exactly "encode at dispatch only". The one remaining
base64 retention was `hydrateImagesFromPersisted`, which handed the stored data URL back as
`previewUrl` and pinned a copy in draft state for the life of the draft; it now decodes to a `File`
and hands out an object URL (falling back to the data URL where `URL` is unavailable — the existing
`revokeObjectPreviewUrl` ignores non-blob URLs, so removal is unchanged). Left deliberately alone:
the prompt stash still stores capped base64 in localStorage (`MAX_STASH_ENTRY_ATTACHMENT_CHARS`),
which is a durability feature with explicit dropped/unreadable/pending semantics, not a hot path.
Ceiling: if image drafts are ever persisted again, they should go to an IndexedDB blob store keyed
by attachment id, with the async hydration and send-gating that implies.

**P3.4 as shipped (2026-08-16).** `apps/desktop/scripts/build-playwright-injected.mjs` slices the
`source3` literal out of `playwright-core/lib/coreBundle.js`, evaluates it once, validates it
(length plus `InjectedScript`), and writes `PlaywrightInjectedSource.generated.ts` next to the
other generated preview asset; the desktop `build`/`dev` tasks run it before `vp pack`.
`PlaywrightInjectedRuntime.ts` is now a module-level install-expression string — no `require.resolve`,
no `readFile`, no `node:vm`, and no Effect error channel, so `Manager` dropped its cached-effect and
`mapError` wrapper. `playwright-core` moved to `devDependencies` (the staged `--prod` install no
longer carries it) and the packaging re-includes for `package.json` + `coreBundle.js` are gone.
Net: −3.2 MB of staged package against +0.31 MB in `main.cjs` (1.43 MB minified), and the first
automation action no longer resolves, reads and evaluates a 3.2 MB file.

**P3.5 — already available (verified 2026-08-16).** Fixed ink shipped with the scenery quick
settings: Settings → Appearance → _Scenery text color_ offers White, Black and App alongside Auto,
and `pickInkVariant` returns a constant for all three. `ActiveScenery` only sets
`appearanceCrossfade` when the incoming and displayed variants differ, and `SceneryLayer` only calls
`runSceneryInkTransition` under that flag, so a fixed mode already avoids the view-transition
snapshot and the full-layer re-raster on thread switches. Default stays Auto. No change was needed;
the remaining thread-switch cost is the photo crossfade itself (P1.10 sized it down).

**P3.6 — not run.** This is a measurement, not a change: it needs a live app to attach
`contentTracing` to and a real turn to A/B, which means driving the installed desktop app (the one
the maintainer works in) or standing up a dev Electron build and spending provider quota. Left for
an explicit go-ahead; the recipe in §6 step 5 is unchanged.

### Not worth doing

- **msgpack/binary framing**: snapshots are already gzipped over HTTP and WS payloads are short
  frames; deltas (P2.5) and shared encode dominate. Defer.
- **Running the server in-process** (utility process / worker): saves one Node bootstrap
  (~60–100 MB, a few hundred ms) but couples GUI responsiveness and crash domain to server GC and
  loses `npx t3` / remote parity and the fd-based bootstrap transport. Keep the child; decouple the
  window from it (P2.3).
- **Removing World Scenery or glass**: at 1× DPR the persistent backdrop surfaces are ~4 MB and
  the fork's real GPU levers are the wallpaper size (P1.10) and frame count (P2.8), both fixable
  while keeping the look.

### Expected end state (INFERRED)

| Metric                           | Today                                                 | After Phase 1                                 | After Phase 2                          |
| -------------------------------- | ----------------------------------------------------- | --------------------------------------------- | -------------------------------------- |
| `.app` / `app.asar`              | 455 MB / 211 MB (14.7k files)                         | ~340 MB / ~58 MB (~1.9k files)                | ~285 MB / ~40 MB                       |
| Time to visible window           | ~2–2.5 s                                              | ~1.8–2.0 s (probe fork, lazy externals)       | ~0.5 s (disk-served renderer)          |
| Renderer JS on the critical path | 7.2 MB, uncached                                      | 7.2 MB, V8 code-cached                        | ~3.2–4.7 MB, cached                    |
| Server idle footprint            | 199 MB (158 baseline)                                 | ~165–180 MB (no libvips/fff, minified)        | ~150–165 MB                            |
| Server disk writes during a turn | 100–145 KB/s trace + 5–8 KB/tool tick + provider logs | ~0 trace                                      | ~−90 % activity rows; bounded logs     |
| `state.sqlite`                   | 2.8 GB, growing                                       | same                                          | ~1.3 GB, growth ∝ tool calls not ticks |
| Renderer CPU during a turn       | 6–9 %, bursts 25–33 %                                 | ~3–5 %, no remount bursts                     | ~2–4 %                                 |
| GPU helper during a turn         | 8–10 %, 320 MB                                        | fewer surfaces, −15 MB per resident wallpaper | ~half the frames; pool attributed      |
| Shell wire during a turn         | 2.4 KB × ≤ 20/s × clients (+deflate)                  | no deflate on loopback                        | ~120 B touches, encoded once           |

## 6. Verification protocol

Measure the same conditions before and after each phase, in this order:

1. **Bundle**: `du -sh` the `.app`; asar header entry count and byte attribution (script in this
   audit); `dist/client` entry chunk size and gzip; count `React.lazy`/route chunks.
2. **Startup**: three cold launches; from `desktop.trace.ndjson` read `desktop.startup`,
   `shellEnvironment.installIntoProcess`, `desktop.backendProcess.probeReadiness`, `createMain`;
   check `~/Library/Application Support/t3code/Code Cache/js` grows after the first launch (A1);
   DevTools Performance trace of the renderer for `v8.compile` totals.
3. **Steady state**: `top -l 11 -s 1` on main/GPU/renderer/server PIDs with the window visible and
   idle, then hidden; `footprint`/`vmmap --summary` per PID; `lsof -p <server>`; count spawns per
   minute in the server trace (`runGitCommand`, `ps`, `lsof`).
4. **Turn time**: same thread, same provider, same window size and focus, 60 s of streaming:
   per-PID CPU, `du logs/` delta, `SELECT count(*) FROM projection_thread_activities` delta,
   WS frames/s and bytes/s (T3CODE_LOG_WS_EVENTS or a DevTools WS capture), renderer long tasks.
5. **GPU**: `vmmap --summary` IOSurface/graphics lines; `memory-infra` dump (P3.6); Scenery vs
   stock theme A/B on the same turn.
6. **Data**: `sqlite3 -readonly` counts and `dbstat` on a `VACUUM INTO` copy before/after P2.4;
   synthetic ACP turn producing 1,000 tool updates while watching row counts.

Never measure against `~/.t3/userdata` read-write; copy it with `VACUUM INTO` first (see
`CLAUDE.md`, Test data).

## Appendix: how these numbers were taken

- Live processes: `ps`, `top -l`, `footprint -p`, `vmmap --summary`, `sample` on the running
  installed app; scratch server boot via `ELECTRON_RUN_AS_NODE=1 <app>/Contents/MacOS/<app>
<app>/Contents/Resources/app.asar/apps/server/dist/bin.mjs --base-dir /tmp/… --port … --no-browser`,
  heap via `kill -USR1` + inspector `Runtime.evaluate(process.memoryUsage())`.
- Asar: `@electron/asar` header walk for per-file sizes; `@jridgewell/trace-mapping` over the shipped
  `.map` files for byte attribution of the web entry, server bundle, and `main.cjs`.
- Data directory (read-only): `sqlite3 -readonly "file:…?mode=ro"` with `dbstat`; NDJSON trace
  files parsed for span-name histograms; Chromium cache entries by `strings`.
- Source: six independent read-only sweeps (desktop shell, renderer runtime, GPU/CSS, server,
  bundle/packaging, wire), each cross-checked against the live numbers above; claims that did not
  survive verification were dropped (e.g., a "+3 sidebar prewarm" that exists only in
  `LegacySidebar`, and per-token `getBoundingClientRect` in `SceneryMotion`).
