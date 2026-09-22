/**
 * HomeSuggestionsMesh - the relay side of home suggestions.
 *
 * Environments linked to the same Connect account share one daily batch so
 * the mesh spends one generation a day, not one per machine. This service is
 * the thin relay client; `HomeSuggestionsService` owns the schedule. Every
 * call answers `None` when the environment is not linked or the relay cannot
 * be reached, and the caller then behaves like a standalone environment.
 *
 * @module HomeSuggestionsMesh
 */
import type {
  RelayHomeSuggestionsBatch,
  RelayHomeSuggestionsPublishRequest,
  RelayHomeSuggestionsSyncRequest,
  RelayHomeSuggestionsSyncResponse,
} from "@t3tools/contracts/relay";
import { withRelayClientTracing } from "@t3tools/shared/relayTracing";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import {
  makeRelayEnvironmentClient,
  readRelayEnvironmentConfig,
} from "../relay/relayEnvironmentClient.ts";

const RELAY_HOME_SUGGESTIONS_TIMEOUT = "15 seconds";

export class HomeSuggestionsMesh extends Context.Service<
  HomeSuggestionsMesh,
  {
    /** Whether a Connect link is installed; unlinked environments never call the relay. */
    readonly linked: Effect.Effect<boolean>;
    readonly sync: (
      request: RelayHomeSuggestionsSyncRequest,
    ) => Effect.Effect<Option.Option<RelayHomeSuggestionsSyncResponse>>;
    /** `Some(null)` means another environment took the lease first. */
    readonly publish: (
      request: RelayHomeSuggestionsPublishRequest,
    ) => Effect.Effect<Option.Option<RelayHomeSuggestionsBatch | null>>;
  }
>()("t3/homeSuggestions/HomeSuggestionsMesh") {}

export const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const readConfig = readRelayEnvironmentConfig(secrets).pipe(Effect.orElseSucceed(() => null));

  const call = <A, E>(
    name: string,
    request: (
      client: Effect.Success<ReturnType<typeof makeRelayEnvironmentClient>>,
      environmentId: Effect.Success<typeof serverEnvironment.getEnvironmentId>,
    ) => Effect.Effect<A, E>,
  ) =>
    Effect.gen(function* () {
      const config = yield* readConfig;
      if (config === null) return Option.none<A>();
      const client = yield* makeRelayEnvironmentClient(config);
      const environmentId = yield* serverEnvironment.getEnvironmentId;
      const result = yield* request(client, environmentId).pipe(
        Effect.timeout(RELAY_HOME_SUGGESTIONS_TIMEOUT),
      );
      return Option.some(result);
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("home suggestions relay call failed; staying local", {
              call: name,
              cause: Cause.pretty(cause),
            }).pipe(Effect.as(Option.none<A>())),
      ),
      Effect.withSpan(`HomeSuggestionsMesh.${name}`),
      withRelayClientTracing,
    );

  return HomeSuggestionsMesh.of({
    linked: readConfig.pipe(Effect.map((config) => config !== null)),
    sync: (payload) =>
      call("sync", (client, environmentId) =>
        client.homeSuggestions.syncHomeSuggestions({ params: { environmentId }, payload }),
      ),
    publish: (payload) =>
      call("publish", (client, environmentId) =>
        client.homeSuggestions
          .publishHomeSuggestions({ params: { environmentId }, payload })
          .pipe(Effect.map((response) => response.batch)),
      ),
  });
});

export const layer = Layer.effect(HomeSuggestionsMesh, make);
