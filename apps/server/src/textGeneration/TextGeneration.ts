import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_TEXT_GENERATION_MODEL,
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  TextGenerationError,
} from "@t3tools/contracts";
import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";

import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "@t3tools/provider-core/server/driver";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as ThreadTitleLinks from "./ThreadTitleLinks.ts";

export type {
  ActivityHeadlineGenerationInput,
  ActivityHeadlineGenerationResult,
  BranchNameGenerationInput,
  BranchNameGenerationResult,
  CommitMessageGenerationInput,
  CommitMessageGenerationResult,
  GeneratedHomeSuggestion,
  HomeSuggestionsGenerationInput,
  HomeSuggestionsGenerationResult,
  PrContentGenerationInput,
  PrContentGenerationResult,
  ProjectIconGenerationInput,
  ProjectIconGenerationResult,
  ThreadTitleGenerationInput,
  ThreadTitleGenerationResult,
} from "@t3tools/provider-core/server/textGeneration";
export {
  unsupportedProjectIconGeneration,
} from "@t3tools/provider-core/server/textGeneration";

/**
 * TextGeneration - Service tag for commit and change request text generation.
 */
export class TextGeneration extends Context.Service<TextGeneration, ProviderTextGeneration>()(
  "t3/textGeneration/TextGeneration",
) {}

type TextGenerationOp = keyof ProviderTextGeneration;

/** Auth and missing-instance failures: try another enabled provider. */
export function isFallbackEligibleTextGenerationError(error: TextGenerationError): boolean {
  const detail = error.detail.toLowerCase();
  return (
    detail.includes("no provider instance registered") ||
    detail.includes("401") ||
    detail.includes("unauthorized") ||
    detail.includes("unauthenticated") ||
    detail.includes("refresh token") ||
    detail.includes("not authenticated") ||
    detail.includes("sign in again") ||
    detail.includes("session has expired") ||
    detail.includes("token_expired") ||
    detail.includes("refresh_token_expired")
  );
}

function fallbackModelSelection(instance: ProviderInstance): ModelSelection {
  return {
    instanceId: instance.instanceId,
    model:
      DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[instance.driverKind] ??
      DEFAULT_MODEL_BY_PROVIDER[instance.driverKind] ??
      DEFAULT_TEXT_GENERATION_MODEL,
  };
}

const snapshotAllowsTextGeneration = (instance: ProviderInstance): Effect.Effect<boolean> =>
  instance.snapshot.getSnapshot.pipe(
    Effect.map(
      (snapshot) =>
        snapshot.auth?.status !== "unauthenticated" && snapshot.supportsTextGeneration !== false,
    ),
    Effect.catchCause(() => Effect.succeed(true)),
  );

const resolveInstance = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOp,
  instanceId: ProviderInstanceId,
): Effect.Effect<ProviderInstance["textGeneration"], TextGenerationError> =>
  registry.getInstance(instanceId).pipe(
    Effect.flatMap((instance) =>
      instance
        ? Effect.succeed(instance.textGeneration)
        : Effect.fail(
            new TextGenerationError({
              operation,
              detail: `No provider instance registered for id '${instanceId}'.`,
            }),
          ),
    ),
  );

const runWithTextGenerationFallback = <A>(
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOp,
  modelSelection: ModelSelection,
  run: (
    textGeneration: ProviderInstance["textGeneration"],
    selection: ModelSelection,
  ) => Effect.Effect<A, TextGenerationError>,
): Effect.Effect<A, TextGenerationError> =>
  resolveInstance(registry, operation, modelSelection.instanceId).pipe(
    Effect.flatMap((textGeneration) => run(textGeneration, modelSelection)),
    Effect.catchTag("TextGenerationError", (primaryError) => {
      if (!isFallbackEligibleTextGenerationError(primaryError)) {
        return Effect.fail(primaryError);
      }
      return Effect.gen(function* () {
        const instances = yield* registry.listInstances;
        for (const instance of instances) {
          if (!instance.enabled || instance.instanceId === modelSelection.instanceId) {
            continue;
          }
          if (!(yield* snapshotAllowsTextGeneration(instance))) {
            continue;
          }
          const fallbackSelection = fallbackModelSelection(instance);
          const result = yield* run(instance.textGeneration, fallbackSelection).pipe(Effect.result);
          if (Result.isSuccess(result)) {
            yield* Effect.logWarning(
              "text generation fell back after the selected provider failed",
              {
                operation,
                primaryInstanceId: modelSelection.instanceId,
                fallbackInstanceId: instance.instanceId,
                detail: primaryError.detail,
              },
            );
            return result.success;
          }
        }
        return yield* Effect.fail(primaryError);
      });
    }),
  );

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const sourceControl = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  return TextGeneration.of({
    generateCommitMessage: (input) =>
      runWithTextGenerationFallback(
        registry,
        "generateCommitMessage",
        input.modelSelection,
        (textGeneration, modelSelection) =>
          textGeneration.generateCommitMessage({ ...input, modelSelection }),
      ),
    generatePrContent: (input) =>
      runWithTextGenerationFallback(
        registry,
        "generatePrContent",
        input.modelSelection,
        (textGeneration, modelSelection) =>
          textGeneration.generatePrContent({ ...input, modelSelection }),
      ),
    generateBranchName: (input) =>
      runWithTextGenerationFallback(
        registry,
        "generateBranchName",
        input.modelSelection,
        (textGeneration, modelSelection) =>
          textGeneration.generateBranchName({ ...input, modelSelection }),
      ),
    generateThreadTitle: (input) =>
      Effect.gen(function* () {
        const linkedContext =
          input.linkedContext ??
          (yield* ThreadTitleLinks.resolveThreadTitleLinks(input).pipe(
            Effect.provideService(
              SourceControlProviderRegistry.SourceControlProviderRegistry,
              sourceControl,
            ),
          ));
        return yield* runWithTextGenerationFallback(
          registry,
          "generateThreadTitle",
          input.modelSelection,
          (textGeneration, modelSelection) =>
            textGeneration.generateThreadTitle({ ...input, linkedContext, modelSelection }),
        );
      }),
    generateActivityHeadline: (input) =>
      runWithTextGenerationFallback(
        registry,
        "generateActivityHeadline",
        input.modelSelection,
        (textGeneration, modelSelection) =>
          textGeneration.generateActivityHeadline({ ...input, modelSelection }),
      ),
    generateHomeSuggestions: (input) =>
      runWithTextGenerationFallback(
        registry,
        "generateHomeSuggestions",
        input.modelSelection,
        (textGeneration, modelSelection) =>
          textGeneration.generateHomeSuggestions({ ...input, modelSelection }),
      ),
    generateProjectIcon: (input) =>
      runWithTextGenerationFallback(
        registry,
        "generateProjectIcon",
        input.modelSelection,
        (textGeneration, modelSelection) =>
          textGeneration.generateProjectIcon({ ...input, modelSelection }),
      ),
  });
});

export const layer = Layer.effect(TextGeneration, make);
