# Automations

User-facing doc: [Automations](../user/automations.md). This page is the architecture.

An automation is a saved prompt plus triggers, stored as its own event-sourced aggregate. Every run
is an ordinary thread tagged `automationRun`, created and driven by one server service. No new
mutable state: everything the scheduler needs is derived from the read model, so a restart changes
nothing.

## Shape

- **Contracts:** `packages/contracts/src/automations.ts` — triggers (`AutomationScheduleTrigger`,
  `AutomationEventTrigger`, `AutomationWebhookTrigger`, `AutomationGitTrigger`), `Automation`,
  `AutomationRun`, `AutomationShell`, `AutomationsError`, the RPC and MCP tool payloads, and
  `validateAutomationCron`. Ids in `baseSchemas.ts` (`AutomationId`, `AutomationRunId`).
  `orchestration.ts` carries the four client commands (`automation.create`, `automation.update`,
  `automation.delete`, `automation.run.request`), the three internal ones (`automation.run.started`,
  `automation.run.finished`, `automation.run.missed`), the nine `automation.*` events, the
  `automations` array on the read model and the shell snapshot, the `automation-upserted` /
  `automation-removed` stream kinds, `OrchestrationSubscribeShellInput.acceptAutomations`, and
  `automationRun` on threads. `ModelSelection` / `RuntimeMode` moved to
  `packages/contracts/src/modelSelection.ts` (leaf) to break the cycle between `automations.ts` and
  `orchestration.ts`; `orchestration.ts` re-exports them, so existing imports are unchanged.
- **Shared helpers:** `packages/shared/src/automationSchedule.ts` — `nextAutomationRunAt`,
  `nextRunPreview`, `automationSchedulePresets`, `describeAutomationSchedule`,
  `automationRunTriggerLabel`; used by the projector, the scheduler, the MCP tools, web and mobile,
  so a "next run" is computed the same way everywhere.
  `packages/shared/src/automationRunPrompt.ts` — `buildAutomationRunSuffix`, the hidden
  `<automation_run source="t3-automations">` block appended after the user prompt.
  `packages/shared/src/hiddenInstructionBlocks.ts` — the generalized trailing-block stripper;
  `stripCreatePullRequestSuffix` now delegates to it, and every caller (search index, thread search,
  snapshot query, native resume, web timeline and terminal context, mobile feed and turn start)
  strips both blocks.
- **Server:** `apps/server/src/automations/`
  - `AutomationScheduler.ts` — the whole runtime: 30 s tick, run executor, completion tracker,
    event / git trigger sources, coalescing, retention, delete cascade. One
    `makeDrainableWorker`, so tests wait on `drain` instead of sleeping.
  - `AutomationWebhookHttp.ts` — `POST /hooks/automations/:automationId/:token`, mounted inside
    `makeRoutesLayer` next to `AppsHttp.layer` so it inherits the readiness and body-limit
    middleware and sits outside environment auth, like `/mcp`.
  - `apps/server/src/mcp/toolkits/automations/{tools,handlers}.ts` — the `t3-code-automations`
    toolkit, capability `automations`, mounted at `/mcp/automations`.
- **Persistence:** migration `apps/server/src/persistence/Migrations/050_Automations.ts` adds
  `projection_automations`, `projection_automation_runs` (indexed
  `(automation_id, requested_at DESC, run_id DESC)`) and `projection_threads.automation_run_json`.
  Repositories `ProjectionAutomations.ts` / `ProjectionAutomationRuns.ts`; projector
  `projection.automations` in `ProjectionPipeline.ts`, listed in `REQUIRED_SNAPSHOT_PROJECTORS`;
  `ProjectionSnapshotQuery.ts` gains `getAutomationShellById`, `listAutomationShells`,
  `listAutomationRuns`, `getAutomationRunById` and puts `automations` on the shell snapshot and the
  command read model.
