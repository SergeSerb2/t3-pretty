import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type {
  PullRequestActor,
  PullRequestCheck,
  PullRequestCheckStatus,
  PullRequestChecksState,
  PullRequestComment,
  PullRequestCommit,
  PullRequestMergeability,
  PullRequestReviewThread,
  PullRequestState,
} from "@t3tools/contracts";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";

import {
  originPullRequestState,
  originPullRequestUrl,
} from "../sourceControl/originPullRequests.ts";
import type { ProviderChangeRequest, ProviderChangeRequestDetail } from "./PullRequestProvider.ts";

const UnknownRecord = Schema.Record(Schema.String, Schema.Unknown);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

const FALLBACK_ISO = "1970-01-01T00:00:00.000Z";

function asIso(value: unknown): string | null {
  const raw = asString(value);
  if (raw === null) return null;
  return Option.match(DateTime.make(raw), {
    onNone: () => null,
    onSome: DateTime.formatIso,
  });
}

export function originActor(input: {
  readonly login?: string | null | undefined;
  readonly name?: string | null | undefined;
}): PullRequestActor | null {
  const login = input.login?.trim();
  if (!login) return null;
  return {
    login,
    name: input.name?.trim() || null,
    avatarUrl: null,
  };
}

export function originStateAndDraft(status: string | null | undefined): {
  readonly state: PullRequestState;
  readonly isDraft: boolean;
} {
  const normalized = status?.trim().toLowerCase();
  if (normalized === "draft") return { state: "open", isDraft: true };
  return { state: originPullRequestState(normalized), isDraft: false };
}

export function originMergeability(raw: unknown): PullRequestMergeability {
  const record = asRecord(raw);
  if (record === null) return "unknown";
  if (asBoolean(record.hasMergeConflicts) === true) return "conflicting";
  if (asBoolean(record.mergeable) === true) return "mergeable";
  const nested = asRecord(record.mergeability);
  const verdict = asString(nested?.verdict)?.toLowerCase();
  if (verdict === "ready" || verdict === "mergeable") return "mergeable";
  if (verdict === "conflict" || verdict === "conflicting") return "conflicting";
  return "unknown";
}

export function originCheckStatus(input: {
  readonly status?: string | null;
  readonly conclusion?: string | null;
}): PullRequestCheckStatus {
  const status = input.status?.trim().toLowerCase();
  const conclusion = input.conclusion?.trim().toLowerCase();
  if (status && status !== "completed" && status !== "complete") {
    return "pending";
  }
  switch (conclusion) {
    case "success":
    case "passed":
      return "success";
    case "failure":
    case "failed":
    case "timed_out":
    case "action_required":
      return "failure";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "skipped":
      return "skipped";
    case "neutral":
      return "neutral";
    default:
      return status === "completed" || status === "complete" ? "neutral" : "pending";
  }
}

export function originChecksState(
  checks: ReadonlyArray<PullRequestCheck>,
): PullRequestChecksState | null {
  if (checks.length === 0) return null;
  if (checks.some((check) => check.status === "failure")) return "failing";
  if (checks.some((check) => check.status === "pending")) return "pending";
  if (checks.some((check) => check.status === "success")) return "passing";
  return null;
}

export function originChecks(raw: unknown): ReadonlyArray<PullRequestCheck> {
  const record = asRecord(raw);
  const groups = Array.isArray(record?.checkRunGroups)
    ? record.checkRunGroups
    : Array.isArray(raw)
      ? raw
      : [];
  const checks: PullRequestCheck[] = [];
  for (const group of groups) {
    const groupRecord = asRecord(group);
    const runs = Array.isArray(groupRecord?.checkRuns) ? groupRecord.checkRuns : [];
    for (const run of runs) {
      const runRecord = asRecord(run);
      if (runRecord === null) continue;
      const name = asString(runRecord.name);
      if (!name) continue;
      checks.push({
        name,
        status: originCheckStatus({
          status: asString(runRecord.status),
          conclusion: asString(runRecord.conclusion),
        }),
        description: asString(asRecord(runRecord.output)?.title) ?? asString(runRecord.description),
        url: asString(runRecord.detailsUrl),
      });
    }
  }
  return checks;
}

