import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { IssueUpdateInput } from "@t3tools/contracts";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { sentryNextCursor } from "./IssueApi.ts";
import * as Issues from "./IssuesService.ts";

const linearIssue = {
  id: "issue-1",
  identifier: "ENG-1",
  title: "Fix login",
  description: "Steps to reproduce",
  url: "https://linear.app/acme/issue/ENG-1",
  team: { id: "team-1", name: "Engineering" },
  state: { id: "state-1", name: "Todo" },
  assignee: null,
  priority: 2,
  updatedAt: "2026-09-15T00:00:00Z",
};
const sentryIssue = {
  id: "123",
  shortId: "WEB-1",
  title: "TypeError",
  culprit: "login.ts",
  permalink: "https://acme.sentry.io/issues/123/",
  project: { id: "project-1", name: "Web" },
  status: "unresolved",
  assignedTo: { id: "user-1", name: "Serge", type: "user" },
  priority: "high",
  lastSeen: "2026-09-15T00:00:00Z",
  count: "7",
  userCount: 3,
};
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const Json = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      query: Schema.optional(Schema.String),
      variables: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      status: Schema.optional(Schema.String),
      substatus: Schema.optional(Schema.String),
      assignedTo: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
);

function fixture() {
  const secrets = new Map<string, Uint8Array>();
  const requests: Array<{
    method: string;
    url: URL;
    body: ReturnType<typeof Json>;
    authorization: string | undefined;
  }> = [];
  let status = 200;
  let graphQLError = false;
  let mutationSuccess = true;
  let paginateMembers = false;
  const client = HttpClient.make((request, url) => {
    const body =
      request.body._tag === "Uint8Array" ? Json(new TextDecoder().decode(request.body.body)) : {};
    requests.push({
      method: request.method,
      url,
      body,
      authorization: request.headers.authorization,
    });
    let payload: unknown;
    let link: string | undefined;
    if (url.host === "api.linear.app") {
      if (graphQLError)
        payload = {
          data: { viewer: { name: "Partial result" } },
          errors: [{ message: "credential-secret-value" }],
        };
      else if (body.query?.includes("viewer"))
        payload = { data: { viewer: { name: "Serge" }, organization: { name: "Acme" } } };
      else if (body.query?.includes("issueCreate"))
        payload = {
          data: {
            issueCreate: { success: mutationSuccess, issue: mutationSuccess ? linearIssue : null },
          },
        };
      else if (body.query?.includes("issueUpdate"))
        payload = {
          data: {
            issueUpdate: {
              success: mutationSuccess,
              issue: mutationSuccess ? { ...linearIssue, assignee: null } : null,
            },
          },
        };
      else if (body.query?.includes("commentCreate"))
        payload = { data: { commentCreate: { success: mutationSuccess } } };
      else if (body.query?.includes("issues("))
        payload = {
          data: {
            issues: {
              nodes: [linearIssue],
              pageInfo: { hasNextPage: true, endCursor: "linear-next" },
            },
          },
        };
      else if (body.query?.includes("issue(id"))
        payload = {
          data: {
            issue: {
              ...linearIssue,
              comments: { nodes: [{ body: "Investigating", user: { name: "Serge" } }] },
            },
          },
        };
      else if (body.query?.includes("teams("))
        payload = {
          data: {
            teams: { nodes: [linearIssue.team], pageInfo: { hasNextPage: false, endCursor: null } },
          },
        };
      else
        payload = {
          data: {
            team: {
              states: {
                nodes: [linearIssue.state],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
              members: {
                nodes: body.variables?.membersAfter
                  ? [{ id: "user-2", name: "Alex" }]
                  : [{ id: "user-1", name: "Serge" }],
                pageInfo: {
                  hasNextPage: paginateMembers && !body.variables?.membersAfter,
                  endCursor: "members-next",
                },
              },
            },
          },
        };
    } else if (url.pathname.endsWith("/events/latest/"))
      payload = {
        entries: [
          {
            type: "exception",
            data: {
              values: [
                {
                  type: "TypeError",
                  value: "Failed to fetch",
                  stacktrace: { frames: [{ filename: "login.ts", function: "login", lineNo: 42 }] },
                },
              ],
            },
          },
        ],
      };
    else if (url.pathname.endsWith("/issues/")) {
      payload = [sentryIssue];
      link = '<https://attacker.invalid/ignored>; rel="next"; results="true"; cursor="next-page"';
    } else if (url.pathname.endsWith("/issues/123/"))
      payload = { ...sentryIssue, ...(body.status ? { status: body.status } : {}) };
    else if (url.pathname.endsWith("/projects/")) payload = [sentryIssue.project];
    else payload = { name: "Acme" };
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(encodeJson(payload), {
          status,
          headers: { "content-type": "application/json", ...(link ? { link } : {}) },
        }),
      ),
    );
  });
  const secretStore = Layer.succeed(
    ServerSecretStore,
    ServerSecretStore.of({
      get: (name) => Effect.sync(() => Option.fromNullishOr(secrets.get(name))),
      set: (name, value) => Effect.sync(() => void secrets.set(name, value)),
      remove: (name) => Effect.sync(() => void secrets.delete(name)),
      create: (name, value) => Effect.sync(() => void secrets.set(name, value)),
      getOrCreateRandom: () => Effect.succeed(new Uint8Array(32)),
    }),
  );
  return {
    requests,
    secrets,
    setStatus: (value: number) => {
      status = value;
    },
    setGraphQLError: () => {
      graphQLError = true;
    },
    paginateMembers: () => {
      paginateMembers = true;
    },
    failMutation: () => {
      mutationSuccess = false;
    },
    layer: Issues.layer.pipe(
      Layer.provide(secretStore),
      Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    ),
  };
}

