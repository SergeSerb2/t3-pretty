import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import type { ChatAttachment, ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_TEXT_GENERATION_MODEL,
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  TextGenerationError,
} from "@t3tools/contracts";

import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import * as ThreadTitleLinks from "./ThreadTitleLinks.ts";
import type { TextGenerationPolicy } from "./TextGenerationPolicy.ts";

export type TextGenerationProvider = "codex" | "claudeAgent" | "cursor" | "grok";

export interface CommitMessageGenerationInput {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  /** When true, the model also returns a semantic branch name for the change. */
  includeBranch?: boolean;
  policy?: TextGenerationPolicy | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface CommitMessageGenerationResult {
  subject: string;
  body: string;
  /** Only present when `includeBranch` was set on the input. */
  branch?: string | undefined;
}

export interface PrContentGenerationInput {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
  changeRequestTemplate?: string | undefined;
  policy?: TextGenerationPolicy | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface PrContentGenerationResult {
  title: string;
  body: string;
}

export interface BranchNameGenerationInput {
  cwd: string;
  message: string;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface BranchNameGenerationResult {
  branch: string;
}

export interface ThreadTitleGenerationInput {
  linkedContext?: string | undefined;
  cwd: string;
  message: string;
  /** Present when replacing an existing title from the current thread history. */
  previousTitle?: string | undefined;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface ThreadTitleGenerationResult {
  title: string;
  needsRefinement?: boolean | undefined;
}

export interface ActivityHeadlineGenerationInput {
  cwd: string;
  /** Raw activity summary as ingested from the provider. */
  summary: string;
  /** Full command text when the activity is a command run. */
  command?: string | undefined;
  /** Tool detail/output excerpt when available. */
  detail?: string | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface ActivityHeadlineGenerationResult {
  /** Empty string when the model returned nothing usable. */
  headline: string;
}

export interface ProjectIconGenerationInput {
  cwd: string;
  projectTitle: string;
  outputPath: string;
  modelSelection: ModelSelection;
}

export interface ProjectIconGenerationResult {
  path: string;
}

/**
 * TextGeneration - Service tag for commit and change request text generation.
 */
export class TextGeneration extends Context.Service<
  TextGeneration,
  {
    /**
     * Generate a commit message from staged change context.
     */
    readonly generateCommitMessage: (
      input: CommitMessageGenerationInput,
    ) => Effect.Effect<CommitMessageGenerationResult, TextGenerationError>;

    /**
     * Generate change request title/body from branch and diff context.
     */
    readonly generatePrContent: (
      input: PrContentGenerationInput,
    ) => Effect.Effect<PrContentGenerationResult, TextGenerationError>;

    /**
     * Generate a concise branch name from a user message.
     */
    readonly generateBranchName: (
      input: BranchNameGenerationInput,
    ) => Effect.Effect<BranchNameGenerationResult, TextGenerationError>;

    /** Generate a concise thread title from a first message or thread history. */
    readonly generateThreadTitle: (
      input: ThreadTitleGenerationInput,
    ) => Effect.Effect<ThreadTitleGenerationResult, TextGenerationError>;

    /** Generate a short live-status headline for a running turn's activity. */
    readonly generateActivityHeadline: (
      input: ActivityHeadlineGenerationInput,
    ) => Effect.Effect<ActivityHeadlineGenerationResult, TextGenerationError>;

    /** Generate a square project icon and save it to `outputPath`. */
    readonly generateProjectIcon: (
      input: ProjectIconGenerationInput,
    ) => Effect.Effect<ProjectIconGenerationResult, TextGenerationError>;
  }
>()("t3/textGeneration/TextGeneration") {}

export const unsupportedProjectIconGeneration = (providerLabel: string) =>
  Effect.fn("unsupportedProjectIconGeneration")(function* (
    _input: ProjectIconGenerationInput,
  ): Effect.fn.Return<ProjectIconGenerationResult, TextGenerationError> {
    return yield* new TextGenerationError({
      operation: "generateProjectIcon",
      detail: `${providerLabel} does not generate images.`,
    });
  });

/**
 * Text generation for providers that only run conversational agents (Grok
 * Bot). Every operation fails with a clear message so the UI can steer the
 * user to another provider for commit messages and titles.
 */
export const makeUnsupportedTextGeneration = (providerLabel: string): TextGeneration["Service"] => {
  const unsupported = (operation: TextGenerationOp) =>
    Effect.fail(
      new TextGenerationError({
        operation,
        detail: `${providerLabel} does not generate text outside of a thread.`,
      }),
    );
  return {
    generateCommitMessage: () => unsupported("generateCommitMessage"),
    generatePrContent: () => unsupported("generatePrContent"),
    generateBranchName: () => unsupported("generateBranchName"),
    generateThreadTitle: () => unsupported("generateThreadTitle"),
    generateActivityHeadline: () => unsupported("generateActivityHeadline"),
    generateProjectIcon: () => unsupported("generateProjectIcon"),
  };
};

type TextGenerationOp =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "generateActivityHeadline"
  | "generateProjectIcon";

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
  typeof instance.snapshot.getSnapshot !== "function"
    ? Effect.succeed(true)
    : instance.snapshot.getSnapshot.pipe(
        Effect.map(
          (snapshot) =>
            snapshot.auth?.status !== "unauthenticated" &&
            snapshot.supportsTextGeneration !== false,
        ),
        Effect.catchCause(() => Effect.succeed(true)),
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
