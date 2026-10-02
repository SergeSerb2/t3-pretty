# Architecture

T3 Code keeps execution in the environment that owns the workspace. Web, desktop, and mobile
clients control it over authenticated RPC. A remote client must never substitute its own filesystem,
provider credentials, or machine state for the environment's. The desktop app bundles a server,
but its renderer follows the same boundary.

## Ownership boundaries

Provider processes, terminals, Git, and project files belong to the server. Shared connection and
domain state belongs in `packages/client-runtime`; clients supply platform services and UI.
Keeping that logic shared prevents reconnect and multi-environment behavior from diverging between
web and mobile. See [connection runtime](./connection-runtime.md) and
[remote environments](./remote.md).

The [RPC contract](../../packages/contracts/src/rpc.ts) is the boundary between independently
versioned clients and servers. Subscriptions send the state a client needs, so a client viewing one
thread does not pay for every thread's history. Authentication of a socket does not authorize every
method on it. See [environment auth](./environment-auth.md).

### Efficient shell subscriptions

`orchestration.subscribeShell` is served from one projector per server, not one per socket.
[`ShellStream.ts`][shellstream] consumes the engine's domain event stream once, coalesces a 50 ms
window per aggregate, builds the shell items once, and fans the same batch out to every subscribed
socket; a socket only forwards its subscription (the RPC layer still JSON-encodes per client). Thread
events that only append a message or activity become a `thread-touched` delta
(`{threadId, updatedAt, sequence}`) with no DB read; events that reshape the shell row (turn,
session, plan, pin, title, approval/user-input activities, completed user messages) refetch and send
the full `thread-upserted`.

Resume replays (`afterSequence`) run the same projector over the event log, so live and replayed
streams agree. Clients opt in with `acceptThreadTouched: true` on `subscribeShell` (as they do for
the completion marker); a client that does not—a build predating the kind—gets the touched thread
refetched as a `thread-upserted` instead, so its decoder never sees an unknown kind. Clients apply
`thread-touched` in `packages/client-runtime/src/state/shellReducer.ts` and ignore it for unknown
threads.

### Pull request linking compatibility

Web, desktop, mobile, and environments upgrade independently. Negotiate linking through the
environment descriptor, never through a client version or an assumed coordinated release:

| Environment capability                | Client behavior                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `threadPullRequests: true`            | Use persisted `pullRequests[]`, multi-link commands, stack UI, and reverse thread lookup.                         |
| Only `threadPullRequestLinking: true` | Use `linkedPullRequest` and the existing `thread.meta.update` single-link operation. Do not call multi-link RPCs. |
| Neither flag                          | Hide linking actions; existing branch-discovered PR display remains available.                                    |

New environments continue advertising the legacy flag, accepting legacy metadata commands, and
emitting the derived `linkedPullRequest` field for older clients. That hostless field includes only
links in the thread project's own repository; cross-host and cross-repository links require the
multi-link protocol. New clients accept snapshots that
omit `pullRequests`. Retain the legacy wire fields, projection column, and replay support; this feature
does not schedule their removal. Missing new capabilities must also override cached multi-link data
after an environment downgrade.

Provider-specific behavior belongs behind an adapter. Orchestration works with normalized commands
and events, so adding a provider should not require branches throughout the domain or clients.
Five built-in drivers are registered in
[`builtInDrivers.ts`](../../apps/server/src/provider/builtInDrivers.ts): Codex, Claude, Cursor, Grok,
and Antigravity. See [provider constraints](./providers.md).

## Settings ownership

Client preferences stay in the current client; environment defaults and project overrides stay
on their owning server. The web and desktop settings target is URL state, resolved against current
connections and project membership. An unavailable target must not fall back to another environment.
**All environments** is an explicit bulk edit of connected, loaded servers, not a durable global
default or a promise to synchronize offline or future environments. Project-group targets similarly
select known environment-local checkouts; the group itself does not store inherited defaults.

## Durable intent and side effects

The event log is the source of truth for orchestration state. The
[v2 orchestrator](../../apps/server/src/orchestration-v2/Orchestrator.ts) serializes commands and
decides events without performing provider or filesystem work.
[EventSink](../../apps/server/src/orchestration-v2/EventSink.ts) commits events, persisted projections,
the accepted command receipt, and outbox effects in one database transaction. Subscribers receive
events after that commit. This keeps command retries idempotent and prevents a persisted projection
from getting ahead of the event log.

The [effect worker](../../apps/server/src/orchestration-v2/EffectWorker.ts) performs side effects
after intent has been recorded, then feeds results back into orchestration. A command acknowledgement
therefore means the intent committed, not that the provider, checkpoint, or other follow-up work
finished. Keep external I/O out of command decisions and the database transaction. Effects tied to
a lost provider process cannot simply replay; recovery retires them before admitting new work.

