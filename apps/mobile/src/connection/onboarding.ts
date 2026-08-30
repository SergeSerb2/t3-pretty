import {
  ConnectionOnboarding,
  ConnectionTransientError,
  EnvironmentRegistry,
  preparePairingRegistration,
} from "@t3tools/client-runtime/connection";
import {
  createAtomCommandScheduler,
  createRuntimeCommand,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { connectionAtomRuntime } from "./runtime";

const onboardingScheduler = createAtomCommandScheduler();
const MOBILE_ONBOARDING_TIMEOUT_MS = 30_000;
let pairingAttemptGeneration = 0;

export function invalidatePairingConnectionAttempt(): void {
  pairingAttemptGeneration += 1;
}

function withOnboardingDeadline<A, E, R>(
  detail: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | ConnectionTransientError, R> {
  return effect.pipe(
    Effect.timeoutOption(Duration.millis(MOBILE_ONBOARDING_TIMEOUT_MS)),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new ConnectionTransientError({
              reason: "network",
              detail,
            }),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );
}

export const connectPairingUrl = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connection:connect-pairing-url",
  scheduler: onboardingScheduler,
  concurrency: { mode: "singleFlight", key: (pairingUrl: string) => pairingUrl },
  execute: (pairingUrl: string) =>
    withOnboardingDeadline(
      "Pairing with the environment timed out.",
      Effect.gen(function* () {
        const generation = pairingAttemptGeneration + 1;
        pairingAttemptGeneration = generation;
        const prepared = yield* preparePairingRegistration({ pairingUrl }).pipe(Effect.result);
        if (pairingAttemptGeneration !== generation) {
          return yield* Effect.interrupt;
        }
        if (prepared._tag === "Failure") {
          return yield* Effect.fail(prepared.failure);
        }
        const registry = yield* EnvironmentRegistry;
        yield* registry.register(prepared.success);
        if (pairingAttemptGeneration !== generation) {
          return yield* Effect.interrupt;
        }
        return prepared.success.target.environmentId;
      }),
    ),
});

export const updateBearerConnection = createRuntimeCommand(connectionAtomRuntime, {
  label: "mobile:connection:update-bearer",
  scheduler: onboardingScheduler,
  concurrency: {
    mode: "serial",
    key: (input: { readonly environmentId: EnvironmentId }) => input.environmentId,
  },
  execute: (input: {
    readonly environmentId: EnvironmentId;
    readonly label: string;
    readonly httpBaseUrl: string;
  }) =>
    withOnboardingDeadline(
      "Saving the environment connection timed out.",
      ConnectionOnboarding.pipe(Effect.flatMap((onboarding) => onboarding.updateBearer(input))),
    ),
});
