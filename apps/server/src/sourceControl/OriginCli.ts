import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as DateTime from "effect/DateTime";

import {
  TrimmedNonEmptyString,
  type SourceControlRepositoryVisibility,
  type VcsError,
} from "@t3tools/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  decodeOriginPullRequestJson,
  decodeOriginPullRequestListJson,
} from "./originPullRequests.ts";
import type * as SourceControlProvider from "./SourceControlProvider.ts";

const DEFAULT_TIMEOUT_MS = 30_000;
const ORIGIN_GIT_HOST = "origin.cursor.com";

const originCliExecutionErrorContext = {
  operation: Schema.Literal("execute"),
  command: Schema.Literal("origin"),
  cwd: Schema.String,
  cause: Schema.Defect(),
};

const originCliDecodeErrorContext = {
  command: Schema.Literal("origin"),
  cwd: Schema.String,
  cause: Schema.Defect(),
};

export class OriginCliUnavailableError extends Schema.TaggedErrorClass<OriginCliUnavailableError>()(
  "OriginCliUnavailableError",
  originCliExecutionErrorContext,
) {
  get detail(): string {
    return "Origin CLI (`origin`) is required but not available on PATH.";
  }

  override get message(): string {
    return `Origin CLI failed in ${this.operation}: ${this.detail}`;
  }
}

export class OriginCliAuthenticationError extends Schema.TaggedErrorClass<OriginCliAuthenticationError>()(
  "OriginCliAuthenticationError",
  originCliExecutionErrorContext,
) {
  get detail(): string {
    return "Origin CLI is not authenticated. Run `origin auth login` and retry.";
  }

  override get message(): string {
    return `Origin CLI failed in ${this.operation}: ${this.detail}`;
  }
}

export class OriginCliRateLimitError extends Schema.TaggedErrorClass<OriginCliRateLimitError>()(
  "OriginCliRateLimitError",
  originCliExecutionErrorContext,
) {
  get detail(): string {
    return "Origin API rate limit exceeded.";
  }

  override get message(): string {
    return `Origin CLI failed in ${this.operation}: ${this.detail}`;
  }
}

export class OriginPullRequestNotFoundError extends Schema.TaggedErrorClass<OriginPullRequestNotFoundError>()(
  "OriginPullRequestNotFoundError",
  {
    ...originCliExecutionErrorContext,
    reference: Schema.String,
  },
) {
  get detail(): string {
    return `Pull request ${this.reference} was not found. Check the PR number or URL and try again.`;
  }

  override get message(): string {
    return `Origin CLI failed in ${this.operation}: ${this.detail}`;
  }

  static fromVcsError(
    context: {
      readonly operation: "execute";
      readonly command: "origin";
      readonly cwd: string;
      readonly reference: string;
    },
    error: VcsError,
  ): OriginCliError {
    if (error._tag === "VcsProcessExitError" && error.failureKind === "not-found") {
      return new OriginPullRequestNotFoundError({ ...context, cause: error });
    }

    return OriginCliCommandError.fromVcsError(
      {
        operation: context.operation,
        command: context.command,
        cwd: context.cwd,
      },
      error,
    );
  }
}