Not every runtime signal becomes a domain event. In-flight tool progress (`tool.updated`, one tick
per provider `tool_call_update` / input delta, dozens per call) is live-only:
[`ProviderRuntimeIngestion`][ingest] records the latest tick per `(thread, item)` in
[`ToolProgress.ts`][toolprogress] under the stable activity id `${itemId}:progress`, and the registry
publishes it as an ephemeral `thread.activity-appended` (`sequence: 0`, flagged `ephemeral: true` on
the `subscribeThread` item) that [`ws.ts`][ws] merges into the live tail. Clients apply it in place
without moving their resume cursor, and the thread detail snapshot splices the same activities in
so a fresh subscriber matches a live one.

Only `tool.started`, `tool.completed`, and coalesced progress are persisted: a tick is written under
that same stable id at most every `TOOL_PROGRESS_PERSIST_INTERVAL_MS` (3 s) per item, plus a final
flush of still-running items when the turn settles or the session exits, so projection growth tracks
tool calls, not ticks. Progress of a tool mid-flight at a crash is lost, while its started row
survives. Migration 047 is a marker: right after it lands, the Sqlite layer deletes the historical
per-tick rows a `tool.completed` in the same `(thread, turn, group)` supersedes, together with their
events and receipts. It applies the same rule the detail query uses at read time and performs the
cleanup best-effort in batched transactions so a disk-full mid-delete cannot block boot, then runs
one `VACUUM`; the detail query keeps read-side compaction for whatever remains.

Persisted events must remain decodable on replay. Changing a schema affects old environments at
startup as well as live RPC traffic. Compatibility work must account for stored history, not just
what the newest client sends.

## Turn completion and checkpoints

A provider turn ending and its follow-up work settling are separate milestones. Orchestration
records provider turn and run state independently from
[run finalization](../../apps/server/src/orchestration-v2/RunFinalizationService.ts). A late
checkpoint or diff must not extend the recorded provider duration or keep the client showing
provider work as active. PR discovery after completion also checks that the checkout still matches
the thread's non-default branch and that a newer run is not active.

[Checkpoints](../../apps/server/src/checkpointing/CheckpointStore.ts) use hidden Git refs to
capture workspace state without adding commits to the user's branch. A revert must coordinate
workspace state with the provider conversation. A provider that cannot roll back its conversation
must reject that operation before changing the filesystem.

Thread settlement is server-owned. The
[settlement service](../../apps/server/src/orchestration-v2/ThreadSettlementService.ts) evaluates PR
and inactivity settings without a connected client. Merge notifications invalidate cached PR state
and trigger a check. The guarded `thread.auto-settle` command rejects newer activity, explicit
settlement overrides, and live or blocked work. It records the activity timestamp for stable
sorting and detaches idle provider sessions. Clients render the persisted result; they do not
derive settlement from their own clocks or PR caches.

## Waiting for asynchronous work

Tests use [drainable workers](../../packages/shared/src/DrainableWorker.ts) to wait until both the
queue and its current item have finished. An empty queue alone does not prove the worker is idle.

V2 tests also drain the effect worker or await a specific persisted event or receipt. Test signals
are separate from the durable command receipts that make dispatch idempotent. Production behavior
must use persisted state and events, not test instrumentation or assumptions about elapsed time.

The Electron shell acquires `DesktopPreReadyPlatform.layer` synchronously before asynchronous
services. On Linux this sets the desktop-entry identity and global-shortcut portal flags before
Chromium initializes its portal connection. Setting the identity later in `DesktopAppIdentity`
is too late: Chromium caches the first registration, including failures. The identity must match
the installed entry managed by `DesktopLinuxUrlHandler`. Pre-ready setup also refreshes that entry's
`Exec` path before portal registration: AppImage updates can remove the previous executable, which
makes the old entry invalid even though its filename is correct. The later URL handler avoids
rewriting an identical entry while the portal may be reading it. On Wayland, Electron's synchronous
shortcut-registration result only confirms submission; it does not confirm desktop consent or
an active binding.

Native modules never load in the Electron main process on the startup path, and the two the
snapshot feature keeps are isolated: `@crowecawcaw/xa11y` runs only in forked Node-mode children
(`SnapShotAccessibilityWorker`, `RegionSnapShotWorker`) and a worker thread, and `ffi-rs` loads
lazily inside `WindowsForeground.ts` for a handful of Win32 calls. macOS window lookup shells out
to `osascript` instead of a native addon. A crash or stall in any of these must not take the app
down, so new native capability goes in a child with a deadline, not an `import` in main.

See the [glossary](./glossary.md) for shared terms and the
[development runbook](../operations/development.md) for setup and checks.

[shellstream]: ../../apps/server/src/orchestration/ShellStream.ts
[pipeline]: ../../apps/server/src/orchestration/Layers/ProjectionPipeline.ts
[ingest]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[toolprogress]: ../../apps/server/src/orchestration/ToolProgress.ts
[ws]: ../../apps/server/src/ws.ts
