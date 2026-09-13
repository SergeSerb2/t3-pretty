import { makeAggregateState as makeParentAggregateState } from "./agentActivityAggregate.ts";
export { TERMINAL_AGENT_ACTIVITY_DISPLAY_TTL_MS } from "./agentActivityAggregate.ts";
import {
  RELAY_DEVICE_MAX_COUNT,
  type RelayAgentActivityState,
  type RelayDeliveryResult,
  type RelayPublishResponse,
} from "@t3tools/contracts/relay";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { isTerminalPhase } from "./agentActivityPayloads.ts";

export { isExpiredAgentActivityState } from "./agentActivityPayloads.ts";
import * as AgentActivityRows from "./AgentActivityRows.ts";
import * as EnvironmentLinks from "../environments/EnvironmentLinks.ts";
import * as LiveActivities from "./LiveActivities.ts";
import * as ApnsDeliveries from "./ApnsDeliveries.ts";
import * as FcmDeliveries from "./FcmDeliveries.ts";

export type AgentActivityPublishError =
  | FcmDeliveries.FcmDeliveryError
  | AgentActivityRows.AgentActivityRowUpsertPersistenceError
  | AgentActivityRows.AgentActivityRowDeletePersistenceError
  | AgentActivityRows.AgentActivityRowListPersistenceError
  | EnvironmentLinks.EnvironmentLinkUserListPersistenceError
  | LiveActivities.LiveActivityTargetListPersistenceError
  | ApnsDeliveries.ApnsDeliveryError;

export class AgentActivityPublisher extends Context.Service<
  AgentActivityPublisher,
  {
    readonly publish: (input: {
      readonly environmentId: string;
      readonly environmentPublicKey: string;
      readonly threadId: string;
      readonly state: RelayAgentActivityState | null;
    }) => Effect.Effect<RelayPublishResponse, AgentActivityPublishError>;
    readonly replayForLiveActivityRegistration: (input: {
      readonly userId: string;
      readonly deviceId: string;
    }) => Effect.Effect<RelayDeliveryResult | null, AgentActivityPublishError>;
  }
>()("t3code-relay/agentActivity/AgentActivityPublisher") {}