export class OriginCliCommandError extends Schema.TaggedErrorClass<OriginCliCommandError>()(
  "OriginCliCommandError",
  originCliExecutionErrorContext,
) {
  get detail(): string {
    return "Origin CLI command failed.";
  }

  override get message(): string {
    return `Origin CLI failed in ${this.operation}: ${this.detail}`;
  }

  static fromVcsError(
    context: {
      readonly operation: "execute";
      readonly command: "origin";
      readonly cwd: string;
    },
    error: VcsError,
  ): OriginCliError {
    return Match.valueTags(error, {
      VcsProcessSpawnError: (cause) => new OriginCliUnavailableError({ ...context, cause }),
      VcsProcessExitError: (cause) => {
        switch (cause.failureKind) {
          case "authentication":
            return new OriginCliAuthenticationError({ ...context, cause });
          case "rate-limited":
            return new OriginCliRateLimitError({ ...context, cause });
          case "not-found":
          case "command-failed":
          case undefined:
            return new OriginCliCommandError({ ...context, cause });
        }
      },
      VcsProcessTimeoutError: (cause) => new OriginCliCommandError({ ...context, cause }),
      VcsProcessStdinWriteError: (cause) => new OriginCliCommandError({ ...context, cause }),
      VcsProcessOutputReadError: (cause) => new OriginCliCommandError({ ...context, cause }),
      VcsProcessOutputLimitError: (cause) => new OriginCliCommandError({ ...context, cause }),
      VcsProcessMissingExitCodeError: (cause) => new OriginCliCommandError({ ...context, cause }),
      VcsRepositoryDetectionError: (cause) => new OriginCliCommandError({ ...context, cause }),
      VcsUnsupportedOperationError: (cause) => new OriginCliCommandError({ ...context, cause }),
    });
  }
}

export class OriginPullRequestListDecodeError extends Schema.TaggedErrorClass<OriginPullRequestListDecodeError>()(
  "OriginPullRequestListDecodeError",
  {
    ...originCliDecodeErrorContext,
    operation: Schema.Literal("listPullRequests"),
  },
) {
  get detail(): string {
    return "Origin CLI returned invalid PR list JSON.";
  }

  override get message(): string {
    return `Origin CLI failed in ${this.operation}: ${this.detail}`;
  }
}

export class OriginPullRequestDecodeError extends Schema.TaggedErrorClass<OriginPullRequestDecodeError>()(
  "OriginPullRequestDecodeError",
  {
    ...originCliDecodeErrorContext,
    operation: Schema.Literal("getPullRequest"),
    reference: Schema.String,
  },
) {
  get detail(): string {
    return "Origin CLI returned invalid pull request JSON.";
  }

  override get message(): string {
    return `Origin CLI failed in ${this.operation}: ${this.detail}`;
  }
}

export class OriginRepositoryDecodeError extends Schema.TaggedErrorClass<OriginRepositoryDecodeError>()(
  "OriginRepositoryDecodeError",
  {
    ...originCliDecodeErrorContext,
    operation: Schema.Literals(["getRepositoryCloneUrls", "createRepository", "getDefaultBranch"]),
    repository: Schema.optional(Schema.String),
  },
) {
  get detail(): string {
    return "Origin CLI returned invalid repository JSON.";
  }

  override get message(): string {
    return `Origin CLI failed in ${this.operation}: ${this.detail}`;
  }
}

export const OriginCliError = Schema.Union([
  OriginCliUnavailableError,
  OriginCliAuthenticationError,
  OriginCliRateLimitError,
  OriginPullRequestNotFoundError,
  OriginCliCommandError,
  OriginPullRequestListDecodeError,
  OriginPullRequestDecodeError,
  OriginRepositoryDecodeError,
]);
export type OriginCliError = typeof OriginCliError.Type;
export const isOriginCliError = Schema.is(OriginCliError);

export interface OriginPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly updatedAt?: Option.Option<DateTime.Utc>;
  readonly mergedAt?: Option.Option<DateTime.Utc>;
}

export interface OriginRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

