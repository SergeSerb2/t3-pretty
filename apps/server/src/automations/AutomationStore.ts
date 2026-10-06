import {
  Automation,
  AutomationId,
  automationCreatePullRequestDefault,
  automationWebhookPath,
  type AutomationCommand,
  type AutomationRun,
  type AutomationRunId,
  type AutomationShell,
  type AutomationStreamMessage,
  type AutomationsListRunsInput,
  type AutomationsListRunsResult,
} from "@t3tools/contracts";
import { nextAutomationRunAt } from "@t3tools/shared/automationSchedule";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Definitions from "../persistence/Services/ProjectionAutomations.ts";
import * as Runs from "../persistence/Services/ProjectionAutomationRuns.ts";
import * as ProjectService from "../project/ProjectService.ts";

export class AutomationStoreError extends Schema.TaggedError<AutomationStoreError>()(
  "AutomationStoreError",
  {
    automationId: Schema.optional(AutomationId),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return this.detail;
  }
}

type PendingAutomationStoreEvent =
  | { readonly type: "automation.updated"; readonly automation: AutomationShell }
  | { readonly type: "automation.removed"; readonly automationId: AutomationId }
  | { readonly type: "automation.run-requested"; readonly run: AutomationRun }
  | { readonly type: "automation.run-finished"; readonly automationId: AutomationId };

export type AutomationStoreEvent =
  | Exclude<AutomationStreamMessage, { type: "automation.snapshot" }>
  | Extract<
      PendingAutomationStoreEvent,
      { type: "automation.run-requested" | "automation.run-finished" }
    >;

export class AutomationStore extends Context.Service<
  AutomationStore,
  {
    readonly dispatch: (command: AutomationCommand) => Effect.Effect<void, AutomationStoreError>;
    readonly listAutomationShells: () => Effect.Effect<
      ReadonlyArray<AutomationShell>,
      AutomationStoreError
    >;
    readonly getAutomationShellById: (
      id: AutomationId,
    ) => Effect.Effect<Option.Option<AutomationShell>, AutomationStoreError>;
    readonly listAutomationRuns: (
      input: AutomationsListRunsInput,
    ) => Effect.Effect<AutomationsListRunsResult, AutomationStoreError>;
    readonly getAutomationRunById: (
      id: AutomationRunId,
    ) => Effect.Effect<Option.Option<AutomationRun>, AutomationStoreError>;
    readonly subscribeChanges: Stream.Stream<AutomationStoreEvent>;
    readonly subscribeAutomationChanges: () => Stream.Stream<
      AutomationStreamMessage,
      AutomationStoreError
    >;
  }
>()("t3/automations/AutomationStore") {}

const isAutomationStoreError = Schema.is(AutomationStoreError);

const toShell = (row: Definitions.ProjectionAutomation): AutomationShell => ({
  ...row,
  webhookPath: row.webhookToken === null ? null : automationWebhookPath(row.id, row.webhookToken),
});

