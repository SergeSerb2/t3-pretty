import type { RelayAgentActivityState } from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as RelayDb from "../db.ts";
import { relayAgentActivityRows } from "../persistence/schema.ts";
import * as AgentActivityRows from "./AgentActivityRows.ts";

const state: RelayAgentActivityState = {
  environmentId: "env-1" as RelayAgentActivityState["environmentId"],
  threadId: "thread-1" as RelayAgentActivityState["threadId"],
  projectTitle: "Project",
  threadTitle: "Thread",
  modelTitle: "gpt-5.4",
  phase: "running",
  headline: "Running",
  updatedAt: "2026-06-20T00:00:00.000Z",
  deepLink: "/threads/env-1/thread-1",
};

describe("AgentActivityRows", () => {
  it.effect("prunes terminal and long-abandoned activity rows in one sweep", () => {
    let whereClause: SQL | null = null;
    const fakeDb = {
      delete: (table: unknown) => ({
        where: (clause: SQL) => {
          expect(table).toBe(relayAgentActivityRows);
          whereClause = clause;
          return Effect.void;
        },
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const rows = yield* AgentActivityRows.AgentActivityRows;
      yield* rows.pruneTerminal({
        updatedBefore: "2026-05-25T23:30:00.000Z",
        staleUpdatedBefore: "2026-04-26T00:00:00.000Z",
      });

      expect(whereClause).not.toBeNull();
      const query = new PgDialect().sqlToQuery(whereClause!);
      expect(query.sql).toContain(" or ");
      expect(query.sql).toContain("state_json");
      expect(query.params).toEqual(["2026-05-25T23:30:00.000Z", "2026-04-26T00:00:00.000Z"]);
    }).pipe(
      Effect.provide(
        AgentActivityRows.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("preserves activity context on persistence failures", () => {
    const cause = new Error("database unavailable");
    const failingDb = {
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => Effect.fail(cause),
        }),
      }),
      delete: () => ({
        where: () => Effect.fail(cause),
      }),
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              orderBy: () => ({ limit: () => Effect.fail(cause) }),
            }),
          }),
        }),
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const rows = yield* AgentActivityRows.AgentActivityRows;

      const upsertError = yield* rows
        .upsert({ environmentPublicKey: "public-key", state })
        .pipe(Effect.flip);
      expect(upsertError).toMatchObject({
        environmentId: "env-1",
        threadId: "thread-1",
        cause,
      });
      expect(upsertError.message).toBe(
        "Failed to persist agent activity state for environment env-1, thread thread-1.",
      );

      const deleteError = yield* rows
        .remove({
          environmentId: "env-1",
          environmentPublicKey: "public-key",
          threadId: "thread-1",
        })
        .pipe(Effect.flip);
      expect(deleteError).toMatchObject({
        environmentId: "env-1",
        threadId: "thread-1",
        cause,
      });
      expect(deleteError.message).toBe(
        "Failed to delete agent activity state for environment env-1, thread thread-1.",
      );

      const listError = yield* rows.listForUser({ userId: "user-2" }).pipe(Effect.flip);
      expect(listError).toMatchObject({ userId: "user-2", cause });
      expect(listError.message).toBe("Failed to list agent activity state for user user-2.");

      const getError = yield* rows
        .getForUserThread({
          userId: "user-2",
          environmentId: "env-1",
          threadId: "thread-1",
        })
        .pipe(Effect.flip);
      expect(getError).toMatchObject({ userId: "user-2", cause });
    }).pipe(
      Effect.provide(
        AgentActivityRows.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, failingDb))),
      ),
    );
  });
});
