# Glossary

> For maintainers. Using T3 Code? See [docs/user](../user/).

This is a living glossary for T3 Code. It explains what common terms mean in this codebase.

## Table of contents

- [Project and workspace](#project-and-workspace)
- [Thread timeline](#thread-timeline)
- [Orchestration](#orchestration)
- [Provider runtime](#provider-runtime)
- [Checkpointing](#checkpointing)
- [Appearance](#appearance)
- [Skills](#skills)

## Concepts

### Project and workspace

#### Environment

One running server and the machine, credentials, workspace access, and state it owns.

#### Client

A web, desktop, or mobile UI connected to an environment. The desktop app can also host a server.

#### Project

The top-level, environment-local workspace record in the app. In [the orchestration contracts][1], a project has a `workspaceRoot` and a title. It does not contain threads: `OrchestrationProject` and `OrchestrationThread` are separate arrays on the read model, and a project can have zero threads. See [workspace-layout.md][2].

#### Workspace root

The root filesystem path for a project. In [the orchestration model][1], it is the base directory for branches and optional worktrees. See [workspace-layout.md][2].

#### Worktree

A Git worktree used as an isolated workspace for a thread. If a thread has a `worktreePath` in [the contracts][1], it runs there instead of in the main working tree. Git operations live behind the VCS driver contract in `apps/server/src/vcs/VcsDriver.ts`, implemented by [GitVcsDriverCore.ts][3].

#### T3 home

The base data directory. Runtime state normally lives under its `userdata` directory.

#### Storage inventory

A server-side scan of **managed worktrees** under the environment's worktrees folder (`storage.getInventory` / `storage.streamInventory` / `storage.removeOrphan` in [the contracts][1]). Clients gate on the `storageInventory` capability and never probe older servers. Servers that advertise `storageInventoryStream` push incremental inventories while the walk is still running; older servers only answer the unary query. Project checkouts outside that folder are never listed or deleted. Unique paths are counted once when several threads share a checkout. `isDirty === null` is unsafe, never clean.

#### Project transfer

A server-to-server copy of a project workspace into another managed environment. **Copy** transfers
one thread's conversation and leaves the source unchanged. **Move** transfers every thread in the
project, then deletes the source T3 project (and the workspace directory only when it lives under
the source environment's managed projects folder). Provider sessions, checkpoints, attachments,
dependencies, and build caches do not move. See [T3 Connect](./t3-connect.md#project-and-thread-transfer).

### Thread timeline

#### Thread

The main durable unit of conversation and workspace history. It survives provider process exits. In [the orchestration contracts][1], a thread holds messages, activities, checkpoints, and session-related state. See [projector.ts][4].

#### Turn

A single user-to-assistant work cycle inside a thread. It starts with user input and ends when the session leaves `running` status, which [projector.ts][4] treats as the authoritative completion signal (`settledTurnStateForSessionStatus`). Checkpoint and diff work may settle afterward without changing when the turn ended. See [the contracts][1] and [ProviderRuntimeIngestion.ts][5].

#### Delivery mode

How a user message sent while a turn is running reaches the agent. `thread.turn.start` carries an optional `delivery` field (`TurnDeliveryMode` in [the contracts][1]): `steer` (the default) hands the message to the provider adapter immediately so it lands inside the running turn — natively for Claude (SDK prompt queue) and Codex (`turn/steer`), as-soon-as-accepted for the ACP providers, whose protocol serializes prompts. `queue` holds the turn start in `ProviderCommandReactor` until the session leaves `running`, then dispatches one queued message per turn boundary in arrival order. The queue is in-memory, matching the reactor's hot-stream durability. See [decider.ts][8].

#### Activity

A user-visible log item attached to a thread. In [the contracts][1], activities cover important non-message events like approvals, tool actions, and failures. They are projected into thread state in [projector.ts][4].

#### Activity headline

A short model-generated status line for the running turn, published as a `turn.headline` activity with the stable id `${turnId}:headline` so the projector replaces it in place. `ActivityHeadlineReactor` (in `apps/server/src/orchestration/Layers/`) watches persisted tool and error activities, coalesces per thread, and asks the text generation model (the `textGenerationModelSelection` setting, gated by `generateActivityHeadlines`) for a readable rewrite; web's live activity row prefers it over raw tool summaries. Never shown in the settled work log.

#### Search index

The plain-table inverted index behind `orchestration.searchThreads`: `search_index_docs` / `search_index_terms` / `search_index_postings` (migration 049), maintained by the `projection.search-index` projector in [ProjectionPipeline.ts][11] and read with BM25 ranking in `apps/server/src/search/ThreadSearch.ts`. It indexes user messages (visible text only, auto-PR instruction block stripped) and canonical assistant messages (turn-final `assistant_message_id` rows), and drops those entries when a thread is archived, deleted, or reverted, or when its project is deleted. Plain tables because the production SQLite driver (`node:sqlite`) ships without FTS5; query semantics are AND of content tokens (stopwords and truncated common terms rank without filtering) with prefix matching on the final query token.

### Orchestration

Orchestration is the server-side domain layer that turns runtime activity into stable app state. The main entry point is [OrchestrationEngine.ts][7], with core logic in [decider.ts][8] and [projector.ts][4].

#### Aggregate

The domain object a command or event belongs to. In [the contracts][1], that is usually `project` or `thread`. See [decider.ts][8].

#### Command

A typed request to change domain state. Accepting it does not mean its side effects have finished. In [the contracts][1], commands are validated in [commandInvariants.ts][9] and turned into events by [decider.ts][8].
Examples include `thread.create`, `thread.turn.start`, and `thread.checkpoint.revert`.

#### Domain Event

A persisted fact that something already happened. In [the contracts][1], events are the source of truth, and [projector.ts][4] shows how they are applied.
Examples include `thread.created`, `thread.message-sent`, and `thread.turn-diff-completed`.

#### Decider

The pure orchestration logic that turns commands plus current state into events. The core implementation is in [decider.ts][8], with preconditions in [commandInvariants.ts][9].

#### Projection

A read-optimized view derived from events. See [projector.ts][4], [ProjectionPipeline.ts][11], and [ProjectionSnapshotQuery.ts][10].

#### Projector

The logic that applies domain events to the read model or projection tables. See [projector.ts][4] and [ProjectionPipeline.ts][11].

#### Read model

The current materialized view of orchestration state. In [the contracts][1], it holds projects, threads, messages, activities, checkpoints, and session state. See [ProjectionSnapshotQuery.ts][10] and [OrchestrationEngine.ts][7].

#### Thread-touched

The cheap shell stream delta (`{threadId, updatedAt, sequence}`) sent instead of a full `thread-upserted` when a thread event only appended a message or activity, so a streaming turn does not re-send the whole `OrchestrationThreadShell` per delta. Built once per server in [ShellStream.ts][25] and fanned out to every `subscribeShell` subscriber. See [the contracts][1].

#### Ephemeral event

A `thread.activity-appended` that is streamed to `subscribeThread` subscribers but never appended to the event store: it carries `sequence: 0` and the stream item is flagged `ephemeral: true`, so clients apply it in place without moving their resume cursor (older clients drop it at their cursor gate). Used for in-flight tool progress: [ToolProgress.ts][26] keeps the latest `tool.updated` per `(thread, item)` under the stable id `${itemId}:progress`, splices it into thread detail snapshots, and only a coalesced tick (at most every 3 s) plus a turn-end flush is persisted. See [the contracts][1] and [ProviderRuntimeIngestion.ts][5].

#### Reactor

A side-effecting service that handles follow-up work after events or runtime signals. Examples include [CheckpointReactor.ts][6], [ProviderCommandReactor.ts][12], and [ProviderRuntimeIngestion.ts][5].

#### Command receipt

A durable record of a command's result, used to make retries idempotent.

#### Runtime receipt

A typed test-only signal emitted when an async milestone completes, such as `checkpoint.baseline.captured`, `checkpoint.diff.finalized`, or `turn.processing.quiesced`. The production `RuntimeReceiptBusLive` publish is a no-op and only the test layer is PubSub-backed. Do not build production behavior on runtime receipts. See [RuntimeReceiptBus.ts][13] and [CheckpointReactor.ts][6].

#### Quiesced

"Quiesced" means a turn has gone quiet and stable: follow-up work such as [CheckpointReactor.ts][6] has settled. It appears in [the runtime receipt schema][13], so in practice it is something tests wait on rather than a production signal.

#### Automation

A saved prompt plus triggers that the server runs unattended for a project, stored as its own event-sourced aggregate (`aggregateKind: "automation"`). Triggers are schedule (cron + required IANA timezone), manual, in-app event, webhook, and git remote change. Definition and derived run state live in `projection_automations` and reach clients as `AutomationShell` on the shell snapshot. See `packages/contracts/src/automations.ts`, `apps/server/src/automations/AutomationScheduler.ts`, and [automations.md](./automations.md).

#### Automation run

One execution of an automation: a row in `projection_automation_runs` with a status of `requested`, `running`, `completed`, `failed`, `interrupted`, `skipped` (a scheduled instant that collided with a still-running run) or `missed` (a scheduled instant dropped because catch-up is off). Concurrency is decided in [decider.ts][8] from the read model — one active run per automation — not by the scheduler. See [automations.md](./automations.md).

#### Run thread

The ordinary thread an automation run works in, marked by `automationRun: { automationId, runId }` on the thread. Run threads are filtered out of the default thread-list selectors in `packages/client-runtime` and withheld from clients that did not send `acceptAutomations`, so they are reachable only from their automation. Retention deletes the threads of all but the 25 most recent runs; the run row survives and renders "Thread removed".

#### Coalesced trigger

A non-manual trigger (event, git or webhook) that arrived while a run was already active. The decider emits `automation.run-coalesced` instead of a run, which stores the trigger as `pendingTrigger` on the automation; the scheduler requests exactly one follow-up run when the active run finishes. A burst of pushes therefore produces one extra run, not one per push.

### Provider runtime

The live backend agent implementation and its event stream. The main service is [ProviderService.ts][14], the adapter contract is [ProviderAdapter.ts][15], and the overview is in [providers.md][16].

#### Provider

The agent runtime T3 Code controls to perform work. Six drivers ship built in: Codex, Claude, Cursor, Grok, Kimi, and Antigravity. See [ProviderService.ts][14], [ProviderAdapter.ts][15], and [CodexAdapter.ts][17] as a representative adapter.

#### Driver

The integration for a provider kind.

#### Provider instance

One configured provider, with its own settings and lifecycle. Multiple instances can use the same driver.

#### Adapter

The boundary translating a provider's native protocol into T3 Code operations and events.

#### Session

The live provider-backed runtime attached to a thread. A session can be stopped and resumed without deleting the thread. Session shape is in [the orchestration contracts][1], and lifecycle is managed in [ProviderService.ts][14].

#### Runtime mode

The safety/access and permission policy for a thread or session. [The contracts][1] define four values: `approval-required`, `auto-accept-edits`, `auto`, and `full-access`. See [permission modes][18].

#### Interaction mode

The agent interaction style for a thread, separate from its permission policy. In [the contracts][1], the values are `default` and `plan`.

#### Subagent policy

Whether a thread may spawn provider-native children, and which model those children should use. Global defaults live in server settings; a thread can inherit, turn spawning off, or pin its own child. T3 observes native Task/collab children — it does not spawn them. See [subagents](../user/subagents.md) and `packages/contracts/src/subagentPolicy.ts`.

#### App

An external service (Gmail, GitHub, Linear, …) connected to an environment as a remote MCP server, reached by every provider through the server's `/mcp/apps/<id>` proxy — alongside the built-in MCP servers `t3-code`, `t3-code-computer` (`${endpoint}/computer-use`) and `t3-code-automations` (`${endpoint}/automations`) — and addressed in chat as `@slug`. Records live in `ServerSettings.apps` (server-written), credentials in the secret store. See `packages/contracts/src/apps.ts`, `packages/contracts/src/appsCatalog.ts`, and [apps.md](./apps.md).

#### Assistant delivery mode

Controls how assistant text reaches the thread timeline. In [the contracts][1], `streaming` updates incrementally and `buffered` accumulates text. Buffered delivery is not held until the turn completes: it spills once accumulated text would exceed 24,000 characters, and flushes at approval and user-input boundaries. See [ProviderRuntimeIngestion.ts][5].

#### Snapshot

A point-in-time view of state. The word is used in multiple layers, including orchestration, provider, and checkpointing. See [ProjectionSnapshotQuery.ts][10], [ProviderAdapter.ts][15], and [CheckpointStore.ts][19].

#### Usage limits

The rolling subscription quota windows a provider reports for its signed-in account, such as Claude's five-hour and weekly windows or Codex's primary and secondary allowances. Each driver decides in its own `checkProvider` whether it has any and returns them on the snapshot as `usageLimits`; drivers with no notion of subscription usage leave the field absent. Adapters that receive rate-limit telemetry during a turn normalise it into a `ProviderUsageLimitsUpdate` at the boundary, and `ProviderUsageLimitsIngestion` folds it onto the owning instance's snapshot through `ServerProviderShape.applyUsageLimits`, so no central service needs to know a driver kind. See [providerUsageLimits.ts](../../packages/contracts/src/providerUsageLimits.ts) and [makeManagedServerProvider.ts](../../apps/server/src/provider/makeManagedServerProvider.ts).

#### Usage limit source

A read-only quota feed outside this environment's provider CLIs, configured under `settings.usageLimitSources`. The only kind today is a CLIProxyAPI hub, whose `quota-scheduler/status` reports the windows of every pooled account. `UsageLimitSources` polls each source on the provider health interval and publishes `UsageLimitSourceSnapshot`s over the config stream as `usageLimitSourcesUpdated`, gated by a client capability flag the way environment themes are. The management key round-trips through the secret store with a redaction marker on disk. See [UsageLimitSources.ts](../../apps/server/src/usage/UsageLimitSources.ts).

#### Model manifest

The per-driver list of current model slugs that decides which models land in the model picker's legacy section. Bundled at `apps/server/src/provider/model-manifest.json` and refreshed at runtime from the same file on `main`, so classification updates ship as commits instead of releases. See the [provider architecture][16] model manifest section.

### Checkpointing

Checkpointing captures workspace state over time so the app can diff turns and restore earlier points. The main pieces are [CheckpointStore.ts][19], [CheckpointDiffQuery.ts][20], and [CheckpointReactor.ts][6].

#### Checkpoint

A saved snapshot of a thread workspace at a particular turn. In practice it is a hidden Git ref in [CheckpointStore.ts][19] plus a projected summary from [ProjectionCheckpoints.ts][21]. Capture and lifecycle work happen in [CheckpointReactor.ts][6].

#### Checkpoint ref

The durable identifier for a filesystem checkpoint, stored as a Git ref. It is typed in [the contracts][1], constructed in [Utils.ts][22], and used by [CheckpointStore.ts][19].

#### Checkpoint baseline

The workspace state captured before the work being compared, used as the starting checkpoint for diffing a thread timeline. This flow is surfaced through [RuntimeReceiptBus.ts][13], coordinated in [CheckpointReactor.ts][6], and supported by [Utils.ts][22].

#### Checkpoint diff

The difference between two checkpoints. [CheckpointDiffQuery.ts][20] reads full patches on demand. [CheckpointReactor.ts][6] uses NUL-delimited Git numstat output for automatic file summaries, parsed by [Diffs.ts][23].

#### Turn diff

The file patch and changed-file summary attributed to one turn. It is usually computed in [CheckpointDiffQuery.ts][20], represented in [the contracts][1], and recorded into thread state by [projector.ts][4].

### Appearance

#### Environment theme

A theme an environment's machine publishes for clients to follow, one file per theme under `themes/` in that environment's state directory; the filename is the theme id. [environmentTheme.ts][27] watches the directory and streams the set over `subscribeServerConfig`; clients render each as a library card, generating a full palette when the file carries seed colors and using the palette directly when it is a standard exported theme file. A desktop that retints its apps when the system theme changes rewrites its file, so T3 Code follows along without a restart. See [environment-theme.md][28].

#### Default theme

The environment's theme, held in its `settings.json` as `defaultTheme` (with `defaultThemeSetAt`
as the set-generation) and set with `t3 theme set <id>`. Web and desktop clients apply each set
once — live when connected, on the next connect otherwise — so setting it switches them, while a
theme a user picks in Settings afterwards sticks until the next set; mobile keeps its own
appearance settings. Naming a published [environment theme](#environment-theme) is how a desktop
ships T3 Code already matching it.

### Skills

#### Skill

One folder holding a `SKILL.md` (YAML frontmatter with `name` and `description`, then the instructions). Provider CLIs discover skills by folder name from their own user-scope `skills/` directory and from project roots; the folder name is what `$mention` and slash invocations use. Contracts live in [skills.ts][29].

#### Skill library

The host's skill folders seen as one inventory: the shared `~/.agents/skills` (read natively by Codex and Cursor) plus each provider CLI's own folder (`~/.claude/skills`, `~/.cursor/skills`, `~/.grok/skills`, `~/.codex/skills`, and configured instance homes). [SkillLibrary.ts][30] scans every location, resolves symlinks, and reports one `Skill` per real folder with the locations it is present in. There is no T3-private store; marketplace installs land in the shared folder and link into the providers that need a link, matching the layout `npx skills` writes.

#### Skill location

One scanned folder, keyed `agents`, `<driver>`, or `<driver>:<instanceId>`; a provider location exists only while its CLI home folder (`~/.claude`, …) does. A location's `reads` lists the locations its CLI also scans natively, so a skill is _visible_ to a CLI when it is present in any of them and _linked_ when the CLI's own folder has an entry. Enabling a skill for a provider adds a relative symlink (a junction on Windows); disabling removes it. Nothing inside a skill folder is renamed or rewritten.

#### Attached skill

A per-thread pick (`enabledSkillIds` on the thread, set at creation or by `thread.skills.set`). At turn start the provider command reactor resolves the picks through the library and sends their `SKILL.md` bodies ahead of the user's message as the skill prelude, once per thread and again after a provider handoff; each one is recorded as a `skill.loaded` activity. Pre-library ids (`owner/repo:path`) fold onto `host:agents:<dir>`. User-facing behavior is in [skills.md][31].

## Practical Shortcuts

- If you see `requested`, think "intent recorded".
- If you see `completed`, think "result applied".
- If you see `command receipt`, think "durable command result for idempotent retries".
- If you see `runtime receipt`, think "async milestone signal, for tests".
- If you see `checkpoint`, think "workspace snapshot for diff/restore".
- If you see `quiesced`, think "all relevant follow-up work has gone idle".

## Related Docs

- [Architecture overview][24]
- [Provider architecture][16]
- [Permission modes][18]
- [Workspace layout][2]

[1]: ../../packages/contracts/src/orchestration.ts
[2]: ./workspace-layout.md
[3]: ../../apps/server/src/vcs/GitVcsDriverCore.ts
[4]: ../../apps/server/src/orchestration/projector.ts
[5]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[6]: ../../apps/server/src/orchestration/Layers/CheckpointReactor.ts
[7]: ../../apps/server/src/orchestration/Layers/OrchestrationEngine.ts
[8]: ../../apps/server/src/orchestration/decider.ts
[9]: ../../apps/server/src/orchestration/commandInvariants.ts
[10]: ../../apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
[11]: ../../apps/server/src/orchestration/Layers/ProjectionPipeline.ts
[12]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[13]: ../../apps/server/src/orchestration/Services/RuntimeReceiptBus.ts
[14]: ../../apps/server/src/provider/Layers/ProviderService.ts
[15]: ../../apps/server/src/provider/Services/ProviderAdapter.ts
[16]: ./providers.md
[17]: ../../apps/server/src/provider/Layers/CodexAdapter.ts
[18]: ../user/permission-modes.md
[19]: ../../apps/server/src/checkpointing/CheckpointStore.ts
[20]: ../../apps/server/src/checkpointing/CheckpointDiffQuery.ts
[21]: ../../apps/server/src/persistence/Services/ProjectionCheckpoints.ts
[22]: ../../apps/server/src/checkpointing/Utils.ts
[23]: ../../apps/server/src/checkpointing/Diffs.ts
[24]: ./overview.md
[25]: ../../apps/server/src/orchestration/ShellStream.ts
[26]: ../../apps/server/src/orchestration/ToolProgress.ts
[27]: ../../apps/server/src/environmentTheme.ts
[28]: ../user/environment-theme.md
[29]: ../../packages/contracts/src/skills.ts
[30]: ../../apps/server/src/skills/SkillLibrary.ts
[31]: ../user/skills.md