export class OriginCli extends Context.Service<
  OriginCli,
  {
    readonly execute: (input: {
      readonly cwd: string;
      readonly args: ReadonlyArray<string>;
      readonly timeoutMs?: number;
      readonly stdin?: string;
      readonly maxOutputBytes?: number;
    }) => Effect.Effect<VcsProcess.VcsProcessOutput, OriginCliError>;

    readonly listPullRequests: (input: {
      readonly cwd: string;
      readonly headSelector: string;
      readonly source?: SourceControlProvider.SourceControlRefSelector;
      readonly state: "open" | "closed" | "merged" | "all";
      readonly limit?: number;
    }) => Effect.Effect<ReadonlyArray<OriginPullRequestSummary>, OriginCliError>;

    readonly getPullRequest: (input: {
      readonly cwd: string;
      readonly reference: string;
    }) => Effect.Effect<OriginPullRequestSummary, OriginCliError>;

    readonly getRepositoryCloneUrls: (input: {
      readonly cwd: string;
      readonly repository: string;
    }) => Effect.Effect<OriginRepositoryCloneUrls, OriginCliError>;

    readonly createRepository: (input: {
      readonly cwd: string;
      readonly repository: string;
      // Origin CLI create has no visibility flag; Internal/Private is chosen in the web UI.
      readonly visibility: SourceControlRepositoryVisibility;
    }) => Effect.Effect<OriginRepositoryCloneUrls, OriginCliError>;

    readonly createPullRequest: (input: {
      readonly cwd: string;
      readonly baseBranch: string;
      readonly headSelector: string;
      readonly source?: SourceControlProvider.SourceControlRefSelector;
      readonly target?: SourceControlProvider.SourceControlRefSelector;
      readonly title: string;
      readonly bodyFile: string;
    }) => Effect.Effect<void, OriginCliError>;

    readonly getDefaultBranch: (input: {
      readonly cwd: string;
    }) => Effect.Effect<string | null, OriginCliError>;

    readonly checkoutPullRequest: (input: {
      readonly cwd: string;
      readonly reference: string;
      readonly force?: boolean;
    }) => Effect.Effect<void, OriginCliError>;
  }
>()("t3/sourceControl/OriginCli") {}

const RawOriginRepositorySchema = Schema.Struct({
  org: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  defaultBranch: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  cloneUrl: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});

const decodeOriginRepository = Schema.decodeEffect(
  Schema.fromJsonString(RawOriginRepositorySchema),
);

export function originCloneUrls(input: {
  readonly org: string;
  readonly name: string;
  readonly cloneUrl?: string | null | undefined;
}): OriginRepositoryCloneUrls {
  const nameWithOwner = `${input.org}/${input.name}`;
  return {
    nameWithOwner,
    url: input.cloneUrl?.trim() || `https://${ORIGIN_GIT_HOST}/${nameWithOwner}.git`,
    sshUrl: `git@${ORIGIN_GIT_HOST}:${nameWithOwner}.git`,
  };
}

function listJsonFields(): string {
  return "number,title,url,headRef,baseRef,status,updatedAt,mergedAt,repo";
}

function viewJsonFields(): string {
  return listJsonFields();
}

function sourceRefName(input: {
  readonly headSelector: string;
  readonly source?: SourceControlProvider.SourceControlRefSelector;
}): string {
  return input.source?.refName ?? input.headSelector.trim();
}

function toSummary(record: {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state: "open" | "closed" | "merged";
  readonly updatedAt: Option.Option<DateTime.Utc>;
  readonly mergedAt: Option.Option<DateTime.Utc>;
}): OriginPullRequestSummary {
  return {
    number: record.number,
    title: record.title,
    url: record.url,
    baseRefName: record.baseRefName,
    headRefName: record.headRefName,
    state: record.state,
    ...(Option.isSome(record.updatedAt) ? { updatedAt: record.updatedAt } : {}),
    ...(Option.isSome(record.mergedAt) ? { mergedAt: record.mergedAt } : {}),
  };
}

function listStateArg(state: "open" | "closed" | "merged" | "all"): string {
  // Origin lists drafts separately from open. T3's "open" includes drafts.
  return state === "open" ? "all" : state;
}

