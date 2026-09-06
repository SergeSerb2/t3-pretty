import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  ChatAttachment,
  ModelSelection,
  ProviderInstanceId,
  ServerProvider,
} from "@t3tools/contracts";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_TEXT_GENERATION_MODEL,
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  TextGenerationError,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import type { TextGenerationPolicy } from "./TextGenerationPolicy.ts";

export type TextGenerationProvider = "codex" | "claudeAgent" | "cursor" | "grok" | "kimi";

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

type TextGenerationOp =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateBranchName"
  | "generateThreadTitle"
  | "generateActivityHeadline"
  | "generateProjectIcon";

/** The selected provider can still take work: its probe has not declared it broken. */
const canRunTextGeneration = (snapshot: ServerProvider): boolean =>
  snapshot.enabled && snapshot.installed && snapshot.status !== "error";

/** A provider worth falling back to: probed healthy and able to generate text. */
const isReadyTextGenerationProvider = (snapshot: ServerProvider): boolean =>
  snapshot.enabled &&
  snapshot.installed &&
  snapshot.status === "ready" &&
  snapshot.supportsTextGeneration !== false;

const defaultTextGenerationModelForDriver = (driver: ProviderInstance["driverKind"]): string =>
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[driver] ??
  DEFAULT_MODEL_BY_PROVIDER[driver] ??
  DEFAULT_TEXT_GENERATION_MODEL;

interface TextGenerationTarget {
  readonly textGeneration: ProviderInstance["textGeneration"];
  readonly modelSelection: ModelSelection;
}

/**
 * Resolve where a text-generation request runs. The selected instance is
 * used unless its status probe says it cannot run (binary missing, CLI
 * failing to start, unauthenticated); then the first probed-ready instance
 * takes the request with that driver's default text model, so titles,
 * branch names and headlines keep flowing while the user fixes the selected
 * provider. With no ready alternative the selected instance still runs so the
 * real provider error surfaces.
 */
const resolveTextGenerationTarget = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
  operation: TextGenerationOp,
  modelSelection: ModelSelection,
  onFallback: (
    from: ProviderInstanceId,
    to: ProviderInstanceId,
    reason: string,
  ) => Effect.Effect<void>,
): Effect.Effect<TextGenerationTarget, TextGenerationError> =>
  Effect.gen(function* () {
    const selected = yield* registry.getInstance(modelSelection.instanceId);
    // An unknown id is a caller bug, not a broken provider: fail rather than reroute.
    if (!selected) {
      return yield* new TextGenerationError({
        operation,
        detail: `No provider instance registered for id '${modelSelection.instanceId}'.`,
      });
    }
    const selectedSnapshot = yield* selected.snapshot.getSnapshot;
    if (canRunTextGeneration(selectedSnapshot)) {
      return { textGeneration: selected.textGeneration, modelSelection };
    }

    for (const instance of yield* registry.listInstances) {
      if (instance.instanceId === modelSelection.instanceId) continue;
      const snapshot = yield* instance.snapshot.getSnapshot;
      if (!isReadyTextGenerationProvider(snapshot)) continue;
      yield* onFallback(
        modelSelection.instanceId,
        instance.instanceId,
        selectedSnapshot.message ?? `provider status is ${selectedSnapshot.status}`,
      );
      return {
        textGeneration: instance.textGeneration,
        modelSelection: createModelSelection(
          instance.instanceId,
          defaultTextGenerationModelForDriver(instance.driverKind),
        ),
      };
    }

    return { textGeneration: selected.textGeneration, modelSelection };
  });

export const makeTextGenerationFromRegistry = (
  registry: ProviderInstanceRegistry.ProviderInstanceRegistry["Service"],
): TextGeneration["Service"] => {
  // Headlines re-run every few seconds per thread; log each distinct reroute once.
  // Bounded by instance pairs, so the set stays small for the process lifetime.
  const loggedFallbacks = new Set<string>();
  const logFallback = (from: ProviderInstanceId, to: ProviderInstanceId, reason: string) => {
    const key = `${from}->${to}`;
    if (loggedFallbacks.has(key)) return Effect.void;
    loggedFallbacks.add(key);
    return Effect.logWarning(
      "text generation provider cannot run; using a ready provider instead",
      {
        selectedInstanceId: from,
        fallbackInstanceId: to,
        reason,
      },
    );
  };
  const target = (operation: TextGenerationOp, modelSelection: ModelSelection) =>
    resolveTextGenerationTarget(registry, operation, modelSelection, logFallback);

  return TextGeneration.of({
    generateCommitMessage: (input) =>
      target("generateCommitMessage", input.modelSelection).pipe(
        Effect.flatMap(({ textGeneration, modelSelection }) =>
          textGeneration.generateCommitMessage({ ...input, modelSelection }),
        ),
      ),
    generatePrContent: (input) =>
      target("generatePrContent", input.modelSelection).pipe(
        Effect.flatMap(({ textGeneration, modelSelection }) =>
          textGeneration.generatePrContent({ ...input, modelSelection }),
        ),
      ),
    generateBranchName: (input) =>
      target("generateBranchName", input.modelSelection).pipe(
        Effect.flatMap(({ textGeneration, modelSelection }) =>
          textGeneration.generateBranchName({ ...input, modelSelection }),
        ),
      ),
    generateThreadTitle: (input) =>
      target("generateThreadTitle", input.modelSelection).pipe(
        Effect.flatMap(({ textGeneration, modelSelection }) =>
          textGeneration.generateThreadTitle({ ...input, modelSelection }),
        ),
      ),
    generateActivityHeadline: (input) =>
      target("generateActivityHeadline", input.modelSelection).pipe(
        Effect.flatMap(({ textGeneration, modelSelection }) =>
          textGeneration.generateActivityHeadline({ ...input, modelSelection }),
        ),
      ),
    generateProjectIcon: (input) =>
      target("generateProjectIcon", input.modelSelection).pipe(
        Effect.flatMap(({ textGeneration, modelSelection }) =>
          textGeneration.generateProjectIcon({ ...input, modelSelection }),
        ),
      ),
  });
};

export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  return makeTextGenerationFromRegistry(registry);
});

export const layer = Layer.effect(TextGeneration, make);
