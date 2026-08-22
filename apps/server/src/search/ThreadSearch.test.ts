import {
  CheckpointRef,
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts";
import { ServerConfig } from "../config.ts";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionPipeline } from "../orchestration/Services/ProjectionPipeline.ts";
import { PER_TERM_POSTINGS_LIMIT, ThreadSearch, ThreadSearchLive } from "./ThreadSearch.ts";
import { rankedSearchTerms } from "./tokenizer.ts";

const makeTestLayer = (prefix: string) =>
  ThreadSearchLive.pipe(
    Layer.provideMerge(OrchestrationProjectionPipelineLive),
    Layer.provideMerge(OrchestrationEventStoreLive),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix })),
    Layer.provideMerge(SqlitePersistenceMemory),
    Layer.provideMerge(NodeServices.layer),
  );

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-01T00:00:01.000Z";

const appendProject = (projectId: string) =>
  Effect.gen(function* () {
    const eventStore = yield* OrchestrationEventStore;
    yield* eventStore.append({
      type: "project.created",
      eventId: EventId.make(`evt-project-${projectId}`),
      aggregateKind: "project",
      aggregateId: ProjectId.make(projectId),
      occurredAt: NOW,
      commandId: CommandId.make(`cmd-project-${projectId}`),
      causationEventId: null,
      correlationId: CommandId.make(`cmd-project-${projectId}`),
      metadata: {},
      payload: {
        projectId: ProjectId.make(projectId),
        title: `Project ${projectId}`,
        workspaceRoot: `/tmp/${projectId}`,
        defaultModelSelection: null,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
  });

const appendThread = (threadId: string, projectId: string) =>
  Effect.gen(function* () {
    const eventStore = yield* OrchestrationEventStore;
    yield* eventStore.append({
      type: "thread.created",
      eventId: EventId.make(`evt-thread-${threadId}`),
      aggregateKind: "thread",
      aggregateId: ThreadId.make(threadId),
      occurredAt: NOW,
      commandId: CommandId.make(`cmd-thread-${threadId}`),
      causationEventId: null,
      correlationId: CommandId.make(`cmd-thread-${threadId}`),
      metadata: {},
      payload: {
        threadId: ThreadId.make(threadId),
        projectId: ProjectId.make(projectId),
        title: `Thread ${threadId}`,
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5-codex",
        },
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
  });

const appendMessage = (input: {
  readonly eventId: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly turnId?: string;
  readonly streaming?: boolean;
  readonly createdAt?: string;
}) =>
  Effect.gen(function* () {
    const eventStore = yield* OrchestrationEventStore;
    yield* eventStore.append({
      type: "thread.message-sent",
      eventId: EventId.make(input.eventId),
      aggregateKind: "thread",
      aggregateId: ThreadId.make(input.threadId),
      occurredAt: input.createdAt ?? NOW,
      commandId: CommandId.make(`cmd-${input.eventId}`),
      causationEventId: null,
      correlationId: CommandId.make(`cmd-${input.eventId}`),
      metadata: {},
      payload: {
        threadId: ThreadId.make(input.threadId),
        messageId: MessageId.make(input.messageId),
        role: input.role,
        text: input.text,
        turnId: input.turnId !== undefined ? TurnId.make(input.turnId) : null,
        streaming: input.streaming ?? false,
        createdAt: input.createdAt ?? NOW,
        updatedAt: input.createdAt ?? NOW,
      },
    });
  });

const appendTurnDiffCompleted = (input: {
  readonly eventId: string;
  readonly threadId: string;
  readonly turnId: string;
  readonly checkpointTurnCount: number;
  readonly assistantMessageId?: string;
}) =>
  Effect.gen(function* () {
    const eventStore = yield* OrchestrationEventStore;
    yield* eventStore.append({
      type: "thread.turn-diff-completed",
      eventId: EventId.make(input.eventId),
      aggregateKind: "thread",
      aggregateId: ThreadId.make(input.threadId),
      occurredAt: LATER,
      commandId: CommandId.make(`cmd-${input.eventId}`),
      causationEventId: null,
      correlationId: CommandId.make(`cmd-${input.eventId}`),
      metadata: {},
      payload: {
        threadId: ThreadId.make(input.threadId),
        turnId: TurnId.make(input.turnId),
        checkpointTurnCount: input.checkpointTurnCount,
        checkpointRef: CheckpointRef.make(`checkpoint-${input.checkpointTurnCount}`),
        status: "ready",
        files: [],
        assistantMessageId:
          input.assistantMessageId !== undefined ? MessageId.make(input.assistantMessageId) : null,
        completedAt: LATER,
      },
    });
  });

const search = (query: string) =>
  Effect.gen(function* () {
    const threadSearch = yield* ThreadSearch;
    const terms = rankedSearchTerms(query);
    if (terms === null) {
      throw new Error(`test query produced no search terms: ${query}`);
    }
    return yield* threadSearch.searchThreads({ request: { query }, terms });
  });

it.layer(makeTestLayer("t3-thread-search-ranked-"))("ThreadSearch", (it) => {
  it.effect("ranks by BM25 and prefixes the final query token", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;

      yield* appendProject("project-1");
      yield* appendThread("thread-1", "project-1");
      yield* appendThread("thread-2", "project-1");
      yield* appendThread("thread-3", "project-1");
      yield* appendMessage({
        eventId: "evt-m1",
        threadId: "thread-1",
        messageId: "message-1",
        role: "user",
        text: "search search search bananas apples oranges",
      });
      yield* appendMessage({
        eventId: "evt-m2",
        threadId: "thread-2",
        messageId: "message-2",
        role: "user",
        text: "search bananas apples oranges kiwi",
      });
      yield* appendMessage({
        eventId: "evt-m3",
        threadId: "thread-3",
        messageId: "message-3",
        role: "user",
        text: "search search search search",
      });
      // Archived threads never match, however strong their message is.
      yield* Effect.gen(function* () {
        const eventStore = yield* OrchestrationEventStore;
        yield* eventStore.append({
          type: "thread.archived",
          eventId: EventId.make("evt-archive-thread-3"),
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-3"),
          occurredAt: LATER,
          commandId: CommandId.make("cmd-archive-thread-3"),
          causationEventId: null,
          correlationId: CommandId.make("cmd-archive-thread-3"),
          metadata: {},
          payload: {
            threadId: ThreadId.make("thread-3"),
            archivedAt: LATER,
            updatedAt: LATER,
          },
        });
      });

      yield* projectionPipeline.bootstrap;

      const result = yield* search("search");
      assert.equal(result.matches.length, 2);
      assert.strictEqual(result.matches[0]?.threadId, "thread-1");
      assert.strictEqual(result.matches[1]?.threadId, "thread-2");
      assert.isDefined(result.matches[0]?.score);
      assert.ok((result.matches[0]?.score ?? 0) > (result.matches[1]?.score ?? 0));
      assert.strictEqual(result.matches[0]?.source, "user");
      assert.ok(result.matches[0]?.snippet.includes("search"));

      // Typeahead: a partial final token still finds the documents.
      const prefixResult = yield* search("sear");
      assert.equal(prefixResult.matches.length, 2);
    }),
  );
});

it.layer(makeTestLayer("t3-thread-search-canonical-"))("ThreadSearch", (it) => {
  it.effect("indexes only canonical assistant messages", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;

      yield* appendProject("project-1");
      yield* appendThread("thread-1", "project-1");
      yield* appendMessage({
        eventId: "evt-m1",
        threadId: "thread-1",
        messageId: "message-1",
        role: "user",
        text: "keywordzebra from the user",
      });
      // Assistant commentary (no turn linkage) is not a canonical turn output.
      yield* appendMessage({
        eventId: "evt-m2",
        threadId: "thread-1",
        messageId: "message-2",
        role: "assistant",
        text: "keywordzebra from assistant commentary",
      });

      yield* projectionPipeline.bootstrap;

      const before = yield* search("keywordzebra");
      assert.equal(before.matches.length, 1);
      assert.strictEqual(before.matches[0]?.source, "user");

      // Once the assistant message closes a turn it becomes searchable; the
      // thread still returns one match (its shorter user message outranks).
      yield* appendMessage({
        eventId: "evt-m3",
        threadId: "thread-1",
        messageId: "message-3",
        role: "assistant",
        text: "keywordzebra from the final assistant output",
        turnId: "turn-1",
        createdAt: LATER,
      });
      yield* projectionPipeline.bootstrap;

      const after = yield* search("keywordzebra");
      assert.equal(after.matches.length, 1);
      assert.strictEqual(after.matches[0]?.source, "user");
    }),
  );
});

it.layer(makeTestLayer("t3-thread-search-revert-"))("ThreadSearch", (it) => {
  it.effect("drops reverted messages from the index", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;

      yield* appendProject("project-1");
      yield* appendThread("thread-1", "project-1");
      yield* appendMessage({
        eventId: "evt-m1",
        threadId: "thread-1",
        messageId: "message-1",
        role: "user",
        text: "alphazebra one",
        turnId: "turn-1",
      });
      yield* appendTurnDiffCompleted({
        eventId: "evt-d1",
        threadId: "thread-1",
        turnId: "turn-1",
        checkpointTurnCount: 1,
      });
      yield* appendMessage({
        eventId: "evt-m2",
        threadId: "thread-1",
        messageId: "message-2",
        role: "user",
        text: "betazebra two",
        turnId: "turn-2",
        createdAt: LATER,
      });
      yield* appendTurnDiffCompleted({
        eventId: "evt-d2",
        threadId: "thread-1",
        turnId: "turn-2",
        checkpointTurnCount: 2,
      });

      yield* projectionPipeline.bootstrap;
      assert.equal((yield* search("betazebra")).matches.length, 1);

      yield* Effect.gen(function* () {
        const eventStore = yield* OrchestrationEventStore;
        yield* eventStore.append({
          type: "thread.reverted",
          eventId: EventId.make("evt-revert-1"),
          aggregateKind: "thread",
          aggregateId: ThreadId.make("thread-1"),
          occurredAt: "2026-01-01T00:00:02.000Z",
          commandId: CommandId.make("cmd-revert-1"),
          causationEventId: null,
          correlationId: CommandId.make("cmd-revert-1"),
          metadata: {},
          payload: {
            threadId: ThreadId.make("thread-1"),
            turnCount: 1,
          },
        });
      });
      yield* projectionPipeline.bootstrap;

      assert.equal((yield* search("betazebra")).matches.length, 0);
      assert.equal((yield* search("alphazebra")).matches.length, 1);
    }),
  );
});

