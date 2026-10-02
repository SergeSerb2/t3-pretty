import {
  threadPullRequestKeysEqual,
  threadPullRequestsOf,
} from "@t3tools/shared/threadPullRequests";
import {
  ChatAttachment,
  OrchestrationMessageContext,
  DEFAULT_MODEL,
  EventId,
  MessageId,
  ModelSelection,
  type OrchestrationV2AppThread,
  OrchestrationV2AppThreadJson,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
  OrchestrationV2TurnItemJson,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  type OrchestrationV2ProviderThread,
  ThreadId,
  ThreadLinkedPullRequest,
  ThreadSceneryAssignment,
  ThreadSubagentPolicy,
  ThreadAutomationRun,
  EnabledSkillIds,
  ThreadPullRequestLink,
  TurnItemId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as EventSink from "../EventSink.ts";
import { deriveProviderThread } from "../IdAllocator.ts";
import { makeKeyedSerialExecutor } from "../KeyedSerialExecutor.ts";
import { randomUuidV4 } from "../RandomUuid.ts";
import { loadLegacyV1ForkMetadata } from "./LegacyV1ForkMetadata.ts";

const IMPORT_EVENT_PREFIX = "migration:v1";
const TRANSCRIPT_EVENT_BATCH_SIZE = 100;

interface LegacyThreadRow {
  readonly thread_id: string;
  readonly project_id: string;
  readonly title: string;
  readonly model_selection_json: string | null;
  readonly runtime_mode: string;
  readonly interaction_mode: string;
  readonly branch: string | null;
  readonly worktree_path: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly archived_at: string | null;
  readonly stored_at: string | null;
  readonly scenery_json: string | null;
  readonly enabled_skill_ids: string;
  readonly subagent_policy_json: string | null;
  readonly automation_run_json: string | null;
  readonly settled_override: string | null;
  readonly settled_at: string | null;
  readonly unsettled_at: string | null;
  readonly snoozed_until: string | null;
  readonly snoozed_at: string | null;
  readonly pinned_at: string | null;
  readonly auto_settle_disabled_at: string | null;
  readonly pin_order_key: string | null;
  readonly pull_requests_json: string;
  readonly linked_pull_request_json: string | null;
  readonly branch_pull_request_json: string | null;
  readonly active_order_key: string | null;
  readonly deleted_at: string | null;
}

interface LegacyRepairRow extends LegacyThreadRow {
  readonly payload_json: string;
}

interface LegacyMessageRow {
  readonly message_id: string;
  readonly thread_id: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly attachments_json: string | null;
  readonly context_json?: string | null;
  readonly is_streaming: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly ordinal: number;
}

export interface LegacyNativeSessionRow {
  readonly provider_name: string | null;
  readonly runtime_provider_name: string | null;
  readonly provider_instance_id: string | null;
  readonly provider_thread_id: string | null;
  readonly provider_session_id: string | null;
  readonly resume_cursor_json: string | null;
}

const nonEmptyNativeString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

export function importedNativeProviderThread(
  thread: OrchestrationV2AppThread,
  row: LegacyNativeSessionRow,
): OrchestrationV2ProviderThread | null {
  const parsed = row.resume_cursor_json === null ? undefined : parseJson(row.resume_cursor_json);
  const cursor =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  const driverName =
    nonEmptyNativeString(row.provider_name) ?? nonEmptyNativeString(row.runtime_provider_name);
  if (driverName === undefined) return null;
  const driver = ProviderDriverKind.make(driverName);
  const nativeThreadId = [
    driverName === "claudeAgent" ? nonEmptyNativeString(cursor?.resume) : undefined,
    nonEmptyNativeString(cursor?.nativeThreadId),
    nonEmptyNativeString(cursor?.sessionId),
    nonEmptyNativeString(cursor?.threadId),
    nonEmptyNativeString(row.provider_thread_id),
    driverName === "claudeAgent" ? nonEmptyNativeString(row.provider_session_id) : undefined,
  ].find(
    (candidate) =>
      candidate !== undefined &&
      candidate !== thread.id &&
      !candidate.startsWith("pending:") &&
      !candidate.startsWith("claude-thread-"),
  );
  if (nativeThreadId === undefined) return null;
  const providerInstanceId = ProviderInstanceId.make(
    nonEmptyNativeString(row.provider_instance_id) ?? thread.providerInstanceId,
  );
  const configDir = nonEmptyNativeString(cursor?.configDir);
  const nativeHeadId = nonEmptyNativeString(cursor?.resumeSessionAt);
  return {
    id: deriveProviderThread({ driver, providerInstanceId, nativeThreadId }),
    driver,
    providerInstanceId,
    providerSessionId: null,
    appThreadId: thread.id,
    ownerNodeId: null,
    nativeThreadRef: { driver, nativeId: nativeThreadId, strength: "strong" },
    nativeConversationHeadRef:
      nativeHeadId === undefined ? null : { driver, nativeId: nativeHeadId, strength: "strong" },
    status: "not_loaded",
    firstRunOrdinal: null,
    lastRunOrdinal: null,
    handoffIds: [],
    forkedFrom: null,
    pendingBackgroundTasks: [],
    contextUsage: null,
    nativeMetadata: configDir === undefined ? null : { configDir },
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
  };
}

interface LegacyImportRow {
  readonly thread_id: string;
  readonly transcript_imported_at: string | null;
}

export interface LegacyV1ImportSummary {
  readonly importedThreadCount: number;
  readonly importedMessageCount: number;
}

export class LegacyV1ThreadImportError extends Schema.TaggedError<LegacyV1ThreadImportError>()(
  "LegacyV1ThreadImportError",
  {
    operation: Schema.String,
    threadId: Schema.optional(ThreadId),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.threadId === undefined
      ? `Failed to ${this.operation} legacy v1 threads.`
      : `Failed to ${this.operation} legacy v1 thread ${this.threadId}.`;
  }
}

export interface LegacyV1ThreadImporterShape {
  readonly pendingThreadCount: Effect.Effect<number, LegacyV1ThreadImportError>;
  readonly reconcileShells: Effect.Effect<LegacyV1ImportSummary, LegacyV1ThreadImportError>;
  readonly ensureTranscript: (
    threadId: ThreadId,
  ) => Effect.Effect<LegacyV1ImportSummary, LegacyV1ThreadImportError>;
  readonly importPendingTranscripts: Effect.Effect<LegacyV1ImportSummary, never>;
}

export class LegacyV1ThreadImporter extends Context.Service<
  LegacyV1ThreadImporter,
  LegacyV1ThreadImporterShape
>()("t3/orchestration-v2/legacy/LegacyV1ThreadImporter") {}

const decodeModelSelection = Schema.decodeUnknownOption(ModelSelection);
const decodeAttachments = Schema.decodeUnknownOption(Schema.Array(ChatAttachment));
const decodePullRequests = Schema.decodeUnknownOption(Schema.Array(ThreadPullRequestLink));
const decodeScenery = Schema.decodeUnknownOption(ThreadSceneryAssignment);
const decodeSkills = Schema.decodeUnknownOption(EnabledSkillIds);
const decodeSubagentPolicy = Schema.decodeUnknownOption(ThreadSubagentPolicy);
const decodeAutomationRun = Schema.decodeUnknownOption(ThreadAutomationRun);
const decodeLinkedPullRequest = Schema.decodeUnknownOption(ThreadLinkedPullRequest);
const decodeStoredTurnItem = Schema.decodeUnknownOption(
  Schema.fromJsonString(OrchestrationV2TurnItemJson),
);
const decodeStoredThread = Schema.decodeUnknownOption(
  Schema.fromJsonString(OrchestrationV2AppThreadJson),
);

function parseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function modelSelectionFor(row: LegacyThreadRow) {
  const decoded =
    row.model_selection_json === null
      ? Option.none()
      : decodeModelSelection(parseJson(row.model_selection_json));
  return Option.getOrElse(decoded, () => ({
    instanceId: ProviderInstanceId.make("codex"),
    model: DEFAULT_MODEL,
  }));
}

function attachmentsFor(row: LegacyMessageRow) {
  if (row.attachments_json === null) return [];
  return Option.getOrElse(decodeAttachments(parseJson(row.attachments_json)), () => []);
}

function linkedPullRequestFor(row: LegacyThreadRow) {
  if (row.linked_pull_request_json === null) return null;
  return Option.getOrNull(decodeLinkedPullRequest(parseJson(row.linked_pull_request_json)));
}

function branchPullRequestFor(row: LegacyThreadRow) {
  if (row.branch_pull_request_json === null) return null;
  return Option.getOrNull(decodeLinkedPullRequest(parseJson(row.branch_pull_request_json)));
}

function runtimeModeFor(value: string): OrchestrationV2AppThread["runtimeMode"] {
  return value === "approval-required" ||
    value === "auto-accept-edits" ||
    value === "auto" ||
    value === "full-access"
    ? value
    : "full-access";
}

function interactionModeFor(value: string): OrchestrationV2AppThread["interactionMode"] {
  return value === "plan" ? "plan" : "default";
}

function settledOverrideFor(value: string | null): OrchestrationV2AppThread["settledOverride"] {
  return value === "settled" || value === "active" ? value : null;
}

function dateTime(value: string): DateTime.Utc {
  return DateTime.makeUnsafe(value);
}

function nullableDateTime(value: string | null): DateTime.Utc | null {
  return value == null ? null : dateTime(value);
}

function importedThread(row: LegacyThreadRow): OrchestrationV2AppThread {
  const threadId = ThreadId.make(row.thread_id);
  const modelSelection = modelSelectionFor(row);
  const branch = row.branch?.trim() || null;
  const worktreePath = row.worktree_path?.trim() || null;
  const pullRequests = Option.getOrElse(
    decodePullRequests(parseJson(row.pull_requests_json)),
    () => [],
  );
  const linkedPullRequest = linkedPullRequestFor(row);
  const legacyLink = threadPullRequestsOf({ linkedPullRequest })[0];
  const importedPullRequests =
    legacyLink !== undefined &&
    !pullRequests.some((link) => threadPullRequestKeysEqual(link, legacyLink))
      ? [...pullRequests, legacyLink]
      : pullRequests;
  return {
    createdBy: "system",
    creationSource: "server",
    id: threadId,
    projectId: ProjectId.make(row.project_id),
    title: row.title.trim() === "" ? "Untitled thread" : row.title,
    providerInstanceId: modelSelection.instanceId,
    modelSelection,
    runtimeMode: runtimeModeFor(row.runtime_mode),
    interactionMode: interactionModeFor(row.interaction_mode),
    branch,
    worktreePath,
    linkedPullRequest,
    pullRequests: importedPullRequests,
    branchPullRequest: branchPullRequestFor(row),
    activeOrderKey: row.active_order_key?.trim() || null,
    activeProviderThreadId: null,
    historyOrigin: "v1_import",
    lineage: {
      parentThreadId: null,
      relationshipToParent: null,
      rootThreadId: threadId,
    },
    forkedFrom: null,
    createdAt: dateTime(row.created_at),
    updatedAt: dateTime(row.updated_at),
    archivedAt: nullableDateTime(row.archived_at),
    storedAt: nullableDateTime(row.stored_at),
    scenery:
      row.scenery_json == null
        ? null
        : Option.getOrNull(decodeScenery(parseJson(row.scenery_json))),
    enabledSkillIds: Option.getOrElse(decodeSkills(parseJson(row.enabled_skill_ids)), () => []),
    subagentPolicy:
      row.subagent_policy_json == null
        ? null
        : Option.getOrNull(decodeSubagentPolicy(parseJson(row.subagent_policy_json))),
    automationRun:
      row.automation_run_json == null
        ? null
        : Option.getOrNull(decodeAutomationRun(parseJson(row.automation_run_json))),
    settledOverride: settledOverrideFor(row.settled_override),
    settledAt: nullableDateTime(row.settled_at),
    unsettledAt: nullableDateTime(row.unsettled_at),
    snoozedUntil: nullableDateTime(row.snoozed_until),
    snoozedAt: nullableDateTime(row.snoozed_at),
    pinnedAt: nullableDateTime(row.pinned_at),
    autoSettleDisabledAt: nullableDateTime(row.auto_settle_disabled_at),
    pinOrderKey: row.pin_order_key?.trim() || null,
    lastVisitedAt: null,
    deletedAt: nullableDateTime(row.deleted_at),
  };
}

function messageEvents(row: LegacyMessageRow): ReadonlyArray<OrchestrationV2DomainEvent> {
  const threadId = ThreadId.make(row.thread_id);
  const messageId = MessageId.make(row.message_id);
  const createdAt = dateTime(row.created_at);
  const updatedAt = dateTime(row.updated_at);
  const attachments = attachmentsFor(row);
  const message: OrchestrationV2ConversationMessage = {
    createdBy: row.role === "user" ? "user" : "agent",
    creationSource: "server",
    id: messageId,
    threadId,
    runId: null,
    nodeId: null,
    role: row.role,
    text: row.text,
    ...(row.context_json
      ? {
          context: Schema.decodeUnknownSync(OrchestrationMessageContext)(
            parseJson(row.context_json),
          ),
        }
      : {}),
    attachments,
    streaming: false,
    createdAt,
    updatedAt,
  };
  const baseTurnItem = {
    id: TurnItemId.make(`${IMPORT_EVENT_PREFIX}:turn-item:${row.message_id}`),
    threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: row.ordinal,
    status: row.is_streaming === 1 ? ("interrupted" as const) : ("completed" as const),
    title: null,
    startedAt: createdAt,
    completedAt: updatedAt,
    updatedAt,
  };
  const turnItem: OrchestrationV2TurnItem =
    row.role === "user"
      ? {
          ...baseTurnItem,
          createdBy: "user",
          creationSource: "server",
          type: "user_message",
          messageId,
          inputIntent: "turn_start",
          text: row.text,
          ...(row.context_json
            ? {
                context: Schema.decodeUnknownSync(OrchestrationMessageContext)(
                  parseJson(row.context_json),
                ),
              }
            : {}),
          attachments,
        }
      : {
          ...baseTurnItem,
          type: "assistant_message",
          messageId,
          text: row.text,
          ...(row.context_json
            ? {
                context: Schema.decodeUnknownSync(OrchestrationMessageContext)(
                  parseJson(row.context_json),
                ),
              }
            : {}),
          streaming: false,
        };
  return [
    {
      id: EventId.make(`${IMPORT_EVENT_PREFIX}:message:${row.message_id}`),
      type: "message.updated",
      threadId,
      occurredAt: updatedAt,
      payload: message,
    },
    {
      id: EventId.make(`${IMPORT_EVENT_PREFIX}:turn-item:${row.message_id}`),
      type: "turn-item.updated",
      threadId,
      occurredAt: updatedAt,
      payload: turnItem,
    },
  ];
}

function chunks<A>(items: ReadonlyArray<A>, size: number): Array<ReadonlyArray<A>> {
  const result: Array<ReadonlyArray<A>> = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const eventSink = yield* EventSink.EventSinkV2;
  const transcriptImports = yield* makeKeyedSerialExecutor<ThreadId>();

  const readNativeProviderThread = (thread: OrchestrationV2AppThread) =>
    Effect.gen(function* () {
      const sessions = yield* sql<LegacyNativeSessionRow>`
      SELECT session.provider_name, runtime.provider_name AS runtime_provider_name,
        session.provider_instance_id, session.provider_thread_id, session.provider_session_id, runtime.resume_cursor_json
      FROM (SELECT ${thread.id} AS thread_id) AS target
      LEFT JOIN projection_thread_sessions AS session ON session.thread_id = target.thread_id
      LEFT JOIN provider_session_runtime AS runtime ON runtime.thread_id = target.thread_id
    `;
      return sessions[0] === undefined ? null : importedNativeProviderThread(thread, sessions[0]);
    });

  const nativeProviderThreadEvent = (
    providerThread: OrchestrationV2ProviderThread,
  ): OrchestrationV2DomainEvent => ({
    id: EventId.make(`${IMPORT_EVENT_PREFIX}:thread:${providerThread.appThreadId}:native-thread`),
    type: "provider-thread.updated",
    threadId: providerThread.appThreadId!,
    providerInstanceId: providerThread.providerInstanceId,
    occurredAt: providerThread.updatedAt,
    payload: providerThread,
  });

  const listMessages = (threadId: ThreadId) =>
    sql<LegacyMessageRow>`
      SELECT
        message_id,
        thread_id,
        role,
        text,
        attachments_json,
        context_json,
        is_streaming,
        created_at,
        updated_at,
        ROW_NUMBER() OVER (
          PARTITION BY thread_id
          ORDER BY created_at ASC, message_id ASC
        ) AS ordinal
      FROM projection_thread_messages
      WHERE thread_id = ${threadId}
        AND role IN ('user', 'assistant')
      ORDER BY created_at ASC, message_id ASC
    `;

  // Shell reconciliation needs chronology, not the full transcript bodies.
  const listMessagePositions = (threadId: ThreadId) =>
    sql<Pick<LegacyMessageRow, "message_id" | "created_at" | "ordinal">>`
      SELECT message_id, created_at,
        ROW_NUMBER() OVER (ORDER BY created_at, message_id) AS ordinal
      FROM projection_thread_messages
      WHERE thread_id = ${threadId} AND role IN ('user', 'assistant')
      ORDER BY created_at, message_id
    `;

  const listShellMessages = (threadId: ThreadId) =>
    Effect.gen(function* () {
      const latest = yield* sql<LegacyMessageRow>`
        SELECT
          message.message_id,
          message.thread_id,
          message.role,
          message.text,
          message.attachments_json,
          message.context_json,
          message.is_streaming,
          message.created_at,
          message.updated_at,
          (
            SELECT COUNT(*)
            FROM projection_thread_messages AS earlier
            WHERE earlier.thread_id = message.thread_id
              AND earlier.role IN ('user', 'assistant')
              AND (
                earlier.created_at < message.created_at
                OR (
                  earlier.created_at = message.created_at
                  AND earlier.message_id <= message.message_id
                )
              )
          ) AS ordinal
        FROM projection_thread_messages AS message
        WHERE message.thread_id = ${threadId}
          AND message.role IN ('user', 'assistant')
        ORDER BY message.created_at DESC, message.message_id DESC
        LIMIT 1
      `;
      const latestUser = yield* sql<LegacyMessageRow>`
        SELECT
          message.message_id,
          message.thread_id,
          message.role,
          message.text,
          message.attachments_json,
          message.context_json,
          message.is_streaming,
          message.created_at,
          message.updated_at,
          (
            SELECT COUNT(*)
            FROM projection_thread_messages AS earlier
            WHERE earlier.thread_id = message.thread_id
              AND earlier.role IN ('user', 'assistant')
              AND (
                earlier.created_at < message.created_at
                OR (
                  earlier.created_at = message.created_at
                  AND earlier.message_id <= message.message_id
                )
              )
          ) AS ordinal
        FROM projection_thread_messages AS message
        WHERE message.thread_id = ${threadId}
          AND message.role = 'user'
        ORDER BY message.created_at DESC, message.message_id DESC
        LIMIT 1
      `;
      return [latestUser[0], latest[0]].filter(
        (message, index, selected): message is LegacyMessageRow =>
          message !== undefined &&
          selected.findIndex((candidate) => candidate?.message_id === message.message_id) === index,
      );
    });

  // Seed deterministic positions before EventSink normalization. Older imports may
  // already contain previews or a full transcript, so repair their current payloads
  // through events as well; this preserves edits and makes replay reproduce ordering.
  const prepareForkImport = <
    Message extends Pick<LegacyMessageRow, "message_id" | "created_at" | "ordinal">,
  >(
    thread: OrchestrationV2AppThread,
    messages: readonly Message[],
    driver?: ProviderDriverKind,
  ) =>
    Effect.gen(function* () {
      const fork = yield* loadLegacyV1ForkMetadata(thread, driver).pipe(
        Effect.provideService(SqlClient.SqlClient, sql),
      );
      const adjustedMessages = messages.map((message) => ({
        ...message,
        ordinal:
          message.ordinal +
          fork.itemPositions.filter((image) => image.at < message.created_at).length,
      }));
      const positions = [
        ...adjustedMessages.map((message) => ({
          id: TurnItemId.make(`${IMPORT_EVENT_PREFIX}:turn-item:${message.message_id}`),
          ordinal: message.ordinal,
        })),
        ...fork.itemPositions.map((image, index) => ({
          id: image.id,
          ordinal: messages.filter((message) => message.created_at <= image.at).length + index + 1,
        })),
      ];
      const projected = yield* sql<{
        readonly payload_json: string;
      }>`SELECT payload_json FROM orchestration_v2_projection_turn_items WHERE thread_id = ${thread.id} AND turn_item_id LIKE 'migration:v1:%'`;
      const items = new Map(
        projected.flatMap((row) => {
          const item = decodeStoredTurnItem(row.payload_json);
          return Option.isSome(item) ? [[item.value.id, item.value] as const] : [];
        }),
      );
      const repairs: OrchestrationV2DomainEvent[] = [];
      // Make room from the end first: the position table has a unique ordinal
      // constraint, and historical items move forward when checklist/image rows
      // are inserted. Emit those repairs before new history for the same reason.
      for (const position of positions.toSorted((left, right) => right.ordinal - left.ordinal)) {
        yield* sql`INSERT INTO orchestration_v2_turn_item_positions (thread_id, turn_item_id, ordinal)
          VALUES (${thread.id}, ${position.id}, ${position.ordinal})
          ON CONFLICT(thread_id, turn_item_id) DO UPDATE SET ordinal = excluded.ordinal`;
        const current = items.get(position.id);
        if (current !== undefined && current.ordinal !== position.ordinal) {
          repairs.push({
            id: EventId.make(
              `${IMPORT_EVENT_PREFIX}:fork:position:${thread.id}:${position.id}:${position.ordinal}`,
            ),
            type: "turn-item.updated",
            threadId: thread.id,
            occurredAt: current.updatedAt,
            payload: { ...current, ordinal: position.ordinal },
          });
        }
      }
      return { ...fork, messages: adjustedMessages, events: [...repairs, ...fork.events] };
    });

  const reconcileShellsBase = Effect.gen(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    const repairRows = yield* sql<LegacyRepairRow>`
      SELECT
        thread.thread_id,
        thread.project_id,
        thread.title,
        thread.model_selection_json,
        thread.runtime_mode,
        thread.interaction_mode,
        thread.branch,
        thread.worktree_path,
        thread.created_at,
        thread.updated_at,
        thread.archived_at,
        thread.stored_at,
        thread.scenery_json,
        thread.enabled_skill_ids,
        thread.subagent_policy_json,
        thread.automation_run_json,
        thread.settled_override,
        thread.settled_at,
        thread.unsettled_at,
        thread.snoozed_until,
        thread.snoozed_at,
        thread.pinned_at,
        thread.auto_settle_disabled_at,
        thread.pin_order_key,
        (SELECT json_group_array(json_object('host', pr.host, 'repository', pr.repository, 'number', pr.number, 'url', pr.url, 'source', pr.source, 'linkedAt', pr.linked_at, 'snapshot', json(pr.snapshot_json), 'stack', json(pr.stack_json))) FROM projection_thread_pull_requests pr WHERE pr.thread_id = thread.thread_id) AS pull_requests_json,
        thread.linked_pull_request_json,
        thread.branch_pull_request_json,
        thread.active_order_key,
        thread.deleted_at,
        projection.payload_json
      FROM orchestration_v2_legacy_imports AS legacy_import
      INNER JOIN projection_threads AS thread
        ON thread.thread_id = legacy_import.thread_id
      INNER JOIN orchestration_v2_projection_threads AS projection
        ON projection.thread_id = legacy_import.thread_id
      WHERE json_type(projection.payload_json, '$.storedAt') IS NULL
         OR json_type(projection.payload_json, '$.scenery') IS NULL
         OR json_type(projection.payload_json, '$.enabledSkillIds') IS NULL
         OR json_type(projection.payload_json, '$.subagentPolicy') IS NULL
         OR json_type(projection.payload_json, '$.automationRun') IS NULL
         OR json_type(projection.payload_json, '$.pinnedAt') IS NULL
         OR json_type(projection.payload_json, '$.pinOrderKey') IS NULL
         OR json_type(projection.payload_json, '$.autoSettleDisabledAt') IS NULL
         OR json_type(projection.payload_json, '$.snoozedUntil') IS NULL
         OR json_type(projection.payload_json, '$.snoozedAt') IS NULL
         OR json_type(projection.payload_json, '$.unsettledAt') IS NULL
         OR json_type(projection.payload_json, '$.linkedPullRequest') IS NULL
         OR json_type(projection.payload_json, '$.pullRequests') IS NULL
         OR json_type(projection.payload_json, '$.branchPullRequest') IS NULL
         OR json_type(projection.payload_json, '$.activeOrderKey') IS NULL
         OR (
           json_extract(projection.payload_json, '$.activeProviderThreadId') IS NULL
           AND NOT EXISTS (SELECT 1 FROM orchestration_v2_projection_runs AS run WHERE run.thread_id = thread.thread_id)
           AND (EXISTS (SELECT 1 FROM provider_session_runtime AS runtime WHERE runtime.thread_id = thread.thread_id AND runtime.resume_cursor_json IS NOT NULL)
             OR EXISTS (SELECT 1 FROM projection_thread_sessions AS session WHERE session.thread_id = thread.thread_id AND session.provider_thread_id IS NOT NULL))
         )
      ORDER BY thread.created_at ASC, thread.thread_id ASC
    `;
    let repairedThreadCount = 0;
    for (const row of repairRows) {
      const decoded = decodeStoredThread(row.payload_json);
      if (Option.isNone(decoded)) continue;
      const current = decoded.value;
      const legacy = importedThread(row);
      const legacyPullRequests = legacy.pullRequests ?? [];
      const existingRuns =
        current.activeProviderThreadId === null
          ? yield* sql<{
              readonly count: number;
            }>`SELECT COUNT(*) AS count FROM orchestration_v2_projection_runs WHERE thread_id = ${current.id}`
          : [];
      const nativeProviderThread =
        current.activeProviderThreadId === null && existingRuns[0]?.count === 0
          ? yield* readNativeProviderThread(current)
          : null;
      if (
        nativeProviderThread === null &&
        Object.values({
          storedAt: current.storedAt,
          scenery: current.scenery,
          enabledSkillIds: current.enabledSkillIds,
          subagentPolicy: current.subagentPolicy,
          automationRun: current.automationRun,
          pinnedAt: current.pinnedAt,
          autoSettleDisabledAt: current.autoSettleDisabledAt,
          pinOrderKey: current.pinOrderKey,
          snoozedUntil: current.snoozedUntil,
          snoozedAt: current.snoozedAt,
          unsettledAt: current.unsettledAt,
          linkedPullRequest: current.linkedPullRequest,
          pullRequests: current.pullRequests,
          branchPullRequest: current.branchPullRequest,
          activeOrderKey: current.activeOrderKey,
        }).every((value) => value !== undefined)
      )
        continue;
      const repaired: OrchestrationV2AppThread = {
        ...current,
        activeProviderThreadId: nativeProviderThread?.id ?? current.activeProviderThreadId,
        storedAt: current.storedAt === undefined ? legacy.storedAt : current.storedAt,
        scenery: current.scenery === undefined ? legacy.scenery : current.scenery,
        enabledSkillIds:
          current.enabledSkillIds === undefined ? legacy.enabledSkillIds : current.enabledSkillIds,
        subagentPolicy:
          current.subagentPolicy === undefined ? legacy.subagentPolicy : current.subagentPolicy,
        automationRun:
          current.automationRun === undefined ? legacy.automationRun : current.automationRun,
        pinnedAt: current.pinnedAt === undefined ? legacy.pinnedAt : current.pinnedAt,
        autoSettleDisabledAt:
          current.autoSettleDisabledAt === undefined
            ? legacy.autoSettleDisabledAt
            : current.autoSettleDisabledAt,
        pinOrderKey: current.pinOrderKey === undefined ? legacy.pinOrderKey : current.pinOrderKey,
        snoozedUntil:
          current.snoozedUntil === undefined ? legacy.snoozedUntil : current.snoozedUntil,
        snoozedAt: current.snoozedAt === undefined ? legacy.snoozedAt : current.snoozedAt,
        unsettledAt: current.unsettledAt === undefined ? legacy.unsettledAt : current.unsettledAt,
        linkedPullRequest:
          current.linkedPullRequest === undefined
            ? legacy.linkedPullRequest
            : current.linkedPullRequest,
        pullRequests:
          current.pullRequests === undefined
            ? current.linkedPullRequest === null
              ? []
              : legacyPullRequests.length > 0
                ? legacyPullRequests
                : threadPullRequestsOf({
                    linkedPullRequest:
                      current.linkedPullRequest === undefined
                        ? legacy.linkedPullRequest
                        : current.linkedPullRequest,
                  })
            : current.pullRequests,
        branchPullRequest:
          current.branchPullRequest === undefined
            ? legacy.branchPullRequest
            : current.branchPullRequest,
        activeOrderKey:
          current.activeOrderKey === undefined ? legacy.activeOrderKey : current.activeOrderKey,
      };
      // Later schema additions can require another repair for the same thread.
      const repairId = yield* randomUuidV4;
      yield* eventSink.write({
        events: [
          ...(nativeProviderThread === null
            ? []
            : [nativeProviderThreadEvent(nativeProviderThread)]),
          {
            id: EventId.make(
              `${IMPORT_EVENT_PREFIX}:thread:${row.thread_id}:metadata-repair:${repairId}`,
            ),
            type: "thread.metadata-updated",
            threadId: repaired.id,
            providerInstanceId: repaired.providerInstanceId,
            occurredAt: dateTime(now),
            payload: repaired,
          },
        ],
      });
      repairedThreadCount += 1;
    }
    // Backfill fork history for shells imported by previous V2 builds, including
    // already hydrated transcripts. Always use the current V2 metadata as the base.
    const existingShells = yield* sql<{ readonly payload_json: string }>`
      SELECT projection.payload_json FROM orchestration_v2_projection_threads AS projection
      INNER JOIN orchestration_v2_legacy_imports AS legacy_import ON legacy_import.thread_id = projection.thread_id
    `;
    for (const row of existingShells) {
      const current = decodeStoredThread(row.payload_json);
      if (Option.isNone(current)) continue;
      const native = yield* readNativeProviderThread(current.value);
      yield* sql.withTransaction(
        Effect.gen(function* () {
          const fork = yield* prepareForkImport(
            current.value,
            yield* listMessagePositions(current.value.id),
            native?.driver,
          );
          if (fork.events.length > 0) yield* eventSink.write({ events: fork.events });
        }),
      );
    }
    const rows = yield* sql<LegacyThreadRow>`
      SELECT
        thread.thread_id,
        thread.project_id,
        thread.title,
        thread.model_selection_json,
        thread.runtime_mode,
        thread.interaction_mode,
        thread.branch,
        thread.worktree_path,
        thread.created_at,
        thread.updated_at,
        thread.archived_at,
        thread.stored_at,
        thread.scenery_json,
        thread.enabled_skill_ids,
        thread.subagent_policy_json,
        thread.automation_run_json,
        thread.settled_override,
        thread.settled_at,
        thread.unsettled_at,
        thread.snoozed_until,
        thread.snoozed_at,
        thread.pinned_at,
        thread.auto_settle_disabled_at,
        thread.pin_order_key,
        (SELECT json_group_array(json_object('host', pr.host, 'repository', pr.repository, 'number', pr.number, 'url', pr.url, 'source', pr.source, 'linkedAt', pr.linked_at, 'snapshot', json(pr.snapshot_json), 'stack', json(pr.stack_json))) FROM projection_thread_pull_requests pr WHERE pr.thread_id = thread.thread_id) AS pull_requests_json,
        thread.linked_pull_request_json,
        thread.branch_pull_request_json,
        thread.active_order_key,
        thread.deleted_at
      FROM projection_threads AS thread
      WHERE NOT EXISTS (
        SELECT 1
        FROM orchestration_events AS event INDEXED BY orchestration_events_v2_created_threads_idx
        WHERE event.application_event_version = 2
          AND event.aggregate_kind = 'thread'
          AND event.stream_id = thread.thread_id
          AND event.event_type = 'thread.created'
      )
      ORDER BY thread.created_at ASC, thread.thread_id ASC
    `;
    let importedThreadCount = repairedThreadCount;
    let importedMessageCount = 0;
    for (const row of rows) {
      const imported = importedThread(row);
      const nativeProviderThread = yield* readNativeProviderThread(imported);
      const nativeLinkedThread =
        nativeProviderThread === null
          ? imported
          : { ...imported, activeProviderThreadId: nativeProviderThread.id };
      const messages = yield* listMessagePositions(nativeLinkedThread.id);
      const fork = yield* prepareForkImport(
        nativeLinkedThread,
        messages,
        nativeProviderThread?.driver,
      );
      const thread = fork.thread;
      const ordinals = new Map(
        fork.messages.map((message) => [message.message_id, message.ordinal]),
      );
      const previews = (yield* listShellMessages(thread.id)).map((message) => ({
        ...message,
        ordinal: ordinals.get(message.message_id) ?? message.ordinal,
      }));
      const events: Array<OrchestrationV2DomainEvent> = [
        {
          id: EventId.make(`${IMPORT_EVENT_PREFIX}:thread:${row.thread_id}:created`),
          type: "thread.created",
          threadId: thread.id,
          providerInstanceId: thread.providerInstanceId,
          occurredAt: thread.createdAt,
          payload: thread,
        },
        ...(nativeProviderThread === null ? [] : [nativeProviderThreadEvent(nativeProviderThread)]),
        ...fork.events,
        ...previews.flatMap(messageEvents),
        {
          id: EventId.make(`${IMPORT_EVENT_PREFIX}:thread:${row.thread_id}:shell`),
          type: "thread.metadata-updated",
          threadId: thread.id,
          providerInstanceId: thread.providerInstanceId,
          occurredAt: thread.updatedAt,
          payload: thread,
        },
      ];
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* Effect.forEach(
            previews,
            (message) =>
              sql`
                INSERT INTO orchestration_v2_turn_item_positions (
                  thread_id,
                  turn_item_id,
                  ordinal
                )
                VALUES (
                  ${thread.id},
                  ${TurnItemId.make(`${IMPORT_EVENT_PREFIX}:turn-item:${message.message_id}`)},
                  ${message.ordinal}
                )
                ON CONFLICT(thread_id, turn_item_id) DO NOTHING
              `,
            { discard: true },
          );
          yield* eventSink.write({ events });
          yield* sql`
            INSERT INTO orchestration_v2_legacy_imports (
              thread_id,
              source_updated_at,
              shell_imported_at,
              transcript_imported_at,
              imported_message_count,
              last_error
            )
            VALUES (
              ${thread.id},
              ${row.updated_at},
              ${now},
              NULL,
              ${previews.length},
              NULL
            )
            ON CONFLICT(thread_id) DO NOTHING
          `;
        }),
      );
      importedThreadCount += 1;
      importedMessageCount += previews.length;
    }
    return { importedThreadCount, importedMessageCount };
  });

  const reconcileShells = reconcileShellsBase.pipe(
    Effect.mapError((cause) => new LegacyV1ThreadImportError({ operation: "import", cause })),
  );

  const pendingThreadCount = sql<{ readonly count: number }>`
    SELECT COUNT(*) AS count
    FROM (
      SELECT thread.thread_id
      FROM projection_threads AS thread
      WHERE NOT EXISTS (
        SELECT 1
        FROM orchestration_events AS event INDEXED BY orchestration_events_v2_created_threads_idx
        WHERE event.application_event_version = 2
          AND event.aggregate_kind = 'thread'
          AND event.stream_id = thread.thread_id
          AND event.event_type = 'thread.created'
      )
      UNION
      SELECT legacy_import.thread_id
      FROM orchestration_v2_legacy_imports AS legacy_import
      WHERE legacy_import.transcript_imported_at IS NULL
    )
  `.pipe(
    Effect.map((rows) => rows[0]?.count ?? 0),
    Effect.mapError(
      (cause) => new LegacyV1ThreadImportError({ operation: "inspect pending", cause }),
    ),
  );

  // Threads whose transcript import this process has already confirmed.
  // `transcript_imported_at` is never reset to NULL, so a positive answer
  // stays valid for the process lifetime; ensureTranscript runs on most
  // thread reads and command dispatches, so skipping the lock + lookup here
  // keeps that path off the database entirely after first confirmation.
  const confirmedTranscriptThreadIds = new Set<ThreadId>();

  const ensureTranscriptBase = (threadId: ThreadId) =>
    transcriptImports.withLock(
      threadId,
      Effect.gen(function* () {
        const imports = yield* sql<LegacyImportRow>`
          SELECT thread_id, transcript_imported_at
          FROM orchestration_v2_legacy_imports
          WHERE thread_id = ${threadId}
          LIMIT 1
        `;
        const imported = imports[0];
        let messages: readonly LegacyMessageRow[] = [];
        if (imported !== undefined) {
          const rows = yield* sql<{
            readonly payload_json: string;
          }>`SELECT payload_json FROM orchestration_v2_projection_threads WHERE thread_id = ${threadId}`;
          const current =
            rows[0] === undefined ? Option.none() : decodeStoredThread(rows[0].payload_json);
          messages = yield* listMessages(threadId);
          if (Option.isSome(current)) {
            const native = yield* readNativeProviderThread(current.value);
            const fork = yield* sql.withTransaction(
              Effect.gen(function* () {
                const fork = yield* prepareForkImport(current.value, messages, native?.driver);
                if (fork.events.length > 0) yield* eventSink.write({ events: fork.events });
                return fork;
              }),
            );
            messages = fork.messages;
          }
        }
        if (imported === undefined || imported.transcript_imported_at !== null) {
          if (imported !== undefined) {
            confirmedTranscriptThreadIds.add(threadId);
          }
          return { importedThreadCount: 0, importedMessageCount: 0 };
        }
        const existingRows = yield* sql<{ readonly event_id: string }>`
          SELECT event_id
          FROM orchestration_events
          WHERE application_event_version = 2
            AND aggregate_kind = 'thread'
            AND stream_id = ${threadId}
            AND event_id LIKE ${`${IMPORT_EVENT_PREFIX}:message:%`}
        `;
        const existing = new Set(existingRows.map((row) => row.event_id));
        const missing = messages.filter(
          (message) => !existing.has(`${IMPORT_EVENT_PREFIX}:message:${message.message_id}`),
        );
        for (const batch of chunks(missing, TRANSCRIPT_EVENT_BATCH_SIZE / 2)) {
          yield* Effect.forEach(
            batch,
            (message) =>
              sql`
                INSERT INTO orchestration_v2_turn_item_positions (
                  thread_id,
                  turn_item_id,
                  ordinal
                )
                VALUES (
                  ${threadId},
                  ${TurnItemId.make(`${IMPORT_EVENT_PREFIX}:turn-item:${message.message_id}`)},
                  ${message.ordinal}
                )
                ON CONFLICT(thread_id, turn_item_id) DO NOTHING
              `,
            { discard: true },
          );
          yield* eventSink.write({ events: batch.flatMap(messageEvents) });
          yield* Effect.yieldNow;
        }
        const now = DateTime.formatIso(yield* DateTime.now);
        yield* sql`
          UPDATE orchestration_v2_legacy_imports
          SET
            transcript_imported_at = ${now},
            imported_message_count = ${messages.length},
            last_error = NULL
          WHERE thread_id = ${threadId}
        `;
        confirmedTranscriptThreadIds.add(threadId);
        return {
          importedThreadCount: 1,
          importedMessageCount: missing.length,
        };
      }),
    );

  const ensureTranscript = (threadId: ThreadId) =>
    confirmedTranscriptThreadIds.has(threadId)
      ? Effect.succeed({ importedThreadCount: 0, importedMessageCount: 0 })
      : ensureTranscriptBase(threadId).pipe(
          Effect.mapError(
            (cause) =>
              new LegacyV1ThreadImportError({
                operation: "hydrate transcript for",
                threadId,
                cause,
              }),
          ),
        );

  const importPendingTranscripts = Effect.gen(function* () {
    const rows = yield* sql<LegacyImportRow>`
      SELECT thread_id, transcript_imported_at
      FROM orchestration_v2_legacy_imports
      WHERE transcript_imported_at IS NULL
      ORDER BY shell_imported_at ASC, thread_id ASC
    `;
    let importedThreadCount = 0;
    let importedMessageCount = 0;
    for (const row of rows) {
      const result = yield* ensureTranscript(ThreadId.make(row.thread_id)).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("Failed to hydrate migrated v1 thread transcript", {
            threadId: row.thread_id,
            cause: error,
          }),
        ),
        Effect.catch(() =>
          sql`
            UPDATE orchestration_v2_legacy_imports
            SET last_error = 'Transcript hydration failed; retry on next open.'
            WHERE thread_id = ${row.thread_id}
          `.pipe(
            Effect.as({ importedThreadCount: 0, importedMessageCount: 0 }),
            Effect.orElseSucceed(() => ({
              importedThreadCount: 0,
              importedMessageCount: 0,
            })),
          ),
        ),
      );
      importedThreadCount += result.importedThreadCount;
      importedMessageCount += result.importedMessageCount;
      yield* Effect.yieldNow;
    }
    return { importedThreadCount, importedMessageCount };
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Legacy v1 transcript background import stopped", { cause }).pipe(
        Effect.as({ importedThreadCount: 0, importedMessageCount: 0 }),
      ),
    ),
  );

  return LegacyV1ThreadImporter.of({
    pendingThreadCount,
    reconcileShells,
    ensureTranscript,
    importPendingTranscripts,
  });
});

export const layer: Layer.Layer<
  LegacyV1ThreadImporter,
  never,
  EventSink.EventSinkV2 | SqlClient.SqlClient
> = Layer.effect(LegacyV1ThreadImporter, make);
