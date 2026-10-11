import type {
  BranchNamingOptions,
  ChatAttachment,
  ModelSelection,
  PullRequestReviewGuide,
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

export interface ReviewGuideStackLayer {
  readonly number: number;
  readonly title: string | null;
  /** The layer's head in the checkout, null where it could not be fetched. */
  readonly headSha: string | null;
  readonly state: "open" | "closed" | "merged";
}

export interface ReviewGuideGenerationInput {
  /** A disposable checkout of the change's head. The model investigates it read-only. */
  cwd: string;
  number: number;
  title: string;
  /** The author's own description, which states intent the diff cannot. */
  description: string;
  baseBranch: string;
  /** The commit the change is measured from, present in `cwd`. */
  baseCommit: string;
  /**
   * What review already settled: resolved conversations, reduced to who raised what. The guide
   * leaves these alone rather than raising them again.
   */
  settledReview: string;
  /** The maintainer's preferences for guides (tone, emphasis, ordering). Empty for none. */
  instructions?: string | undefined;
  /**
   * The stack the change is a layer of, bottom first, when it is in one. Another layer's head is
   * fetched into `cwd` where the host served it, so the model can read across a seam.
   */
  stack?: ReadonlyArray<ReviewGuideStackLayer> | undefined;
  /** What model and provider to use for generation. */
  modelSelection: ModelSelection;
}

/** A guide as the model wrote it, before the server holds it to the change. */
export type ReviewGuideGenerationResult = Omit<
  PullRequestReviewGuide,
  "headSha" | "generatedAt" | "modelSelection"
>;

/** Commit, change request, branch, title, review guide, and Pretty generation backed by one provider instance. */
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

  /** Explain a change request to the maintainer deciding whether it lands. */
  readonly generateReviewGuide: (
    input: ReviewGuideGenerationInput,
  ) => Effect.Effect<ReviewGuideGenerationResult, TextGenerationError>;
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