it.effect(
  "verifies credentials before saving and never exposes a token in connection results",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const issues = yield* Issues.IssuesService;
      expect(yield* issues.connections).toEqual([]);
      expect(yield* issues.connect({ provider: "linear", token: "linear-secret" })).toEqual({
        provider: "linear",
        account: "Acme · Serge",
      });
      expect(encodeJson(yield* issues.connections)).not.toContain("linear-secret");
      expect(f.requests[0]?.authorization).toBe("linear-secret");
      f.setStatus(401);
      const result = yield* issues
        .connect({ provider: "linear", token: "bad-secret" })
        .pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      expect(new TextDecoder().decode(f.secrets.get("native-issues-linear"))).toContain(
        "linear-secret",
      );
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect(
  "passes filters and cursors as GraphQL variables, then creates, updates and comments",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const issues = yield* Issues.IssuesService;
      yield* issues.connect({ provider: "linear", token: "linear-secret" });
      const page = yield* issues.list({
        provider: "linear",
        query: 'login" } mutation {',
        scopeId: "team-1",
        cursor: "previous",
      });
      expect((yield* issues.detail({ provider: "linear", id: "issue-1" })).details).toContain(
        "Serge\nInvestigating",
      );
      expect(page.nextCursor).toBe("linear-next");
      expect(page.issues[0]?.identifier).toBe("ENG-1");
      expect(
        f.requests.find((request) => request.body.query?.includes("issues("))?.body.variables,
      ).toMatchObject({
        after: "previous",
        filter: {
          team: { id: { eq: "team-1" } },
          title: { containsIgnoreCase: 'login" } mutation {' },
        },
      });
      expect((yield* issues.metadata("linear", "team-1")).assignees).toEqual([
        { id: "user-1", name: "Serge" },
      ]);
      expect(
        (yield* issues.create({
          teamId: "team-1",
          title: "Fix login",
          description: "Steps to reproduce",
        })).id,
      ).toBe("issue-1");
      yield* issues.update({
        provider: "linear",
        id: "issue-1",
        assigneeId: null,
        stateId: "state-2",
      });
      expect(f.requests.at(-1)?.body.variables).toEqual({
        id: "issue-1",
        input: { assigneeId: null, stateId: "state-2" },
      });
      yield* issues.comment({ id: "issue-1", body: "Investigating" });
      expect(f.requests.at(-1)?.body.variables).toEqual({
        input: { issueId: "issue-1", body: "Investigating" },
      });
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect("rejects GraphQL partial errors without returning upstream secrets", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const issues = yield* Issues.IssuesService;
    f.setGraphQLError();
    const result = yield* issues
      .connect({ provider: "linear", token: "secret" })
      .pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    expect(encodeJson(result)).not.toContain("credential-secret-value");
    expect(f.secrets.size).toBe(0);
  }).pipe(Effect.provide(f.layer));
});

it.effect("does not retry an unsuccessful mutation", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const issues = yield* Issues.IssuesService;
    yield* issues.connect({ provider: "linear", token: "secret" });
    f.failMutation();
    expect(
      (yield* issues.create({ teamId: "team-1", title: "Fix it" }).pipe(Effect.result))._tag,
    ).toBe("Failure");
    expect(
      f.requests.filter((request) => request.body.query?.includes("issueCreate")),
    ).toHaveLength(1);
  }).pipe(Effect.provide(f.layer));
});