function originAuthor(raw: Record<string, unknown>): PullRequestActor | null {
  const authorId = asString(raw.authorId);
  const author = asRecord(raw.author);
  const user = asRecord(author?.user) ?? author;
  return originActor({
    login: asString(user?.email) ?? asString(user?.displayName) ?? asString(user?.id) ?? authorId,
    name: asString(user?.displayName) ?? asString(user?.email),
  });
}

function assignmentLogins(raw: unknown): ReadonlyArray<string> {
  if (!Array.isArray(raw)) return [];
  const logins: string[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    const login =
      asString(record?.email) ??
      asString(record?.login) ??
      asString(record?.displayName) ??
      asString(record?.id) ??
      asString(asRecord(record?.user)?.email);
    if (login) logins.push(login);
  }
  return logins;
}

export interface OriginListItem extends ProviderChangeRequest {
  readonly updatedAtMs: number;
}

export function toOriginListItem(raw: unknown): OriginListItem | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const number = asNumber(record.number);
  const title = asString(record.title);
  if (number === null || number <= 0 || !Number.isInteger(number) || title === null) {
    return null;
  }
  const repo = asRecord(record.repo);
  const { state, isDraft } = originStateAndDraft(asString(record.status) ?? asString(record.state));
  const updatedAt = asIso(record.updatedAt) ?? asIso(record.createdAt) ?? FALLBACK_ISO;
  const checks = originChecks(record.ciState ?? record.mergeability);
  return {
    number,
    title,
    url: originPullRequestUrl({
      url: asString(record.url),
      number,
      org: asString(repo?.org),
      name: asString(repo?.name),
    }),
    author: originAuthor(record),
    headBranch: asString(record.headRef) ?? asString(asRecord(record.head)?.ref) ?? "",
    baseBranch: asString(record.baseRef) ?? asString(asRecord(record.base)?.ref) ?? "main",
    state: asBoolean(record.merged) === true ? "merged" : state,
    isDraft: asBoolean(record.draft) ?? isDraft,
    mergeability: originMergeability(record.mergeability ?? record),
    additions: Math.max(0, asNumber(record.additions) ?? 0),
    deletions: Math.max(0, asNumber(record.deletions) ?? 0),
    createdAt: asIso(record.createdAt) ?? updatedAt,
    updatedAt,
    reviewRequestLogins: assignmentLogins(record.assignments),
    labels: [],
    checksState: originChecksState(checks),
    updatedAtMs: Date.parse(updatedAt),
  };
}

export function toOriginDetail(raw: unknown): ProviderChangeRequestDetail | null {
  const item = toOriginListItem(raw);
  const record = asRecord(raw);
  if (item === null || record === null) return null;
  const checks = originChecks(record.ciState ?? record.mergeability);
  return {
    ...item,
    body:
      typeof record.description === "string" ? record.description : (asString(record.body) ?? ""),
    changedFiles: Math.max(0, asNumber(record.changedFiles) ?? 0),
    mergedAt: asIso(record.mergedAt),
    closedAt: asIso(record.closedAt),
    reviewers: assignmentLogins(record.assignments).map((login) => ({
      login,
      name: null,
      avatarUrl: null,
    })),
    checks,
    mergeCapabilities: { merge: true, squash: true, rebase: false },
    viewerPermissions: {
      actions: [
        "merge",
        "ready",
        "draft",
        "close",
        "reopen",
        "enable-auto-merge",
        "disable-auto-merge",
      ],
      comment: true,
      resolve: true,
      verdicts: ["comment", "approve"],
      requestReviewers: false,
    },
    autoMergeEnabled: asBoolean(record.autoMergeEnabled) ?? false,
  };
}

