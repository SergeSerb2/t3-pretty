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

Provider-specific behavior belongs behind an adapter. Orchestration works with normalized commands
and events, so adding a provider should not require branches throughout the domain or clients.
Six built-in drivers are registered in
[`builtInDrivers.ts`](../../apps/server/src/provider/builtInDrivers.ts): Codex, Claude, Cursor, Grok,
Kimi, and Antigravity. See [provider constraints](./providers.md).

## Durable intent and side effects

The event log is the source of truth for orchestration state. The
[engine](../../apps/server/src/orchestration/Layers/OrchestrationEngine.ts) serializes commands;
the [decider](../../apps/server/src/orchestration/decider.ts) produces events without performing
provider or filesystem work. Events, persisted projections, and the accepted command receipt commit
in one database transaction. The in-memory state changes and subscribers receive events after that
commit. This keeps command retries idempotent and prevents a persisted projection from getting
ahead of the event log.

[`ProjectionPipeline.ts`][pipeline] runs every table projector for an event inside that transaction
(one savepoint per event, not per projector), then advances all `projection_state` cursors in one
multi-row upsert; a failing projector fails the whole event. Per-projector cursor rows survive only
for bootstrap catch-up, where each projector replays independently from its own cursor. Attachment
cleanup runs after the savepoint and only when a projector queued work.

Command receipts live in `orchestration_command_receipts`. The engine prunes receipts older than
72 hours at boot and hourly, in bounded batches, so retries are idempotent within that window and
the table stays small.

Reactors perform side effects after intent has been recorded, then feed results back through
commands. A command acknowledgement therefore means the intent committed, not that the provider,
checkpoint, or other follow-up work finished. Keep external I/O out of the decider and the database
transaction.

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

A turn ending and its follow-up work settling are separate milestones. The
[projector](../../apps/server/src/orchestration/projector.ts) settles the turn from its session
status. A late checkpoint or diff must not extend the recorded turn duration or keep the client
showing provider work as active.

[Checkpoints](../../apps/server/src/checkpointing/CheckpointStore.ts) use hidden Git refs to
capture workspace state without adding commits to the user's branch. A revert must coordinate
workspace state with the provider conversation. A provider that cannot roll back its conversation
must reject that operation before changing the filesystem.

## Waiting for asynchronous work

Tests use [drainable workers](../../packages/shared/src/DrainableWorker.ts) to wait until both the
queue and its current item have finished. An empty queue alone does not prove the worker is idle.

Runtime receipts mark specific test milestones. Their
[production layer](../../apps/server/src/orchestration/Layers/RuntimeReceiptBus.ts) is a no-op;
production behavior must use persisted state and events. These test signals are separate from the
durable command receipts that make dispatch idempotent.

See the [glossary](./glossary.md) for shared terms and the
[development runbook](../operations/development.md) for setup and checks.

[shellstream]: ../../apps/server/src/orchestration/ShellStream.ts
[pipeline]: ../../apps/server/src/orchestration/Layers/ProjectionPipeline.ts
[ingest]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[toolprogress]: ../../apps/server/src/orchestration/ToolProgress.ts
[ws]: ../../apps/server/src/ws.ts