it.effect(
  "uses the selected Sentry region, preserves queries and follows only pagination cursors",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const issues = yield* Issues.IssuesService;
      yield* issues.connect({
        provider: "sentry",
        token: "sentry-secret",
        organization: "acme",
        region: "de",
      });
      const page = yield* issues.list({
        provider: "sentry",
        query: "is:unresolved",
        scopeId: "project-1",
      });
      expect((yield* issues.detail({ provider: "sentry", id: "123" })).details).toContain(
        "login (login.ts:42)",
      );
      expect(page.nextCursor).toBe("next-page");
      expect(page.issues[0]?.description).toContain("7 events · 3 users");
      expect(f.requests.at(-1)?.url.pathname).toBe(
        "/api/0/organizations/acme/issues/123/events/latest/",
      );
      expect(page.issues[0]?.assignee?.id).toBe("user:user-1");
      yield* issues.update({
        provider: "sentry",
        id: "123",
        assignedTo: page.issues[0]!.assignee!.id,
      });
      expect(f.requests.at(-1)?.url.pathname).toBe("/api/0/organizations/acme/issues/123/");
      expect(f.requests.at(-1)?.body.assignedTo).toBe("user:user-1");
      yield* issues.list({ provider: "sentry", query: "", cursor: page.nextCursor! });
      expect(f.requests.at(-1)?.url.origin).toBe("https://de.sentry.io");
      expect(f.requests.at(-1)?.url.searchParams.get("cursor")).toBe("next-page");
      expect(f.requests.at(-1)?.authorization).toBe("Bearer sentry-secret");
      yield* issues.update({ provider: "sentry", id: "123", status: "ignored" });
      expect(f.requests.at(-1)?.body).toEqual({ status: "ignored", substatus: "archived_forever" });
      yield* issues.update({
        provider: "sentry",
        id: "123",
        status: "unresolved",
        assignedTo: null,
      });
      expect(f.requests.at(-1)?.body).toEqual({ status: "unresolved", assignedTo: null });
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect("disconnect removes credentials and prevents further upstream requests", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const issues = yield* Issues.IssuesService;
    yield* issues.connect({ provider: "linear", token: "secret" });
    yield* issues.disconnect("linear");
    expect(yield* issues.connections).toEqual([]);
    expect((yield* issues.list({ provider: "linear", query: "" }).pipe(Effect.result))._tag).toBe(
      "Failure",
    );
    expect(f.requests).toHaveLength(1);
  }).pipe(Effect.provide(f.layer));
});

it("rejects unsupported issue mutation values at the wire boundary", () => {
  const decode = Schema.decodeUnknownOption(IssueUpdateInput);
  expect(Option.isNone(decode({ provider: "sentry", id: "123", status: "delete" }))).toBe(true);
  expect(Option.isNone(decode({ provider: "linear", id: "1", priority: 5 }))).toBe(true);
  expect(sentryNextCursor('<x>; rel="next"; results="false"; cursor="end"')).toBeNull();
});

it.effect("loads later team members without duplicating completed state pages", () => {
  const f = fixture();
  f.paginateMembers();
  return Effect.gen(function* () {
    const issues = yield* Issues.IssuesService;
    yield* issues.connect({ provider: "linear", token: "secret" });
    const metadata = yield* issues.metadata("linear", "team-1");
    expect(metadata.states).toEqual([linearIssue.state]);
    expect(metadata.assignees.map((item) => item.id)).toEqual(["user-1", "user-2"]);
    expect(f.requests.at(-1)?.body.variables?.membersAfter).toBe("members-next");
  }).pipe(Effect.provide(f.layer));
});

it.effect("isolates malformed credentials and lets the disconnected provider reconnect", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const issues = yield* Issues.IssuesService;
    yield* issues.connect({
      provider: "sentry",
      token: "sentry-secret",
      organization: "acme",
      region: "us",
    });
    f.secrets.set("native-issues-linear", new TextEncoder().encode("{broken-json"));
    expect(yield* issues.connections).toEqual([{ provider: "sentry", account: "Acme" }]);
    const before = f.requests.length;
    expect((yield* issues.list({ provider: "linear", query: "" }).pipe(Effect.result))._tag).toBe(
      "Failure",
    );
    expect(f.requests).toHaveLength(before);
    expect((yield* issues.list({ provider: "sentry", query: "" })).issues).toHaveLength(1);
    yield* issues.connect({ provider: "linear", token: "replacement" });
    expect(yield* issues.connections).toHaveLength(2);
  }).pipe(Effect.provide(f.layer));
});