it.layer(makeTestLayer("t3-thread-search-edit-"))("ThreadSearch", (it) => {
  it.effect("replaces terms when a message is edited", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;

      yield* appendProject("project-1");
      yield* appendThread("thread-1", "project-1");
      yield* appendMessage({
        eventId: "evt-m1",
        threadId: "thread-1",
        messageId: "message-1",
        role: "user",
        text: "originalterm here",
      });

      yield* projectionPipeline.bootstrap;
      assert.equal((yield* search("originalterm")).matches.length, 1);

      yield* appendMessage({
        eventId: "evt-m2",
        threadId: "thread-1",
        messageId: "message-1",
        role: "user",
        text: "replacementterm here",
        createdAt: LATER,
      });
      yield* projectionPipeline.bootstrap;

      assert.equal((yield* search("originalterm")).matches.length, 0);
      const result = yield* search("replacementterm");
      assert.equal(result.matches.length, 1);
      assert.strictEqual(result.matches[0]?.snippet, "replacementterm here");
    }),
  );
});

it.layer(makeTestLayer("t3-thread-search-streaming-"))("ThreadSearch", (it) => {
  it.effect("indexes an assistant message only once its final event lands", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;

      yield* appendProject("project-1");
      yield* appendThread("thread-1", "project-1");
      yield* appendMessage({
        eventId: "evt-m1",
        threadId: "thread-1",
        messageId: "message-1",
        role: "assistant",
        text: "diffzebra final answer",
        turnId: "turn-1",
        streaming: true,
      });

      yield* projectionPipeline.bootstrap;
      assert.equal((yield* search("diffzebra")).matches.length, 0);

      yield* appendMessage({
        eventId: "evt-m2",
        threadId: "thread-1",
        messageId: "message-1",
        role: "assistant",
        text: "diffzebra final answer",
        turnId: "turn-1",
        createdAt: LATER,
      });
      yield* appendTurnDiffCompleted({
        eventId: "evt-d1",
        threadId: "thread-1",
        turnId: "turn-1",
        checkpointTurnCount: 1,
        assistantMessageId: "message-1",
      });
      yield* projectionPipeline.bootstrap;

      const result = yield* search("diffzebra");
      assert.equal(result.matches.length, 1);
      assert.strictEqual(result.matches[0]?.source, "assistant");
    }),
  );
});