const make = Effect.gen(function* () {
  const definitions = yield* Definitions.ProjectionAutomationRepository;
  const runs = yield* Runs.ProjectionAutomationRunRepository;
  const projects = yield* ProjectService.ProjectService;
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const changes = yield* PubSub.unbounded<AutomationStoreEvent>();
  const mutations = yield* Semaphore.make(1);
  const mapError = (cause: unknown) =>
    isAutomationStoreError(cause)
      ? cause
      : new AutomationStoreError({ detail: "Could not persist automations.", cause });
  const token = crypto
    .randomBytes(32)
    .pipe(Effect.map((bytes) => Buffer.from(bytes).toString("base64url")));
  const getAutomationShellById = (id: AutomationId) =>
    definitions
      .getById({ automationId: id })
      .pipe(Effect.map(Option.map(toShell)), Effect.mapError(mapError));
  const listAutomationShells = () =>
    definitions.listAll().pipe(
      Effect.map((rows) => rows.map(toShell)),
      Effect.mapError(mapError),
    );
  const listAutomationRuns = Effect.fn("AutomationStore.listAutomationRuns")(function* (
    input: AutomationsListRunsInput,
  ) {
    const before =
      input.beforeCursor === undefined
        ? undefined
        : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Runs.AutomationRunPageCursor))(
            Buffer.from(input.beforeCursor, "base64url").toString("utf8"),
          ).pipe(Effect.mapError(mapError));
    const rows = yield* runs
      .listPage({
        automationId: input.automationId,
        limit: input.limit + 1,
        ...(before === undefined ? {} : { before }),
      })
      .pipe(Effect.mapError(mapError));
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    const encodedCursor =
      rows.length > input.limit && last !== undefined
        ? yield* Schema.encodeEffect(Schema.fromJsonString(Runs.AutomationRunPageCursor))({
            requestedAt: last.requestedAt,
            runId: last.id,
          }).pipe(Effect.mapError(mapError))
        : null;
    return {
      runs: page,
      nextCursor: encodedCursor === null ? null : Buffer.from(encodedCursor).toString("base64url"),
    };
  });
  const getAutomationRunById = (id: AutomationRunId) =>
    runs.getById({ runId: id }).pipe(Effect.mapError(mapError));

  const apply = Effect.fn("AutomationStore.apply")(function* (command: AutomationCommand) {
    const events: Array<PendingAutomationStoreEvent> = [];
    const now = DateTime.formatIso(yield* DateTime.now);
    const seen =
      yield* sql`SELECT command_id FROM automation_command_receipts WHERE command_id = ${command.commandId}`;
    if (seen.length > 0) return [] as Array<AutomationStoreEvent>;
    const existing = Option.getOrNull(
      yield* definitions.getById({ automationId: command.automationId }),
    );
    const fail = (detail: string) =>
      new AutomationStoreError({ automationId: command.automationId, detail });
    let row: Definitions.ProjectionAutomation;
    if (command.type === "automation.create") {
      if (existing !== null) return yield* fail("Automation already exists.");
      if (Option.isNone(yield* projects.getById(command.projectId)))
        return yield* fail("Project not found.");
      const automation = yield* Schema.decodeUnknownEffect(Automation)({
        ...command,
        id: command.automationId,
        sourceThreadId: command.sourceThreadId ?? null,
        createPullRequest:
          command.createPullRequest ?? automationCreatePullRequestDefault(command.workspace),
        webhookToken: command.triggers.some((trigger) => trigger.type === "webhook")
          ? yield* token
          : null,
        createdAt: now,
        updatedAt: now,
      });
      row = {
        ...automation,
        nextRunAt: nextAutomationRunAt(automation.triggers, automation.enabled, now),
        activeRun: null,
        lastRun: null,
        lastRequestedAt: null,
        pendingTrigger: null,
        consecutiveFailures: 0,
        runCount: 0,
      };
    } else {
      if (existing === null) return yield* fail("Automation not found.");
      row = existing;
      switch (command.type) {
        case "automation.update": {
          const triggers = command.patch.triggers ?? row.triggers;
          const hasWebhook = triggers.some((trigger) => trigger.type === "webhook");
          const definition = yield* Schema.decodeUnknownEffect(Automation)({
            ...row,
            ...command.patch,
            triggers,
            updatedAt: now,
            webhookToken: !hasWebhook
              ? null
              : command.rotateWebhookToken || row.webhookToken === null
                ? yield* token
                : row.webhookToken,
          });
          const scheduleChanged =
            command.patch.enabled !== undefined || command.patch.triggers !== undefined;
          row = {
            ...row,
            ...definition,
            nextRunAt: scheduleChanged
              ? nextAutomationRunAt(triggers, definition.enabled, now)
              : row.nextRunAt,
          };
          break;
        }
        case "automation.delete":
          yield* definitions.deleteById({ automationId: row.id });
          yield* runs.deleteByAutomationId({ automationId: row.id });
          events.push({ type: "automation.removed", automationId: row.id });
          break;
        case "automation.run.request": {
          const manual = command.trigger.type === "manual";
          if (!manual && !row.enabled) return yield* fail("Automation is paused.");
          const scheduled = command.trigger.type === "schedule";
          if (scheduled && row.nextRunAt !== command.trigger.scheduledFor)
            return yield* fail("Schedule instant is no longer due.");
          const debounced =
            !manual &&
            !scheduled &&
            row.lastRequestedAt !== null &&
            Date.parse(command.requestedAt) <
              Date.parse(row.lastRequestedAt) + row.minIntervalSeconds * 1000;
          if (!scheduled && debounced) return yield* fail("Minimum interval has not elapsed.");
          const overlapping = row.activeRun !== null;
          if (overlapping && !scheduled) {
            if (manual) return yield* fail("Automation is already running.");
            row = { ...row, pendingTrigger: command.trigger, updatedAt: now };
            break;
          }
          const skipped = overlapping || debounced;
          const run: AutomationRun = {
            id: command.runId,
            automationId: row.id,
            projectId: row.projectId,
            threadId: null,
            status: skipped ? "skipped" : "requested",
            trigger: command.trigger,
            requestedAt: command.requestedAt,
            startedAt: null,
            finishedAt: skipped ? command.requestedAt : null,
            error: overlapping
              ? "Previous run still running"
              : debounced
                ? "Minimum interval has not elapsed"
                : null,
            summary: null,
          };
          yield* runs.upsert(run);
          row = {
            ...row,
            updatedAt: now,
            nextRunAt:
              command.trigger.type === "schedule"
                ? nextAutomationRunAt(row.triggers, row.enabled, command.requestedAt)
                : row.nextRunAt,
            ...(skipped
              ? { lastRun: { ...run, runId: run.id } }
              : {
                  activeRun: {
                    runId: run.id,
                    threadId: null,
                    requestedAt: run.requestedAt,
                    startedAt: null,
                  },
                  lastRequestedAt: run.requestedAt,
                  pendingTrigger: null,
                }),
          };
          if (!skipped) events.push({ type: "automation.run-requested", run });
          break;
        }
        case "automation.run.missed": {
          if (!row.enabled) return yield* fail("Automation is paused.");
          if (row.nextRunAt !== command.scheduledFor)
            return yield* fail("Schedule instant is no longer due.");
          const run: AutomationRun = {
            id: command.runId,
            automationId: row.id,
            projectId: row.projectId,
            threadId: null,
            status: "missed",
            trigger: { type: "schedule", scheduledFor: command.scheduledFor, catchUp: false },
            requestedAt: command.at,
            startedAt: null,
            finishedAt: command.at,
            error: "Scheduled time was missed",
            summary: null,
          };
          yield* runs.upsert(run);
          row = {
            ...row,
            updatedAt: now,
            nextRunAt: nextAutomationRunAt(row.triggers, row.enabled, command.at),
            lastRun: { ...run, runId: run.id },
          };
          break;
        }
        case "automation.run.started": {
          if (row.activeRun?.runId !== command.runId)
            return yield* fail("Automation run is no longer active.");
          if (row.activeRun.threadId !== null)
            return yield* fail("Automation run has already started.");
          const run = Option.getOrNull(yield* runs.getById({ runId: command.runId }));
          if (run === null) return yield* fail("Automation run not found.");
          yield* runs.upsert({
            ...run,
            threadId: command.threadId,
            startedAt: command.startedAt,
            status: "running",
          });
          row = {
            ...row,
            updatedAt: now,
            activeRun: {
              ...row.activeRun,
              threadId: command.threadId,
              startedAt: command.startedAt,
            },
          };
          break;
        }
        case "automation.run.finished": {
          if (row.activeRun?.runId !== command.runId)
            return yield* fail("Automation run is no longer active.");
          const run = Option.getOrNull(yield* runs.getById({ runId: command.runId }));
          if (run === null) return yield* fail("Automation run not found.");
          const finished: AutomationRun = {
            ...run,
            status: command.status,
            finishedAt: command.finishedAt,
            error: command.error,
            summary: command.summary ?? null,
          };
          yield* runs.upsert(finished);
          const failures = command.status === "failed" ? row.consecutiveFailures + 1 : 0;
          row = {
            ...row,
            updatedAt: now,
            activeRun: null,
            lastRun: { ...finished, runId: finished.id },
            runCount: row.runCount + 1,
            consecutiveFailures: failures,
          };
          events.push({ type: "automation.run-finished", automationId: row.id });
          break;
        }
      }
    }
    if (command.type !== "automation.delete") {
      yield* definitions.upsert(row);
      events.unshift({ type: "automation.updated", automation: toShell(row) });
    }
    const receipt = yield* sql<{
      revision: number;
    }>`INSERT INTO automation_command_receipts (command_id, applied_at) VALUES (${command.commandId}, ${now}) RETURNING revision`;
    const revision = receipt[0]!.revision;
    return events.map((event): AutomationStoreEvent =>
      event.type === "automation.updated" || event.type === "automation.removed"
        ? { ...event, revision }
        : event,
    );
  });

  const dispatch = (command: AutomationCommand) =>
    mutations.withPermit(
      sql.withTransaction(apply(command)).pipe(
        Effect.flatMap((events) =>
          Effect.forEach(events, (event) => PubSub.publish(changes, event), { discard: true }),
        ),
        Effect.mapError(mapError),
      ),
    );

  const subscribeAutomationChanges = () =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Buffer live changes before reading a consistent snapshot. A revision already
        // represented by that snapshot is discarded from the buffered tail.
        const subscription = yield* PubSub.subscribe(changes);
        const snapshot = yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const rows = yield* sql<{
                revision: number;
              }>`SELECT COALESCE(MAX(revision), 0) AS revision FROM automation_command_receipts`;
              const automations = yield* listAutomationShells();
              return {
                type: "automation.snapshot" as const,
                automations,
                revision: rows[0]!.revision,
              };
            }),
          )
          .pipe(Effect.mapError(mapError));
        return Stream.concat(
          Stream.make(snapshot),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter(
              (
                event,
              ): event is Extract<
                AutomationStreamMessage,
                { type: "automation.updated" | "automation.removed" }
              > =>
                (event.type === "automation.updated" || event.type === "automation.removed") &&
                event.revision > snapshot.revision,
            ),
          ),
        );
      }),
    );
  return AutomationStore.of({
    dispatch,
    listAutomationShells,
    getAutomationShellById,
    listAutomationRuns,
    getAutomationRunById,
    subscribeChanges: Stream.fromPubSub(changes),
    subscribeAutomationChanges,
  });
});

export const layer = Layer.effect(AutomationStore, make);