function commentFromUnknown(
  raw: unknown,
  kind: PullRequestComment["kind"],
): PullRequestComment | null {
  const record = asRecord(raw);
  if (record === null) return null;
  const id = asString(record.id);
  const body = typeof record.body === "string" ? record.body : asString(record.body);
  if (id === null || body === null) return null;
  return {
    id,
    kind,
    author: originActor({
      login:
        asString(record.authorId) ??
        asString(asRecord(record.author)?.email) ??
        asString(asRecord(record.author)?.displayName) ??
        asString(asRecord(record.author)?.id),
      name: asString(asRecord(record.author)?.displayName),
    }),
    body,
    createdAt: asIso(record.createdAt) ?? FALLBACK_ISO,
    url: asString(record.url),
    path: asString(record.path),
    reviewState: asString(record.verdict) ?? asString(record.state),
  };
}

export function originComments(raw: unknown): ReadonlyArray<PullRequestComment> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const comment = commentFromUnknown(entry, "issue-comment");
    return comment ? [comment] : [];
  });
}

export function originReviews(raw: unknown): ReadonlyArray<PullRequestComment> {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const comment = commentFromUnknown(entry, "review");
    return comment ? [comment] : [];
  });
}

export function originThreads(raw: unknown): ReadonlyArray<PullRequestReviewThread> {
  if (!Array.isArray(raw)) return [];
  const threads: PullRequestReviewThread[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (record === null) continue;
    const id = asString(record.id);
    const path = asString(record.path);
    if (id === null || path === null) continue;
    const sideRaw = asString(record.side)?.toLowerCase();
    const comments = Array.isArray(record.comments)
      ? record.comments.flatMap((comment) => {
          const parsed = commentFromUnknown(comment, "review-comment");
          return parsed
            ? [
                {
                  id: parsed.id,
                  author: parsed.author,
                  body: parsed.body,
                  createdAt: parsed.createdAt,
                  url: parsed.url,
                },
              ]
            : [];
        })
      : [];
    threads.push({
      id,
      path,
      line: (() => {
        const line = asNumber(record.endLine) ?? asNumber(record.startLine);
        return line !== null && line > 0 ? line : null;
      })(),
      side: sideRaw === "left" ? "left" : "right",
      isResolved: asBoolean(record.resolved) === true,
      isOutdated: false,
      comments,
      commentCount: Math.max(comments.length, asNumber(record.commentCount) ?? comments.length),
    });
  }
  return threads;
}

export function originCommits(raw: unknown): ReadonlyArray<PullRequestCommit> {
  if (!Array.isArray(raw)) return [];
  const commits: PullRequestCommit[] = [];
  for (const entry of raw) {
    const record = asRecord(entry);
    if (record === null) continue;
    const oid = asString(record.sha) ?? asString(record.oid);
    if (oid === null) continue;
    const message = asString(record.message) ?? "";
    const author = asRecord(record.author);
    commits.push({
      oid,
      messageHeadline: message.split("\n")[0] ?? "",
      committedDate:
        asIso(asRecord(record.committer)?.timestamp) ?? asIso(author?.timestamp) ?? FALLBACK_ISO,
      authors: originActor({
        login: asString(author?.email) ?? asString(author?.name),
        name: asString(author?.name),
      })
        ? [
            originActor({
              login: asString(author?.email) ?? asString(author?.name),
              name: asString(author?.name),
            })!,
          ]
        : [],
    });
  }
  return commits;
}

const decodeUnknownArray = decodeJsonResult(Schema.Array(Schema.Unknown));
const decodeUnknownObject = decodeJsonResult(UnknownRecord);

export function decodeOriginListJson(
  raw: string,
): Result.Result<ReadonlyArray<OriginListItem>, Cause.Cause<Schema.SchemaError>> {
  const result = decodeUnknownArray(raw);
  if (Result.isFailure(result)) return Result.fail(result.failure);
  return Result.succeed(
    result.success.flatMap((entry) => {
      const item = toOriginListItem(entry);
      return item ? [item] : [];
    }),
  );
}

export function decodeOriginViewJson(
  raw: string,
): Result.Result<Record<string, unknown>, Cause.Cause<Schema.SchemaError>> {
  const result = decodeUnknownObject(raw);
  if (Result.isFailure(result)) return Result.fail(result.failure);
  return Result.succeed(result.success);
}