- **Client runtime:** `packages/client-runtime/src/state/automations.ts` — the atoms, the
  `automations.listRuns` query family, the command wrappers, and the pure helpers
  (`isAutomationRunThread`, `groupAutomationRunsByDay`, `condenseAutomationRunGroup`,
  `automationStatus`, `automationNeedsAttention`, `formatUntilLabel`). `shellReducer.ts` handles the
  two new stream kinds and keeps the `automations` map identity stable across thread events. The
  shared list selectors filter run threads out by default; `useAllThreadShells()` is the escape
  hatch for automation surfaces, and `useThreadShell(ref)` still resolves any id.
- **Web:** the sidebar shelf (`Sidebar.tsx`, `SidebarAutomationRow`), the page
  `routes/automations.$environmentId.$automationId.tsx`, the form
  `components/automations/AutomationEditorDialog.tsx`, the project settings section, the run-thread
  banner in `ChatView`, and the two server-scoped rows in Settings → General.
- **Mobile:** `apps/mobile/src/features/automations/` (`AutomationsRouteScreen`,
  `AutomationsScreen`, `AutomationDetailScreen`) plus `state/automations.ts`, everything gated on
  `capabilities.automations === true`. View and control only; no editor, and no
  environment-paused banner.

## Run lifecycle

`AutomationRunStatus` is `requested | running | completed | failed | interrupted | skipped |
missed`. Only real runs (requested → running → completed / failed / interrupted), plus `skipped`
(schedule overlap) and `missed` (schedule instant dropped because catch-up is off) become rows.
Debounced triggers and coalesced non-manual triggers never create a row.

Decider rules for `automation.run.request`, which is the whole concurrency model, decided purely
from the read model:

- automation missing → rejection.
- `trigger.type === "manual"`: activeRun → rejection "A run is already in progress". Paused is
  allowed. Else → `run-requested`.
- `schedule`: paused → rejection; `scheduledFor < nextRunAt` (duplicate/late tick) → rejection;
  activeRun → `run-skipped` (row, error "Previous run still running"); else → `run-requested`.
- `event` / `git` / `webhook`: paused → rejection; `lastRequestedAt` within `minIntervalSeconds` →
  rejection (no row); activeRun → `run-coalesced` { trigger } (sets/replaces `pendingTrigger`, no
  row); else → `run-requested`.
- `run.started`: run must be the active run with `threadId === null` → `run-started`; else
  rejection.
- `run.finished`: run must be the active run → `run-finished`; else rejection (idempotent).
- `run.missed`: schedule trigger, paused → rejection; `scheduledFor < nextRunAt` → rejection; else
  `run-missed` (row).
- `project.delete` cascade emits `automation.deleted` for the project's automations **before**
  `project.deleted`.

The projector recomputes `nextRunAt` from `event.occurredAt` on create, update, `run-requested`,
`run-skipped` and `run-missed`, so the next instant always moves forward exactly once per handled
instant. `run-finished` clears `activeRun`, writes `lastRun`, and either resets or increments
`consecutiveFailures`.

## Scheduler

`AutomationScheduler` is a `Context.Service` with `start()` and `drain`, merged into
`ReactorLayerLive` and started from `serverRuntimeStartup`'s `reactors.start` like
`ProviderSessionReaper`. It owns no tables and no per-run timers; the read model is the state.

The 30 s tick skips entirely while `hostPower.suspended`, and skips its trigger sources when
`settings.automations.enabled` is false. Per automation it does four things:

1. **Due** — `enabled && nextRunAt <= now`: request a schedule run, or emit `automation.run.missed`
   when the instant is more than 90 s late and `catchUpMissedRuns` is off. One request per
   automation per tick, and the projector advances `nextRunAt`, so an outage of any length yields
   exactly one catch-up run.
2. **Stale request** — an active run still without a `threadId` after two minutes is failed with
   "The run never started (server restarted or thread creation failed)".
3. **Timeout** — `startedAt + timeoutMinutes < now` finishes the run as `interrupted`, then sends
   `thread.turn.interrupt`.
4. **Settled-thread sweep** — refetch the active run's thread shell and apply the completion rule.
   This is what makes completion restart-safe; the event-driven tracker is only an optimization.

