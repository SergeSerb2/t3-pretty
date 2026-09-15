import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const IssueProvider = Schema.Literals(["linear", "sentry"]);
export type IssueProvider = typeof IssueProvider.Type;
const Id = TrimmedNonEmptyString.check(Schema.isMaxLength(256));
const Title = TrimmedNonEmptyString.check(Schema.isMaxLength(512));
const Description = Schema.String.check(Schema.isMaxLength(100_000));
export const IssueConnectionInput = Schema.Union([
  Schema.Struct({
    provider: Schema.Literal("linear"),
    token: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
  }),
  Schema.Struct({
    provider: Schema.Literal("sentry"),
    token: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
    organization: Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,99}$/)),
    region: Schema.Literals(["us", "de"]),
  }),
]);
export type IssueConnectionInput = typeof IssueConnectionInput.Type;
export const IssueConnection = Schema.Struct({
  provider: IssueProvider,
  account: Schema.String,
});
export type IssueConnection = typeof IssueConnection.Type;
export const IssueOption = Schema.Struct({ id: Schema.String, name: Schema.String });
export const IssueMetadata = Schema.Struct({
  scopes: Schema.Array(IssueOption),
  states: Schema.Array(IssueOption),
  assignees: Schema.Array(IssueOption),
});
export type IssueMetadata = typeof IssueMetadata.Type;
export const Issue = Schema.Struct({
  provider: IssueProvider,
  id: Id,
  identifier: Schema.String,
  title: Schema.String,
  description: Schema.String,
  url: Schema.String,
  scope: IssueOption,
  state: IssueOption,
  assignee: Schema.NullOr(IssueOption),
  priority: Schema.String,
  updatedAt: Schema.String,
  /** Loaded on demand when opening an issue. */
  details: Schema.optionalKey(Schema.String),
});
export type Issue = typeof Issue.Type;
export const IssueListInput = Schema.Struct({
  provider: IssueProvider,
  scopeId: Schema.optional(Id),
  query: Schema.String.check(Schema.isMaxLength(1000)),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
});
export type IssueListInput = typeof IssueListInput.Type;
export const IssueListResult = Schema.Struct({
  issues: Schema.Array(Issue),
  nextCursor: Schema.NullOr(Schema.String),
});
export type IssueListResult = typeof IssueListResult.Type;
export const IssueRef = Schema.Struct({ provider: IssueProvider, id: Id });
export type IssueRef = typeof IssueRef.Type;
const LinearFields = {
  title: Schema.optional(Title),
  description: Schema.optional(Description),
  stateId: Schema.optional(Id),
  assigneeId: Schema.optional(Schema.NullOr(Id)),
  priority: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4 }))),
};
export const IssueCreateInput = Schema.Struct({
  ...LinearFields,
  teamId: Id,
  title: Title,
});
export type IssueCreateInput = typeof IssueCreateInput.Type;
export const IssueUpdateInput = Schema.Union([
  Schema.Struct({ provider: Schema.Literal("linear"), id: Id, ...LinearFields }),
  Schema.Struct({
    provider: Schema.Literal("sentry"),
    id: Id,
    status: Schema.optional(Schema.Literals(["resolved", "unresolved", "ignored"])),
    assignedTo: Schema.optional(Schema.NullOr(Id)),
    priority: Schema.optional(Schema.Literals(["low", "medium", "high"])),
  }),
]);
export type IssueUpdateInput = typeof IssueUpdateInput.Type;
export const IssueCommentInput = Schema.Struct({
  id: Id,
  body: TrimmedNonEmptyString.check(Schema.isMaxLength(100_000)),
});
export type IssueCommentInput = typeof IssueCommentInput.Type;
export class IssuesError extends Schema.TaggedError<IssuesError>()("IssuesError", {
  message: Schema.String,
}) {}
