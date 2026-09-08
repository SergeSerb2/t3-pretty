/**
 * GrokBotEvents — typed views over the box gateway `/events` payloads.
 *
 * The gateway feed is untyped JSON. Only the fields the adapter acts on are
 * decoded; everything else is carried in `raw` for the event log. Shapes were
 * observed from live traffic and the desktop bundle, see GrokBotGateway.ts.
 *
 * @module provider/grokBot/GrokBotEvents
 */
import * as Schema from "effect/Schema";

import type { GatewayEvent } from "./GrokBotGateway.ts";

const WidgetOption = Schema.Struct({
  label: Schema.String,
  value: Schema.String,
  style: Schema.optional(Schema.String),
});

const SendMessageBody = Schema.Union([
  Schema.Struct({ type: Schema.Literal("text"), content: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("widget"),
    widget: Schema.Struct({
      prompt: Schema.String,
      copyKind: Schema.optional(Schema.String),
      options: Schema.optional(Schema.Array(WidgetOption)),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("local-tool-permission"),
    ask: Schema.Struct({
      requestId: Schema.String,
      action: Schema.optional(Schema.String),
      target: Schema.optional(Schema.String),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal("auto-review-approval"),
    approval: Schema.Struct({
      requestId: Schema.String,
      surface: Schema.optional(Schema.String),
      summary: Schema.optional(Schema.String),
    }),
  }),
]);

/**
 * Only bot-authored entries drive the adapter. User echoes (`message`),
 * `event`, `spend-initiation` rows and message types the adapter has no
 * rendering for (e.g. `connector`) fail to decode and are skipped.
 */
const BotMessageEntry = Schema.Struct({
  kind: Schema.Literal("send-message"),
  id: Schema.String,
  message: SendMessageBody,
  requestId: Schema.optional(Schema.String),
});
export type GrokBotBotMessageEntry = typeof BotMessageEntry.Type;

const TranscriptEventPayload = Schema.Struct({
  type: Schema.String,
  agentId: Schema.String,
  entry: Schema.Unknown,
});
const decodeBotMessage = Schema.decodeUnknownOption(BotMessageEntry);

const RosterAgent = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  isRunning: Schema.optional(Schema.Boolean),
  isRunningTurn: Schema.optional(Schema.Boolean),
  isComposingMessage: Schema.optional(Schema.Boolean),
});
export type GrokBotRosterAgent = typeof RosterAgent.Type;

const AgentUpsertedPayload = Schema.Struct({ agent: RosterAgent });
const AgentsPayload = Schema.Struct({ agents: Schema.Array(RosterAgent) });

const LiveActivity = Schema.Struct({
  kind: Schema.optional(Schema.String),
  tool: Schema.optional(Schema.String),
  detail: Schema.optional(Schema.String),
  target: Schema.optional(Schema.String),
  callId: Schema.optional(Schema.String),
});
export type GrokBotLiveActivity = typeof LiveActivity.Type;

const AgentActivityPayload = Schema.Struct({
  agentId: Schema.String,
  live: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        isRunning: Schema.optional(Schema.Boolean),
        activity: Schema.optional(Schema.NullOr(LiveActivity)),
      }),
    ),
  ),
});

const decodeTranscript = Schema.decodeUnknownOption(TranscriptEventPayload);
const decodeUpserted = Schema.decodeUnknownOption(AgentUpsertedPayload);
const decodeAgents = Schema.decodeUnknownOption(AgentsPayload);
const decodeActivity = Schema.decodeUnknownOption(AgentActivityPayload);

export type GrokBotGatewaySignal =
  | {
      readonly _tag: "bot-message";
      readonly agentId: string;
      readonly entry: GrokBotBotMessageEntry;
    }
  | { readonly _tag: "agent"; readonly agent: GrokBotRosterAgent }
  | {
      readonly _tag: "activity";
      readonly agentId: string;
      readonly activity: GrokBotLiveActivity | null;
    };

/** Flatten one gateway event into the signals the adapter reacts to. */
export function gatewaySignals(event: GatewayEvent): ReadonlyArray<GrokBotGatewaySignal> {
  switch (event.channel) {
    case "transcript": {
      const decoded = decodeTranscript(event.payload);
      if (decoded._tag === "None") return [];
      const entry = decodeBotMessage(decoded.value.entry);
      return entry._tag === "None"
        ? []
        : [{ _tag: "bot-message", agentId: decoded.value.agentId, entry: entry.value }];
    }
    case "agent-upserted": {
      const decoded = decodeUpserted(event.payload);
      return decoded._tag === "None" ? [] : [{ _tag: "agent", agent: decoded.value.agent }];
    }
    case "agents": {
      const decoded = decodeAgents(event.payload);
      return decoded._tag === "None"
        ? []
        : decoded.value.agents.map((agent) => ({ _tag: "agent" as const, agent }));
    }
    case "agent-activity": {
      const decoded = decodeActivity(event.payload);
      if (decoded._tag === "None") return [];
      return [
        {
          _tag: "activity",
          agentId: decoded.value.agentId,
          activity: decoded.value.live?.activity ?? null,
        },
      ];
    }
    default:
      return [];
  }
}

/** Human-readable one-liner for a live tool activity. */
export function describeActivity(activity: GrokBotLiveActivity): string {
  const head = [activity.kind, activity.tool].filter((part): part is string => !!part?.trim());
  const tail = activity.detail?.trim() || activity.target?.trim();
  const label = head.join(" · ") || "Working";
  return tail ? `${label}: ${tail}` : label;
}
