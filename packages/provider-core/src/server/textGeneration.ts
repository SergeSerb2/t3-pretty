import type {
  BranchNamingOptions,
  ChatAttachment,
  ModelSelection,
} from "@t3tools/contracts";
import { TextGenerationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { TextGenerationPolicy } from "./textGenerationPolicy.ts";

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
  naming?: BranchNamingOptions | undefined;
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

export interface HomeSuggestionsGenerationInput {
  cwd: string;
  /** Digest of projects and recent threads; see `HomeSuggestionsContext.ts`. */
  context: string;
  projectCount: number;
  exploreCount: number;
  previousTitles: ReadonlyArray<string>;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

export interface GeneratedHomeSuggestion {
  kind: "project" | "explore";
  /** Project key from the digest; empty for explore cards. */
  projectKey: string;
  title: string;
  summary: string;
  prompt: string;
}

export interface HomeSuggestionsGenerationResult {
  suggestions: ReadonlyArray<GeneratedHomeSuggestion>;
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

/** Commit, change request, branch, title, and Pretty generation backed by one provider instance. */
export interface ProviderTextGeneration {
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

  /** Generate the home screen's daily prompt cards from a workspace digest. */
  readonly generateHomeSuggestions: (
    input: HomeSuggestionsGenerationInput,
  ) => Effect.Effect<HomeSuggestionsGenerationResult, TextGenerationError>;

  /** Generate a square project icon and save it to `outputPath`. */
  readonly generateProjectIcon: (
    input: ProjectIconGenerationInput,
  ) => Effect.Effect<ProjectIconGenerationResult, TextGenerationError>;
}

export const unsupportedProjectIconGeneration = (providerLabel: string) =>
  Effect.fn("unsupportedProjectIconGeneration")(function* (
    _input: ProjectIconGenerationInput,
  ): Effect.fn.Return<ProjectIconGenerationResult, TextGenerationError> {
    return yield* new TextGenerationError({
      operation: "generateProjectIcon",
      detail: `${providerLabel} does not generate images.`,
    });
  });
