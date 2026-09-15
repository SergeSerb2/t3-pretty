import {
  IssuesError,
  type Issue,
  type IssueConnectionInput,
  type IssueCreateInput,
  type IssueListInput,
  type IssueListResult,
  type IssueMetadata,
  type IssueUpdateInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

const IssueUrl = Schema.String.check(Schema.isPattern(/^https:\/\//));
const isIssuesError = Schema.is(IssuesError);
const Named = Schema.Struct({ id: Schema.String, name: Schema.String });
const PageInfo = Schema.Struct({
  hasNextPage: Schema.Boolean,
  endCursor: Schema.NullOr(Schema.String),
});
const LinearIssue = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  url: IssueUrl,
  team: Named,
  state: Named,
  assignee: Schema.NullOr(Named),
  priority: Schema.Finite,
  updatedAt: Schema.String,
});
const linearFields =
  "id identifier title description url team { id name } state { id name } assignee { id name } priority updatedAt";
const SentryIssue = Schema.Struct({
  id: Schema.String,
  shortId: Schema.String,
  title: Schema.String,
  culprit: Schema.String,
  permalink: IssueUrl,
  project: Named,
  status: Schema.String,
  assignedTo: Schema.NullOr(
    Schema.Struct({ id: Schema.String, name: Schema.String, type: Schema.String }),
  ),
  priority: Schema.optional(Schema.String),
  lastSeen: Schema.String,
  count: Schema.String,
  userCount: Schema.Finite,
});
const Exception = Schema.Struct({
  values: Schema.Array(
    Schema.Struct({
      type: Schema.optional(Schema.NullOr(Schema.String)),
      value: Schema.optional(Schema.NullOr(Schema.String)),
      stacktrace: Schema.optional(
        Schema.NullOr(
          Schema.Struct({
            frames: Schema.Array(
              Schema.Struct({
                filename: Schema.optional(Schema.NullOr(Schema.String)),
                function: Schema.optional(Schema.NullOr(Schema.String)),
                lineNo: Schema.optional(Schema.NullOr(Schema.Finite)),
              }),
            ),
          }),
        ),
      ),
    }),
  ),
});

const decodeException = Schema.decodeUnknownOption(Exception);

function eventDetails(entries: ReadonlyArray<{ type: string; data: unknown }>): string {
  return entries
    .filter((entry) => entry.type === "exception")
    .flatMap((entry) => {
      const decoded = decodeException(entry.data);
      if (Option.isNone(decoded)) return [];
      return decoded.value.values.map((value) =>
        [
          [value.type, value.value].filter(Boolean).join(": "),
          ...(value.stacktrace?.frames ?? [])
            .slice(-60)
            .map(
              (frame) =>
                `  ${frame.function ?? "<anonymous>"} (${frame.filename ?? "unknown"}${frame.lineNo == null ? "" : `:${frame.lineNo}`})`,
            ),
        ].join("\n"),
      );
    })
    .join("\n\n")
    .slice(0, 100_000);
}

const linearIssue = (issue: typeof LinearIssue.Type): Issue => ({
  provider: "linear",
  id: issue.id,
  identifier: issue.identifier,
  title: issue.title,
  description: issue.description ?? "",
  url: issue.url,
  scope: issue.team,
  state: issue.state,
  assignee: issue.assignee,
  priority: String(issue.priority),
  updatedAt: issue.updatedAt,
});
const sentryIssue = (issue: typeof SentryIssue.Type): Issue => ({
  provider: "sentry",
  id: issue.id,
  identifier: issue.shortId,
  title: issue.title,
  description: `${issue.culprit}\n\n${issue.count} events · ${issue.userCount} users`,
  url: issue.permalink,
  scope: issue.project,
  state: { id: issue.status, name: issue.status === "ignored" ? "Archived" : issue.status },
  assignee: issue.assignedTo
    ? { id: `${issue.assignedTo.type}:${issue.assignedTo.id}`, name: issue.assignedTo.name }
    : null,
  priority: issue.priority ?? "medium",
  updatedAt: issue.lastSeen,
});

/** Only the pagination cursor is reused. An upstream Link never becomes a request destination. */
export function sentryNextCursor(link: string | undefined): string | null {
  for (const part of link?.split(",") ?? []) {
    if (!/rel="next"/.test(part) || !/results="true"/.test(part)) continue;
    return /cursor="([^"]+)"/.exec(part)?.[1] ?? null;
  }
  return null;
}

