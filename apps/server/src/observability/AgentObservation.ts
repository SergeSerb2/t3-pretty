// @effect-diagnostics nodeBuiltinImport:off - deterministic IDs must survive process restarts.
import * as NodeCrypto from "node:crypto";

import type { OrchestrationV2StoredEvent } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

const Attribute = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]);
export const AgentObservation = Schema.Struct({
  id: Schema.String,
  entityId: Schema.String,
  sequence: Schema.Number,
  kind: Schema.Literals(["run", "attempt", "provider_turn", "subagent", "tool", "error"]),
  operation: Schema.String,
  status: Schema.String,
  traceId: Schema.String,
  spanId: Schema.String,
  parentSpanId: Schema.optional(Schema.String),
  startedAt: Schema.Number,
  observedAt: Schema.Number,
  completedAt: Schema.optional(Schema.Number),
  attributes: Schema.Record(Schema.String, Attribute),
});
export type AgentObservation = typeof AgentObservation.Type;

export const observationId = (value: string, length = 32) =>
  NodeCrypto.createHash("sha256").update(value).digest("hex").slice(0, length);

// Identifiers are metadata, never display titles, command text, or error messages.
const identifier = (value: string | null | undefined) =>
  value &&
  /^[a-zA-Z0-9][a-zA-Z0-9_.:/-]{0,95}$/.test(value) &&
  !/(?:https?:|sk-|bearer|password|secret|token=)/i.test(value)
    ? value
    : "unknown";

const terminal = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "rolled_back",
  "superseded",
]);
const epoch = (value: DateTime.Utc | null | undefined) =>
  value == null ? undefined : DateTime.toEpochMillis(value);