export const make = Effect.gen(function* () {
  const rows = yield* AgentActivityRows.AgentActivityRows;
  const links = yield* EnvironmentLinks.EnvironmentLinks;
  const liveActivities = yield* LiveActivities.LiveActivities;
  const apnsDeliveries = yield* ApnsDeliveries.ApnsDeliveries;
  const fcmDeliveries = yield* FcmDeliveries.FcmDeliveries;

  const publishForDeliveryUser = Effect.fnUntraced(function* (input: {
    readonly deliveryUser: EnvironmentLinks.AgentAwarenessDeliveryUserRecord;
    readonly state: RelayAgentActivityState | null;
    readonly nowMs: number;
  }) {
    const activeStates = input.deliveryUser.liveActivitiesEnabled
      ? yield* rows.listForUser({ userId: input.deliveryUser.userId })
      : [];
    const liveActivityAggregate = input.deliveryUser.liveActivitiesEnabled
      ? makeAggregateState({
          activeStates,
          terminalState: input.state && isTerminalPhase(input.state) ? input.state : null,
          nowMs: input.nowMs,
        })
      : null;
    const notificationOnlyAggregate =
      input.deliveryUser.notificationsEnabled &&
      !input.deliveryUser.liveActivitiesEnabled &&
      input.state !== null
        ? makeAggregateState({
            activeStates: isTerminalPhase(input.state) ? [] : [input.state],
            terminalState: isTerminalPhase(input.state) ? input.state : null,
            nowMs: input.nowMs,
          })
        : null;
    const targets = yield* liveActivities.listTargets({ userId: input.deliveryUser.userId });
    const deliveriesByTarget = yield* Effect.forEach(
      targets,
      Effect.fnUntraced(function* (target) {
        if (target.platform === "android") {
          return [yield* fcmDeliveries.enqueue({ target, state: input.state })];
        }
        return yield* Effect.all(
          [
            apnsDeliveries.sendForTarget({
              target,
              aggregate: liveActivityAggregate,
              nowMs: input.nowMs,
            }),
            notificationOnlyAggregate === null
              ? Effect.succeed(null)
              : apnsDeliveries.sendPushNotificationForTarget({
                  target,
                  aggregate: notificationOnlyAggregate,
                }),
          ],
          { concurrency: 2 },
        );
      }),
      { concurrency: 4 },
    );
    return deliveriesByTarget.flat();
  });

  return AgentActivityPublisher.of({
    replayForLiveActivityRegistration: Effect.fn(
      "relay.agent_activity_publisher.replay_for_live_activity_registration",
    )(function* (input) {
      yield* Effect.annotateCurrentSpan({
        "relay.mobile.device_id": input.deviceId,
        "relay.operation": "replayForLiveActivityRegistration",
      });
      const { activeStates, targets } = yield* Effect.all(
        {
          activeStates: rows.listForUser({ userId: input.userId }),
          targets: liveActivities.listTargets({ userId: input.userId }),
        },
        { concurrency: 2 },
      );
      const target = targets.find((row) => row.device_id === input.deviceId) ?? null;
      if (target === null) {
        return null;
      }
      if (target.platform === "android") {
        return yield* fcmDeliveries.enqueue({ target, state: null, replay: true });
      }
      const now = yield* DateTime.now;
      const aggregate = makeAggregateState({
        activeStates,
        terminalState: null,
        nowMs: now.epochMilliseconds,
      });
      return yield* apnsDeliveries.sendForTarget({
        target,
        aggregate,
        nowMs: now.epochMilliseconds,
        replay: true,
      });
    }),
    publish: Effect.fn("relay.agent_activity_publisher.publish")(function* (input) {
      yield* Effect.annotateCurrentSpan({
        "relay.environment_id": input.environmentId,
        "relay.thread_id": input.threadId,
        "relay.agent_activity.phase": input.state?.phase ?? "deleted",
      });
      if (input.state) {
        // Terminal states are persisted too (pruned by the cron after they
        // age out) so a thread that finishes while other agents are active
        // stays visible as Done/Failed in subsequent aggregates instead of
        // silently vanishing from the Live Activity.
        yield* rows.upsert({
          environmentPublicKey: input.environmentPublicKey,
          state: input.state,
        });
      } else {
        yield* rows.remove({
          environmentId: input.environmentId,
          environmentPublicKey: input.environmentPublicKey,
          threadId: input.threadId,
        });
      }

      const deliveryUsers = yield* links.listDeliveryUsersForEnvironment({
        environmentId: input.environmentId,
        environmentPublicKey: input.environmentPublicKey,
      });
      const now = yield* DateTime.now;
      const deliveryDiagnostics = yield* Ref.make<ReadonlyArray<RelayDeliveryResult>>([]);
      yield* Effect.forEach(
        deliveryUsers,
        (deliveryUser) =>
          publishForDeliveryUser({
            deliveryUser,
            state: input.state,
            nowMs: now.epochMilliseconds,
          }).pipe(
            Effect.flatMap((results) =>
              Ref.update(deliveryDiagnostics, (current) => {
                if (current.length >= RELAY_DEVICE_MAX_COUNT) {
                  return current;
                }
                const remaining = RELAY_DEVICE_MAX_COUNT - current.length;
                const next = results
                  .filter((delivery): delivery is RelayDeliveryResult => delivery !== null)
                  .slice(0, remaining);
                return next.length === 0 ? current : [...current, ...next];
              }),
            ),
          ),
        { concurrency: 4, discard: true },
      );
      return {
        ok: true,
        deliveries: yield* Ref.get(deliveryDiagnostics),
      };
    }),
  });
});

function statusForPhase(phase: RelayAgentActivityState["phase"]): string {
  switch (phase) {
    case "waiting_for_approval":
      return "Approval";
    case "waiting_for_input":
      return "Input";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "starting":
      // Matches the web sidebar's pill wording (Sidebar.logic.ts) so the same
      // thread reads the same across surfaces.
      return "Connecting";
    case "running":
      return "Working";
    case "stale":
      return "Waiting";
  }
}

function statusForState(state: RelayAgentActivityState): string {
  // Running work otherwise reads as a frozen "Working" label for the whole
  // turn. The awareness projection puts the current plan step in `detail`.
  if (state.phase === "running" && state.detail) {
    return state.detail;
  }
  return statusForPhase(state.phase);
}

export function makeAggregateState(input: {
  readonly activeStates: ReadonlyArray<RelayAgentActivityState>;
  readonly terminalState: RelayAgentActivityState | null;
  readonly nowMs: number;
}) {
  const aggregate = makeParentAggregateState(input);
  if (aggregate === null) {
    return null;
  }

  const statesByActivity = new Map<string, RelayAgentActivityState>();
  for (const state of input.activeStates) {
    statesByActivity.set(`${state.environmentId}\u0000${state.threadId}`, state);
  }
  if (input.terminalState !== null) {
    statesByActivity.set(
      `${input.terminalState.environmentId}\u0000${input.terminalState.threadId}`,
      input.terminalState,
    );
  }

  return {
    ...aggregate,
    activities: aggregate.activities.map((activity) => {
      const state = statesByActivity.get(`${activity.environmentId}\u0000${activity.threadId}`);
      if (state === undefined) {
        return activity;
      }
      return {
        ...activity,
        status: statusForState(state),
        ...(state.progress === undefined ? {} : { progress: state.progress }),
        ...(state.startedAt === undefined ? {} : { startedAt: state.startedAt }),
      };
    }),
  };
}

export const layer = Layer.effect(AgentActivityPublisher, make);