Every dispatch uses a deterministic command id when the input is deterministic
(`server:automation-schedule:${automationId}:${scheduledFor}`, `server:automation-missed:…`,
`server:automation-run-${kind}:${runId}`), so a duplicate tick after a restart is rejected by the
engine rather than double-running.

The **executor** reacts to `automation.run-requested` on the hot domain stream: resolve the
automation and project, resolve the model (automation → project default → first enabled provider's
default), build the prompt (`automation.prompt` + the run block + optionally the auto-PR block),
`thread.create` with `automationRun`, dispatch `automation.run.started` **immediately**, then — for
worktree automations — fetch, `createWorktree`, `thread.meta.update`, the project setup script, and
finally `thread.turn.start`. Any failure after `run.started` finishes the run as failed and deletes
the thread and worktree.

The **completion rule** is shared by the tick sweep and the event tracker: a settled `latestTurn`
maps completed → `completed`, error → `failed`, interrupted → `interrupted`; a session in `error`
with no turn is `failed`; anything else is not finished. `summary` is the turn's final assistant
message trimmed to 2,000 characters, and feeds both the run row and the next run's
`includeLastRunSummary` block.

After a run finishes the scheduler requests the `pendingTrigger` if one is waiting (fresh run id),
then runs retention.

`AgentAwarenessRelay` skips run threads unless the phase is `failed`, `waiting_for_approval` or
`waiting_for_input`, so unattended work does not spam awareness consumers.

## Triggers

- **Schedule** — `effect/Cron` with a required IANA timezone. Consecutive instants must be at least
  five minutes apart; the check compares the first two instants from a fixed epoch. Clients preview
  next runs locally with the same helper, so there is no preview RPC.
- **Event** — the scheduler watches `thread.session-set` for threads **without** `automationRun`
  (completed → `turn.completed`, error → `turn.failed`) and `PullRequestService.subscribeMerges`
  for `pull-request.merged`, which is also skipped for run threads, so no run can re-trigger its own
  automation through any of the three. Merges performed outside T3 Code are invisible; the UI and
  the user doc say so. Settlement is detected with an in-memory `Map<ThreadId, TurnId>` filled on
  `session-set`, so a turn that was already running at boot, and the `ready` a session reports at
  boot, never fire an event. A merged pull request with no thread linked to it is skipped rather
  than routed to the project's most recent thread.
- **Webhook** — see below.
- **Git** — every `settings.automations.gitPollIntervalSeconds` (default 300), and only when some
  enabled automation has a git trigger: one `fetchRemote` (30 s timeout) plus
  `resolveRemoteTrackingCommit` per distinct `(workspaceRoot, branch)`, against an in-memory
  `lastSeenCommit`. The first observation baselines silently.

Event, git and webhook triggers share `minIntervalSeconds` for debounce and `run-coalesced` for
overlap, both enforced in the decider rather than in the scheduler, so they behave the same however
the request arrives. A stored `pendingTrigger` is re-requested after the active run finishes and on
every idle tick, and each attempt goes through the same decider rules, so it waits for the
automation and the environment to be resumed and for `minIntervalSeconds` to have elapsed.

## MCP toolkit

`t3-code-automations` at `${endpoint}/automations`, capability `automations`, attached to **every**
provider session (`ProviderService.prepareMcpSession`). Tools: `automations_list`,
`automations_get`, `automations_create`, `automations_update`, `automations_delete`,
`automations_run_now`, `automations_list_runs`, `automations_validate_schedule`. The project comes
from the caller's thread shell; handlers need only `OrchestrationEngineService` and
`ProjectionSnapshotQuery`.

Three guards, all in the handlers:

- Mutating tools and `run_now` fail when the caller's thread is itself a run thread, so an
  automation cannot create, edit or trigger automations.
- `runtimeMode` on create and update is clamped to the caller thread's own mode
  (`approval-required` < `auto-accept-edits` < `auto` < `full-access`, `yolo` ≡ `full-access`) and
  the clamp is reported in the result.
- Every automation-scoped tool rejects an automation from another project.

`AntigravityAdapter` now iterates `mcp.servers` like the ACP adapters, so it also receives the
computer-use and apps servers it was previously missing.

## Webhook route

