import { assert, it } from "@effect/vitest";
import { NodeHttpServer } from "@effect/platform-node";
import {
  AutomationId,
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  type AutomationShell,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import { HttpBody, HttpClient, HttpRouter, HttpServer } from "effect/unstable/http";

import { OrchestrationCommandInvariantError } from "../orchestration/Errors.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as AutomationWebhookHttp from "./AutomationWebhookHttp.ts";

const NOW = "2026-09-06T09:00:00.000Z";
const AUTOMATION_ID = AutomationId.make("auto-1");
const TOKEN = "dG9rZW4tdG9rZW4tdG9rZW4tdG9rZW4tdG9rZW4tMTIzNDU";
const PATH = `/hooks/automations/${AUTOMATION_ID}/${TOKEN}`;

const testCrypto = Crypto.make({
  randomBytes: (size) => new Uint8Array(size).fill(7),
  digest: (_algorithm, data) => Effect.succeed(data),
});

function makeAutomation(overrides: Partial<AutomationShell> = {}): AutomationShell {
  return {
    id: AUTOMATION_ID,
    projectId: ProjectId.make("project-1"),
    name: "Deploy check",
    prompt: "Check the deploy",
    enabled: true,
    triggers: [{ type: "webhook" }],
    modelSelection: null,
    runtimeMode: "full-access",
    workspace: "checkout",
    createPullRequest: false,
    includeLastRunSummary: false,
    catchUpMissedRuns: true,
    minIntervalSeconds: 60,
    timeoutMinutes: 120,
    webhookToken: TOKEN,
    sourceThreadId: null,
    createdAt: NOW,
    updatedAt: NOW,
    nextRunAt: null,
    activeRun: null,
    lastRun: null,
    lastRequestedAt: null,
    pendingTrigger: null,
    consecutiveFailures: 0,
    runCount: 0,
    webhookPath: `/hooks/automations/${AUTOMATION_ID}/${TOKEN}`,
    ...overrides,
  };
}

const makeHarness = Effect.fn("makeWebhookHarness")(function* (options: {
  readonly automation: AutomationShell | null;
  readonly automationsEnabled?: boolean;
  readonly rejectWith?: string;
}) {
  const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getAutomationShellById: () => Effect.succeed(Option.fromNullishOr(options.automation)),
    }),
    Layer.mock(OrchestrationEngineService)({
      dispatch: (command) =>
        Ref.update(commands, (recorded) => [...recorded, command]).pipe(
          Effect.andThen(
            options.rejectWith === undefined
              ? Effect.succeed({ sequence: 1 })
              : Effect.fail(
                  new OrchestrationCommandInvariantError({
                    commandType: command.type,
                    detail: options.rejectWith,
                  }),
                ),
          ),
        ),
    }),
    Layer.mock(ServerSettingsService)({
      getSettings: Effect.succeed({
        ...DEFAULT_SERVER_SETTINGS,
        automations: {
          ...DEFAULT_SERVER_SETTINGS.automations,
          enabled: options.automationsEnabled ?? true,
        },
      }),
    }),
    Layer.succeed(Crypto.Crypto, testCrypto),
  );
  yield* HttpRouter.serve(AutomationWebhookHttp.layer, {
    disableListenLog: true,
    disableLogger: true,
  }).pipe(Layer.provide(dependencies), Layer.build);
  const client = yield* HttpClient.HttpClient;
  const post = (path: string, body: string, headers: Record<string, string> = {}) =>
    client.post(path, { headers, body: HttpBody.text(body, "application/json") });
  return { commands, post };
});

const withServer = <A, E>(
  effect: Effect.Effect<A, E, HttpClient.HttpClient | HttpServer.HttpServer | Scope.Scope>,
) => Effect.scoped(effect).pipe(Effect.provide(NodeHttpServer.layerTest));

it.effect("answers 404 for an unknown automation and for a token mismatch alike", () =>
  withServer(
    Effect.gen(function* () {
      const missing = yield* makeHarness({ automation: null });
      assert.strictEqual((yield* missing.post(PATH, "{}")).status, 404);
      const mismatch = yield* makeHarness({ automation: makeAutomation() });
      assert.strictEqual(
        (yield* mismatch.post(`/hooks/automations/${AUTOMATION_ID}/wrong-token`, "{}")).status,
        404,
      );
      assert.deepStrictEqual(yield* Ref.get(mismatch.commands), []);
    }),
  ),
);

it.effect("acknowledges GitHub's ping without opening a run", () =>
  withServer(
    Effect.gen(function* () {
      const harness = yield* makeHarness({ automation: makeAutomation() });
      const response = yield* harness.post(PATH, '{"zen":"hi"}', { "x-github-event": "ping" });
      assert.strictEqual(response.status, 200);
      assert.deepStrictEqual(yield* Ref.get(harness.commands), []);
    }),
  ),
);

it.effect("accepts a delivery, stores the payload, then rate-limits the next one", () =>
  withServer(
    Effect.gen(function* () {
      const harness = yield* makeHarness({ automation: makeAutomation() });
      const accepted = yield* harness.post(PATH, '{"ref":"refs/heads/main"}', {
        "x-github-delivery": "delivery-1",
      });
      assert.strictEqual(accepted.status, 202);
      const body = yield* accepted.json;
      assert.ok(typeof body === "object" && body !== null && "runId" in body);
      const commands = yield* Ref.get(harness.commands);
      assert.strictEqual(commands.length, 1);
      const command = commands[0]!;
      assert.strictEqual(command.type, "automation.run.request");
      if (command.type !== "automation.run.request") return;
      assert.deepStrictEqual(command.trigger, {
        type: "webhook",
        deliveryId: "delivery-1",
        payload: '{"ref":"refs/heads/main"}',
      });

      const limited = yield* harness.post(PATH, "{}");
      assert.strictEqual(limited.status, 429);
      assert.strictEqual((yield* Ref.get(harness.commands)).length, 1);
    }),
  ),
);

it.effect("answers 409 while the automation or the environment is paused", () =>
  withServer(
    Effect.gen(function* () {
      const paused = yield* makeHarness({ automation: makeAutomation({ enabled: false }) });
      assert.strictEqual((yield* paused.post(PATH, "{}")).status, 409);
      const environment = yield* makeHarness({
        automation: makeAutomation(),
        automationsEnabled: false,
      });
      assert.strictEqual((yield* environment.post(PATH, "{}")).status, 409);
      assert.deepStrictEqual(yield* Ref.get(environment.commands), []);
    }),
  ),
);

it.effect("relays a decider rejection as 409 with its reason", () =>
  withServer(
    Effect.gen(function* () {
      const harness = yield* makeHarness({
        automation: makeAutomation(),
        rejectWith: "Debounced: a run was requested less than 60s ago.",
      });
      const response = yield* harness.post(PATH, "{}");
      assert.strictEqual(response.status, 409);
      assert.deepStrictEqual(yield* response.json, {
        reason: "Debounced: a run was requested less than 60s ago.",
      });
    }),
  ),
);

it.effect("rejects oversized and malformed bodies", () =>
  withServer(
    Effect.gen(function* () {
      const harness = yield* makeHarness({ automation: makeAutomation() });
      const oversized = `{"pad":"${"x".repeat(AutomationWebhookHttp.AUTOMATION_WEBHOOK_MAX_BODY_BYTES)}"}`;
      assert.strictEqual((yield* harness.post(PATH, oversized)).status, 413);
      assert.strictEqual((yield* harness.post(PATH, "not json")).status, 400);
      assert.deepStrictEqual(yield* Ref.get(harness.commands), []);
    }),
  ),
);