export const makeIssueApi = (client: HttpClient.HttpClient) => {
  const request = Effect.fn("issues.request")(
    function* <S extends Schema.Codec<unknown, unknown, never, never>>(
      request: HttpClientRequest.HttpClientRequest,
      schema: S,
    ) {
      const response = yield* client.execute(request);
      if (response.status >= 300) {
        const message =
          response.status === 401 || response.status === 403
            ? "The service rejected this token or its permissions. Check the token and reconnect."
            : response.status === 429
              ? "The service rate limit was reached. Try again later."
              : response.status === 404
                ? "This issue or workspace could not be found."
                : `The issue service returned HTTP ${response.status}.`;
        return yield* new IssuesError({ message });
      }
      const json = yield* response.json;
      const data = yield* Schema.decodeUnknownEffect(schema)(json);
      return { data, headers: response.headers };
    },
    Effect.timeout(30_000),
    Effect.mapError((error) =>
      isIssuesError(error)
        ? error
        : new IssuesError({
            message: "Could not read the issue service response. Please try again.",
          }),
    ),
  );

  const graphql = Effect.fn("issues.linear")(function* <
    S extends Schema.Codec<unknown, unknown, never, never>,
  >(token: string, query: string, variables: unknown, schema: S) {
    const response = yield* request(
      HttpClientRequest.post("https://api.linear.app/graphql").pipe(
        HttpClientRequest.setHeader("Authorization", token),
        HttpClientRequest.bodyJsonUnsafe({ query, variables }),
      ),
      Schema.Struct({
        data: Schema.optional(Schema.Unknown),
        errors: Schema.optional(Schema.Array(Schema.Unknown)),
      }),
    );
    if (response.data.errors?.length)
      return yield* new IssuesError({
        message:
          "Linear could not complete this request. Check your permissions and the selected issue fields.",
      });
    return yield* Schema.decodeUnknownEffect(schema)(response.data.data).pipe(
      Effect.mapError(
        () => new IssuesError({ message: "Linear returned an unexpected response." }),
      ),
    );
  });
  const sentry = <S extends Schema.Codec<unknown, unknown, never, never>>(
    connection: Extract<IssueConnectionInput, { provider: "sentry" }>,
    path: string,
    schema: S,
    options?: { query?: Record<string, string>; body?: unknown },
  ) => {
    const host = connection.region === "de" ? "de.sentry.io" : "sentry.io";
    // Issue detail, update and event APIs are organization-scoped too:
    // https://docs.sentry.io/api/events/update-an-issue/
    const url = `https://${host}/api/0/organizations/${encodeURIComponent(connection.organization)}/${path}`;
    const base =
      options?.body === undefined
        ? HttpClientRequest.get(url)
        : HttpClientRequest.put(url).pipe(HttpClientRequest.bodyJsonUnsafe(options.body));
    return request(
      base.pipe(
        HttpClientRequest.setHeader("Authorization", `Bearer ${connection.token}`),
        HttpClientRequest.setUrlParams(options?.query ?? {}),
      ),
      schema,
    );
  };
  const verify = Effect.fn("issues.verify")(function* (connection: IssueConnectionInput) {
    if (connection.provider === "linear") {
      const data = yield* graphql(
        connection.token,
        "query { viewer { name } organization { name } }",
        {},
        Schema.Struct({
          viewer: Schema.Struct({ name: Schema.String }),
          organization: Schema.Struct({ name: Schema.String }),
        }),
      );
      return `${data.organization.name} · ${data.viewer.name}`;
    }
    const response = yield* sentry(connection, "", Schema.Struct({ name: Schema.String }));
    return response.data.name;
  });

  const metadata = Effect.fn("issues.metadata")(function* (
    connection: IssueConnectionInput,
    scopeId?: string,
  ): Effect.fn.Return<IssueMetadata, IssuesError> {
    if (connection.provider === "linear") {
      const scopes: Array<typeof Named.Type> = [];
      let cursor: string | null = null;
      do {
        const data: {
          readonly teams: {
            readonly nodes: ReadonlyArray<typeof Named.Type>;
            readonly pageInfo: typeof PageInfo.Type;
          };
        } = yield* graphql(
          connection.token,
          "query($after: String) { teams(first: 100, after: $after) { nodes { id name } pageInfo { hasNextPage endCursor } } }",
          { after: cursor },
          Schema.Struct({
            teams: Schema.Struct({ nodes: Schema.Array(Named), pageInfo: PageInfo }),
          }),
        );
        scopes.push(...data.teams.nodes);
        cursor = data.teams.pageInfo.hasNextPage ? data.teams.pageInfo.endCursor : null;
      } while (cursor);
      if (!scopeId) return { scopes, states: [], assignees: [] };
      const states: Array<typeof Named.Type> = [];
      const assignees: Array<typeof Named.Type> = [];
      let statesAfter: string | null = null;
      let membersAfter: string | null = null;
      let statesDone = false;
      let membersDone = false;
      do {
        const data: {
          readonly team: {
            readonly states: {
              readonly nodes: ReadonlyArray<typeof Named.Type>;
              readonly pageInfo: typeof PageInfo.Type;
            };
            readonly members: {
              readonly nodes: ReadonlyArray<typeof Named.Type>;
              readonly pageInfo: typeof PageInfo.Type;
            };
          };
        } = yield* graphql(
          connection.token,
          "query($id: String!, $statesAfter: String, $membersAfter: String) { team(id: $id) { states(first: 100, after: $statesAfter) { nodes { id name } pageInfo { hasNextPage endCursor } } members(first: 100, after: $membersAfter) { nodes { id name } pageInfo { hasNextPage endCursor } } } }",
          { id: scopeId, statesAfter, membersAfter },
          Schema.Struct({
            team: Schema.Struct({
              states: Schema.Struct({ nodes: Schema.Array(Named), pageInfo: PageInfo }),
              members: Schema.Struct({ nodes: Schema.Array(Named), pageInfo: PageInfo }),
            }),
          }),
        );
        if (!statesDone) states.push(...data.team.states.nodes);
        if (!membersDone) assignees.push(...data.team.members.nodes);
        statesAfter = data.team.states.pageInfo.endCursor;
        membersAfter = data.team.members.pageInfo.endCursor;
        statesDone ||= !data.team.states.pageInfo.hasNextPage || !statesAfter;
        membersDone ||= !data.team.members.pageInfo.hasNextPage || !membersAfter;
      } while (!statesDone || !membersDone);
      return { scopes, states, assignees };
    }
    const scopes: Array<typeof Named.Type> = [];
    let cursor: string | null = null;
    do {
      const response = yield* sentry(connection, "projects/", Schema.Array(Named), {
        query: { per_page: "100", ...(cursor ? { cursor } : {}) },
      });
      scopes.push(...response.data);
      cursor = sentryNextCursor(response.headers.link);
    } while (cursor);
    return {
      scopes,
      states: [
        { id: "unresolved", name: "Unresolved" },
        { id: "resolved", name: "Resolved" },
        { id: "ignored", name: "Archived" },
      ],
      assignees: [],
    };
  });

  const list = Effect.fn("issues.list")(function* (
    connection: IssueConnectionInput,
    input: IssueListInput,
  ): Effect.fn.Return<IssueListResult, IssuesError> {
    if (connection.provider === "linear") {
      const filter = {
        ...(input.scopeId ? { team: { id: { eq: input.scopeId } } } : {}),
        ...(input.query ? { title: { containsIgnoreCase: input.query } } : {}),
      };
      const data = yield* graphql(
        connection.token,
        `query($filter: IssueFilter, $after: String) { issues(first: 50, after: $after, filter: $filter, orderBy: updatedAt) { nodes { ${linearFields} } pageInfo { hasNextPage endCursor } } }`,
        { filter, after: input.cursor },
        Schema.Struct({
          issues: Schema.Struct({ nodes: Schema.Array(LinearIssue), pageInfo: PageInfo }),
        }),
      );
      return {
        issues: data.issues.nodes.map(linearIssue),
        nextCursor: data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null,
      };
    }
    const result = yield* sentry(connection, "issues/", Schema.Array(SentryIssue), {
      query: {
        query: input.query,
        limit: "50",
        sort: "date",
        shortIdLookup: "1",
        ...(input.scopeId ? { project: input.scopeId } : {}),
        ...(input.cursor ? { cursor: input.cursor } : {}),
      },
    });
    return {
      issues: result.data.map(sentryIssue),
      nextCursor: sentryNextCursor(result.headers.link),
    };
  });

  const detail = Effect.fn("issues.detail")(function* (
    connection: IssueConnectionInput,
    id: string,
  ) {
    if (connection.provider === "linear") {
      const data = yield* graphql(
        connection.token,
        `query($id: String!) { issue(id: $id) { ${linearFields} comments(last: 50) { nodes { body user { name } } } } }`,
        { id },
        Schema.Struct({
          issue: Schema.Struct({
            ...LinearIssue.fields,
            comments: Schema.Struct({
              nodes: Schema.Array(
                Schema.Struct({
                  body: Schema.String,
                  user: Schema.NullOr(Schema.Struct({ name: Schema.String })),
                }),
              ),
            }),
          }),
        }),
      );
      return {
        ...linearIssue(data.issue),
        details: data.issue.comments.nodes
          .map((comment) => `${comment.user?.name ?? "Former user"}\n${comment.body}`)
          .join("\n\n")
          .slice(0, 100_000),
      };
    }
    const result = yield* sentry(connection, `issues/${encodeURIComponent(id)}/`, SentryIssue);
    const event = yield* sentry(
      connection,
      `issues/${encodeURIComponent(id)}/events/latest/`,
      Schema.Struct({
        entries: Schema.Array(Schema.Struct({ type: Schema.String, data: Schema.Unknown })),
      }),
    ).pipe(Effect.result);
    return {
      ...sentryIssue(result.data),
      details:
        event._tag === "Success"
          ? eventDetails(event.success.data.entries)
          : "The latest event could not be loaded. Open this issue in Sentry for its event details.",
    };
  });
  const create = Effect.fn("issues.create")(function* (token: string, input: IssueCreateInput) {
    const data = yield* graphql(
      token,
      `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ${linearFields} } } }`,
      { input },
      Schema.Struct({
        issueCreate: Schema.Struct({ success: Schema.Boolean, issue: Schema.NullOr(LinearIssue) }),
      }),
    );
    if (!data.issueCreate.success || !data.issueCreate.issue)
      return yield* new IssuesError({ message: "Linear did not create the issue." });
    return linearIssue(data.issueCreate.issue);
  });
  const update = Effect.fn("issues.update")(function* (
    connection: IssueConnectionInput,
    input: IssueUpdateInput,
  ) {
    if (connection.provider === "linear" && input.provider === "linear") {
      const { provider: _provider, id, ...fields } = input;
      const data = yield* graphql(
        connection.token,
        `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success issue { ${linearFields} } } }`,
        { id, input: fields },
        Schema.Struct({
          issueUpdate: Schema.Struct({
            success: Schema.Boolean,
            issue: Schema.NullOr(LinearIssue),
          }),
        }),
      );
      if (!data.issueUpdate.success || !data.issueUpdate.issue)
        return yield* new IssuesError({ message: "Linear did not update the issue." });
      return linearIssue(data.issueUpdate.issue);
    }
    if (connection.provider !== "sentry" || input.provider !== "sentry")
      return yield* new IssuesError({ message: "The issue belongs to a different service." });
    const { provider: _provider, id, ...fields } = input;
    const result = yield* sentry(connection, `issues/${encodeURIComponent(id)}/`, SentryIssue, {
      body: {
        ...fields,
        ...(fields.status === "ignored" ? { substatus: "archived_forever" } : {}),
      },
    });
    return sentryIssue(result.data);
  });
  const comment = Effect.fn("issues.comment")(function* (token: string, id: string, body: string) {
    const data = yield* graphql(
      token,
      "mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }",
      { input: { issueId: id, body } },
      Schema.Struct({ commentCreate: Schema.Struct({ success: Schema.Boolean }) }),
    );
    if (!data.commentCreate.success)
      return yield* new IssuesError({ message: "Linear did not add the comment." });
  });
  return { verify, metadata, list, detail, create, update, comment };
};