/** Select facts from committed events. Provider-controlled content never enters this projection. */
export function toAgentObservation(
  stored: OrchestrationV2StoredEvent,
  environmentId: string,
): AgentObservation | undefined {
  const event = stored.event;
  const observedAt = DateTime.toEpochMillis(event.occurredAt);
  let kind: AgentObservation["kind"];
  let entity: string;
  let status: string;
  let operation: string;
  let runId = event.runId;
  let startedAt: number | undefined;
  let completedAt: number | undefined;
  let parent: string | undefined;
  let generation = "";
  const attributes: Record<string, string | number | boolean> = {
    "t3.schema_version": 1,
    "t3.environment_id": observationId(environmentId),
    "t3.thread_id": observationId(event.threadId),
    "t3.provider": identifier(event.driver),
    "t3.visibility": "provider_reported",
  };
  if (event.providerInstanceId)
    attributes["t3.provider_instance_id"] = observationId(event.providerInstanceId);

  switch (event.type) {
    case "run.created":
    case "run.updated": {
      const run = event.payload;
      kind = "run";
      entity = run.id;
      runId = run.id;
      status = run.status;
      operation = "invoke_agent";
      startedAt = epoch(run.startedAt) ?? epoch(run.requestedAt);
      completedAt = epoch(run.completedAt);
      attributes["gen_ai.request.model"] = identifier(run.modelSelection.model);
      attributes["t3.provider_instance_id"] = observationId(run.providerInstanceId);
      if (run.activeAttemptId) attributes["t3.attempt_id"] = observationId(run.activeAttemptId);
      if (run.startedAt)
        attributes["t3.queue_duration_ms"] = Math.max(
          0,
          epoch(run.startedAt)! - epoch(run.requestedAt)!,
        );
      break;
    }
    case "run-attempt.created":
    case "run-attempt.updated": {
      const attempt = event.payload;
      kind = "attempt";
      entity = attempt.id;
      runId = attempt.runId;
      status = attempt.status;
      operation = "t3.attempt";
      startedAt = epoch(attempt.startedAt);
      completedAt = epoch(attempt.completedAt);
      attributes["t3.attempt_id"] = observationId(attempt.id);
      attributes["t3.attempt_ordinal"] = attempt.attemptOrdinal;
      attributes["t3.attempt_reason"] = attempt.reason;
      break;
    }
    case "provider-turn.updated": {
      const turn = event.payload;
      kind = "provider_turn";
      entity = turn.id;
      status = turn.status;
      operation = "t3.provider_turn";
      startedAt = epoch(turn.startedAt);
      completedAt = epoch(turn.completedAt);
      if (turn.runAttemptId) {
        parent = `attempt:${turn.runAttemptId}`;
        attributes["t3.attempt_id"] = observationId(turn.runAttemptId);
      }
      const usage = turn.turnTokenUsage;
      attributes["t3.usage_scope"] = usage?.usageScope ?? "unknown";
      attributes["t3.usage_status"] = usage?.usageStatus ?? "unavailable";
      if (usage?.inputTokens !== undefined)
        attributes["t3.reported_input_tokens"] = usage.inputTokens;
      if (usage?.outputTokens !== undefined)
        attributes["t3.reported_output_tokens"] = usage.outputTokens;
      break;
    }
    case "subagent.updated": {
      const agent = event.payload;
      kind = "subagent";
      entity = agent.id;
      runId = agent.runId ?? undefined;
      status = agent.status;
      operation = "invoke_agent";
      startedAt = epoch(agent.startedAt);
      completedAt = epoch(agent.completedAt);
      generation = String(agent.activationCount ?? 0);
      attributes["t3.agent_origin"] = agent.origin;
      attributes["t3.provider"] = identifier(agent.driver);
      attributes["t3.parent_agent_id"] = observationId(agent.parentAgentId ?? agent.parentNodeId);
      attributes["gen_ai.request.model"] = identifier(agent.model);
      if (agent.childThreadId)
        attributes["t3.child_thread_id"] = observationId(agent.childThreadId);
      break;
    }
    case "turn-item.updated": {
      const item = event.payload;
      entity = item.id;
      runId = item.runId ?? undefined;
      status = item.status;
      startedAt = epoch(item.startedAt);
      completedAt = epoch(item.completedAt);
      kind = "tool";
      operation = "execute_tool";
      switch (item.type) {
        case "command_execution":
          attributes["gen_ai.tool.name"] = "exec_command";
          if (item.exitCode !== undefined) attributes["t3.exit_code"] = item.exitCode;
          if (item.outputIndicatesFailure === true) status = "failed";
          if (terminal.has(status) && typeof item.output === "string")
            attributes["t3.result_bytes"] = Buffer.byteLength(item.output);
          break;
        case "dynamic_tool":
          attributes["gen_ai.tool.name"] = identifier(item.toolName);
          if (terminal.has(status) && typeof item.output === "string")
            attributes["t3.result_bytes"] = Buffer.byteLength(item.output);
          break;
        case "file_change":
          attributes["gen_ai.tool.name"] = "file_change";
          if (item.additions !== undefined) attributes["t3.lines_added"] = item.additions;
          if (item.deletions !== undefined) attributes["t3.lines_deleted"] = item.deletions;
          break;
        case "file_search":
        case "web_search":
          attributes["gen_ai.tool.name"] = item.type;
          if (item.results) attributes["t3.result_count"] = item.results.length;
          break;
        case "image_generation":
          attributes["gen_ai.tool.name"] = item.type;
          break;
        case "error":
          kind = "error";
          operation = "t3.provider_error";
          status = "failed";
          generation = `${item.retry?.attempt ?? 0}:${item.failure.class}:${observationId(item.failure.code ?? "unknown")}`;
          attributes["t3.error_class"] = item.failure.class;
          // Unknown codes are hashed; raw messages and stacks are intentionally absent.
          attributes["t3.error_code"] = item.failure.code
            ? observationId(item.failure.code)
            : "unknown";
          attributes["t3.retryable"] = item.failure.retryable === true;
          if (item.retry) attributes["t3.retry_attempt"] = item.retry.attempt;
          break;
        default:
          return undefined;
      }
      if (item.parentItemId) attributes["t3.parent_item_id"] = observationId(item.parentItemId);
      break;
    }
    default:
      return undefined;
  }

  const root = runId ?? event.threadId;
  const entityId = observationId(`${environmentId}:${kind}:${entity}`);
  const spanId = observationId(
    `${environmentId}:${kind}:${entity}${kind === "subagent" || kind === "error" ? `:${generation}` : ""}`,
    16,
  );
  attributes["t3.entity_id"] = entityId;
  attributes["t3.outcome"] = status;
  // GenAI operation names make Sentry classify a span as a model call by default.
  attributes[
    operation === "invoke_agent" || operation === "execute_tool"
      ? "gen_ai.operation.name"
      : "t3.operation.name"
  ] = operation;
  attributes["t3.summary"] = `${kind} ${status}`;
  if (runId) attributes["t3.run_id"] = observationId(runId);
  if (kind === "run" || kind === "subagent")
    attributes["gen_ai.agent.name"] = kind === "run" ? "T3 agent" : "T3 subagent";
  if (terminal.has(status)) completedAt ??= observedAt;
  if (completedAt !== undefined)
    attributes["t3.duration_ms"] = Math.max(0, completedAt - (startedAt ?? observedAt));
  return {
    id: observationId(`${environmentId}:${event.id}`),
    entityId,
    sequence: stored.sequence,
    kind,
    operation,
    status,
    traceId: observationId(`${environmentId}:run:${root}`),
    spanId,
    ...(kind !== "run" && runId
      ? { parentSpanId: observationId(`${environmentId}:${parent ?? `run:${runId}`}`, 16) }
      : {}),
    startedAt: startedAt ?? observedAt,
    observedAt,
    ...(completedAt === undefined ? {} : { completedAt }),
    attributes,
  };
}