export const make = Effect.gen(function* () {
  const process = yield* VcsProcess.VcsProcess;

  const run = (
    input: Parameters<OriginCli["Service"]["execute"]>[0],
    mapError: (error: VcsError) => OriginCliError,
  ) =>
    process
      .run({
        operation: "OriginCli.execute",
        command: "origin",
        args: input.args,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
        ...(input.maxOutputBytes === undefined ? {} : { maxOutputBytes: input.maxOutputBytes }),
      })
      .pipe(Effect.mapError(mapError));

  const execute: OriginCli["Service"]["execute"] = (input) =>
    run(input, (error) =>
      OriginCliCommandError.fromVcsError(
        { operation: "execute", command: "origin", cwd: input.cwd },
        error,
      ),
    );

  const executePullRequest = (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly args: ReadonlyArray<string>;
  }) =>
    run(input, (error) =>
      OriginPullRequestNotFoundError.fromVcsError(
        {
          operation: "execute",
          command: "origin",
          cwd: input.cwd,
          reference: input.reference,
        },
        error,
      ),
    );

  const viewRepository = (input: { readonly cwd: string; readonly repository?: string }) =>
    execute({
      cwd: input.cwd,
      args: [
        "repo",
        "view",
        ...(input.repository ? [input.repository] : []),
        "--json",
        "org,name,defaultBranch,cloneUrl",
      ],
    }).pipe(
      Effect.map((result) => result.stdout.trim()),
      Effect.flatMap((raw) =>
        decodeOriginRepository(raw).pipe(
          Effect.mapError(
            (cause) =>
              new OriginRepositoryDecodeError({
                operation: input.repository ? "getRepositoryCloneUrls" : "getDefaultBranch",
                command: "origin",
                cwd: input.cwd,
                ...(input.repository ? { repository: input.repository } : {}),
                cause,
              }),
          ),
        ),
      ),
    );

  return OriginCli.of({
    execute,
    listPullRequests: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "list",
          "--head",
          sourceRefName(input),
          "--state",
          listStateArg(input.state),
          "--limit",
          String(input.limit ?? 20),
          "--json",
          listJsonFields(),
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          raw.length === 0
            ? Effect.succeed([])
            : Effect.sync(() => decodeOriginPullRequestListJson(raw)).pipe(
                Effect.flatMap((decoded) => {
                  if (!Result.isSuccess(decoded)) {
                    return Effect.fail(
                      new OriginPullRequestListDecodeError({
                        operation: "listPullRequests",
                        command: "origin",
                        cwd: input.cwd,
                        cause: decoded.failure,
                      }),
                    );
                  }
                  const items = decoded.success.map(toSummary);
                  return Effect.succeed(
                    input.state === "open"
                      ? items.filter((item) => (item.state ?? "open") === "open")
                      : items,
                  );
                }),
              ),
        ),
      ),
    getPullRequest: (input) =>
      executePullRequest({
        cwd: input.cwd,
        reference: input.reference,
        args: ["pr", "view", input.reference, "--json", viewJsonFields()],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) =>
          Effect.sync(() => decodeOriginPullRequestJson(raw)).pipe(
            Effect.flatMap((decoded) => {
              if (!Result.isSuccess(decoded)) {
                return Effect.fail(
                  new OriginPullRequestDecodeError({
                    operation: "getPullRequest",
                    command: "origin",
                    cwd: input.cwd,
                    reference: input.reference,
                    cause: decoded.failure,
                  }),
                );
              }
              return Effect.succeed(toSummary(decoded.success));
            }),
          ),
        ),
      ),
    getRepositoryCloneUrls: (input) =>
      viewRepository({ cwd: input.cwd, repository: input.repository }).pipe(
        Effect.map((raw) => originCloneUrls(raw)),
      ),
    createRepository: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repo", "create", input.repository],
      }).pipe(
        Effect.flatMap(() => viewRepository({ cwd: input.cwd, repository: input.repository })),
        Effect.map((raw) => originCloneUrls(raw)),
      ),
    createPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "pr",
          "create",
          "--base",
          input.target?.refName ?? input.baseBranch,
          "--head",
          sourceRefName(input),
          "--title",
          input.title,
          "--body-file",
          input.bodyFile,
          "--status",
          "open",
        ],
      }).pipe(Effect.asVoid),
    getDefaultBranch: (input) =>
      viewRepository({ cwd: input.cwd }).pipe(Effect.map((value) => value.defaultBranch ?? null)),
    checkoutPullRequest: (input) =>
      executePullRequest({
        cwd: input.cwd,
        reference: input.reference,
        args: ["pr", "checkout", input.reference, ...(input.force ? ["--force"] : [])],
      }).pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(OriginCli, make);