it.layer(makeTestLayer("t3-thread-search-stopwords-"))("ThreadSearch", (it) => {
  it.effect("does not require stopwords as AND filters", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;

      yield* appendProject("project-1");
      yield* appendThread("thread-1", "project-1");
      yield* appendMessage({
        eventId: "evt-m1",
        threadId: "thread-1",
        messageId: "message-1",
        role: "user",
        text: "please fix the TypeError in login",
      });

      yield* projectionPipeline.bootstrap;

      const result = yield* search("fix the TypeError");
      assert.equal(result.matches.length, 1);
      assert.strictEqual(result.matches[0]?.threadId, "thread-1");
    }),
  );
});

it.layer(makeTestLayer("t3-thread-search-truncated-"))("ThreadSearch", (it) => {
  it.effect("does not AND truncated posting lists", () =>
    Effect.gen(function* () {
      const projectionPipeline = yield* OrchestrationProjectionPipeline;
      const sql = yield* SqlClient.SqlClient;

      yield* appendProject("project-1");
      yield* appendThread("thread-match", "project-1");
      yield* appendThread("thread-dummy", "project-1");
      yield* appendMessage({
        eventId: "evt-m1",
        threadId: "thread-match",
        messageId: "message-match",
        role: "user",
        text: "commonterm rarexyz",
      });
      yield* projectionPipeline.bootstrap;

      const dummyCount = PER_TERM_POSTINGS_LIMIT + 1;
      const dummyDocs = Array.from({ length: dummyCount }, (_, index) => ({
        message_id: `a${String(index).padStart(4, "0")}`,
        thread_id: "thread-dummy",
        role: "user",
        token_count: 1,
        created_at: NOW,
      }));
      const dummyPostings = dummyDocs.map((doc) => ({
        term: "commonterm",
        message_id: doc.message_id,
        tf: 1,
      }));

      for (let offset = 0; offset < dummyCount; offset += 100) {
        yield* sql`INSERT INTO search_index_docs ${sql.insert(dummyDocs.slice(offset, offset + 100))}`;
        yield* sql`INSERT INTO search_index_postings ${sql.insert(
          dummyPostings.slice(offset, offset + 100),
        )}`;
      }

      const result = yield* search("commonterm rarexyz");
      assert.equal(result.matches.length, 1);
      assert.strictEqual(result.matches[0]?.threadId, "thread-match");
    }),
  );
});
