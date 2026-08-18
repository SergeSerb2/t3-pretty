import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { PositiveInt, TrimmedNonEmptyString } from "@t3tools/contracts";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";

export interface NormalizedOriginPullRequestRecord {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state: "open" | "closed" | "merged";
  readonly updatedAt: Option.Option<DateTime.Utc>;
  readonly mergedAt: Option.Option<DateTime.Utc>;
}

const OriginPullRequestSchema = Schema.Struct({
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: Schema.optional(Schema.NullOr(Schema.String)),
  baseRef: Schema.optional(Schema.NullOr(Schema.String)),
  headRef: Schema.optional(Schema.NullOr(Schema.String)),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  mergedAt: Schema.optional(Schema.OptionFromNullOr(Schema.DateTimeUtcFromString)),
  updatedAt: Schema.optional(Schema.OptionFromNullOr(Schema.DateTimeUtcFromString)),
  repo: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        org: Schema.optional(Schema.NullOr(Schema.String)),
        name: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  ),
});

function trimOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function originPullRequestState(
  status: string | null | undefined,
): "open" | "closed" | "merged" {
  switch (status?.trim().toLowerCase()) {
    case "merged":
      return "merged";
    case "closed":
      return "closed";
    default:
      return "open";
  }
}

export function originPullRequestUrl(input: {
  readonly url?: string | null | undefined;
  readonly number: number;
  readonly org?: string | null | undefined;
  readonly name?: string | null | undefined;
}): string {
  const explicit = trimOptional(input.url);
  if (explicit) return explicit;
  const org = trimOptional(input.org);
  const name = trimOptional(input.name);
  if (org && name) {
    return `https://cursor.com/codebase/${org}/${name}/pull/${input.number}`;
  }
  return `https://cursor.com/codebase/pull/${input.number}`;
}

function normalizeOriginPullRequest(
  raw: Schema.Schema.Type<typeof OriginPullRequestSchema>,
): NormalizedOriginPullRequestRecord {
  return {
    number: raw.number,
    title: raw.title,
    url: originPullRequestUrl({
      url: raw.url,
      number: raw.number,
      org: raw.repo?.org,
      name: raw.repo?.name,
    }),
    baseRefName: trimOptional(raw.baseRef) ?? "main",
    headRefName: trimOptional(raw.headRef) ?? "",
    state: originPullRequestState(raw.status),
    updatedAt: raw.updatedAt ?? Option.none(),
    mergedAt: raw.mergedAt ?? Option.none(),
  };
}

const decodeOriginPullRequestList = decodeJsonResult(Schema.Array(Schema.Unknown));
const decodeOriginPullRequest = decodeJsonResult(OriginPullRequestSchema);
const decodeOriginPullRequestEntry = Schema.decodeUnknownExit(OriginPullRequestSchema);

export function decodeOriginPullRequestListJson(
  raw: string,
): Result.Result<
  ReadonlyArray<NormalizedOriginPullRequestRecord>,
  Cause.Cause<Schema.SchemaError>
> {
  const result = decodeOriginPullRequestList(raw);
  if (Result.isSuccess(result)) {
    const pullRequests: NormalizedOriginPullRequestRecord[] = [];
    for (const entry of result.success) {
      const decodedEntry = decodeOriginPullRequestEntry(entry);
      if (Exit.isFailure(decodedEntry)) continue;
      pullRequests.push(normalizeOriginPullRequest(decodedEntry.value));
    }
    return Result.succeed(pullRequests);
  }
  return Result.fail(result.failure);
}

export function decodeOriginPullRequestJson(
  raw: string,
): Result.Result<NormalizedOriginPullRequestRecord, Cause.Cause<Schema.SchemaError>> {
  const result = decodeOriginPullRequest(raw);
  if (Result.isSuccess(result)) {
    return Result.succeed(normalizeOriginPullRequest(result.success));
  }
  return Result.fail(result.failure);
}