`POST /hooks/automations/:automationId/:token`, outside environment auth. In order: look up the
shell (404 on unknown automation or token mismatch, compared in constant time); answer
`x-github-event: ping` with 200 and no run; an in-memory per-automation limiter of one accept per
5 s returns 429; a paused automation or a paused environment returns 409 `{ reason: "paused" }`; a
body over 256 KB returns 413 and the accepted body is truncated to 32 KB of JSON text for the
trigger; then dispatch the run request and answer 202 `{ runId }`, or 409 with the decider's
rejection reason. The token is minted in the decider (`Crypto.randomBytes`, base64url) whenever a
webhook trigger exists without one, or on `rotateWebhookToken`.

The payload is persisted on the run row but stripped from `automations.listRuns` results (and the
MCP list tools), which only render the trigger label. The agent reads it from the run's prompt, and
clients that need it call `automations.getRun`. A coalesced webhook still carries its payload in the
shell's `pendingTrigger` until the run is requested (`ponytail:` strip it there too if a busy webhook
automation shows up in shell-stream profiles).

`/hooks` is in `DEV_PROXIED_PATH_PREFIXES` (`packages/shared/src/devProxy.ts`) and the Vite proxy
map, so the composed webhook URL also answers in single-origin browser dev.

## Retention

`AUTOMATION_KEEP_RUN_THREADS = 25`. After each finished run, run rows with a `threadId` beyond the
newest 25 have their worktree removed (best effort, force) and their thread deleted; the row stays,
and the UI renders "Thread removed". The active run's thread is never touched. Run rows themselves
are pruned beyond 1,000 per automation in the projector. Deleting an automation interrupts an
active run and deletes every run thread of that automation; deleting a project cascades into its
automations first.

Both retention and the delete cascade find the run threads by filtering `getShellSnapshot().threads`
on `automationRun.automationId`, not by reading the runs table: run rows keep their `threadId` after
the thread is gone, so the table would re-dispatch a delete for every historical row, and on
`automation.deleted` the projector has already removed the rows before the scheduler runs. The
cascade therefore writes no `run.finished { interrupted }` row either — the automation is gone, so
the decider would reject it, and no interrupted history survives a delete.

## Known ceilings

- `ponytail:` the executor duplicates `ws.ts`'s `dispatchBootstrapTurnStart` sequence (create →
  worktree → setup script → turn start). Extracting a shared bootstrap would touch the hottest path
  in the server for no behavior change; do it when a third caller appears.
- `ponytail:` rotating a webhook token does not remove the old one from the event log. The event
  store is append-only and the token only authorizes run requests for one automation; a token
  leaked through the log implies the log is already readable.
- Git triggers poll, so pushes that land while the server is down are never observed — the next
  poll baselines the new commit silently. A repository webhook covers that case.
- `ponytail:` the event source's running-turn map lives in process memory, so turns that were
  already running at a restart never fire `turn.completed` / `turn.failed` (see Triggers). The tick
  sweep still finishes the _runs_ correctly; only the event triggers of other people's threads miss
  that one settlement.
- `ponytail:` checkpoint refs of deleted run threads are not pruned. They are hidden refs in the
  project's repository and cost bytes, not correctness.
- `pull-request.merged` fires only for merges performed inside T3 Code
  (`PullRequestService.subscribeMerges`). External merges need a webhook trigger.
- `ponytail:` the webhook rate limiter is one in-memory map in the process. One environment is one
  process, so this is exact today; it would need shared state only if the server ever forks.
- `ponytail:` every `automation-upserted` carries the automation's full prompt and webhook token,
  because the shell is one schema for definition and derived run state. Split a lighter run-state
  delta out of it if a long prompt ever shows up in socket profiles.
- `ponytail:` mobile's "Show more" grows the single page's `limit` by
  `AUTOMATION_LIST_RUNS_DEFAULT_LIMIT` up to `AUTOMATION_LIST_RUNS_MAX_LIMIT` (200) instead of
  following `nextCursor`, which keeps the list one live atom and day grouping trivial. Switch to
  cursor paging if anyone needs more than 200 runs on a phone.
