import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import { describe, expect } from "vite-plus/test";

import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import * as TextGeneration from "./TextGeneration.ts";

const makeSnapshot = (
  instanceId: ProviderInstanceId,
  overrides: Partial<ServerProvider> = {},
): ServerProvider => ({
  instanceId,
  driver: ProviderDriverKind.make(instanceId),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "unknown" },
  checkedAt: "2026-01-01T00:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...overrides,
});

const makeStubTextGeneration = (
  overrides: Partial<TextGeneration.TextGeneration["Service"]>,
): TextGeneration.TextGeneration["Service"] =>
  TextGeneration.TextGeneration.of({
    generateCommitMessage: () =>
      Effect.die("generateCommitMessage stub not configured for this test"),
    generatePrContent: () => Effect.die("generatePrContent stub not configured for this test"),
    generateBranchName: () => Effect.die("generateBranchName stub not configured for this test"),
    generateThreadTitle: () => Effect.die("generateThreadTitle stub not configured for this test"),
    generateActivityHeadline: () =>
      Effect.die("generateActivityHeadline stub not configured for this test"),
    generateProjectIcon: () => Effect.die("generateProjectIcon stub not configured for this test"),
    ...overrides,
  });

const makeStubInstance = (
  instanceId: ProviderInstanceId,
  textGeneration: TextGeneration.TextGeneration["Service"],
  snapshot: Partial<ServerProvider> = {},
): ProviderInstance =>
  ({
    instanceId,
    driverKind: ProviderDriverKind.make(instanceId),
    continuationIdentity: {
      driverKind: ProviderDriverKind.make(instanceId),
      continuationKey: `${instanceId}:test`,
    },
    displayName: undefined,
    enabled: true,
    snapshot: {
      getSnapshot: Effect.succeed(makeSnapshot(instanceId, snapshot)),
    } as unknown as ProviderInstance["snapshot"],
    adapter: {} as ProviderInstance["adapter"],
    textGeneration,
  }) satisfies ProviderInstance;

const makeStubRegistry = (
  instances: ReadonlyArray<ProviderInstance>,
): ProviderInstanceRegistry.ProviderInstanceRegistry["Service"] => {
  const byId = new Map(instances.map((instance) => [instance.instanceId, instance] as const));
  return {
    getInstance: (id) => Effect.succeed(byId.get(id)),
    listInstances: Effect.succeed(instances),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    // Tests never drive changes through this stub; acquire a throwaway
    // subscription on an unused PubSub so the shape is satisfied.
    subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), (pubsub) =>
      PubSub.subscribe(pubsub),
    ),
  };
};

describe("makeTextGenerationFromRegistry", () => {
  it.effect("delegates to the matching instance's textGeneration closure", () =>
    Effect.gen(function* () {
      const personalId = ProviderInstanceId.make("codex_personal");
      const personalCalls: string[] = [];
      const personal = makeStubInstance(
        personalId,
        makeStubTextGeneration({
          generateBranchName: (input) => {
            personalCalls.push(input.message);
            return Effect.succeed({ branch: "personal-branch" });
          },
        }),
      );

      const workId = ProviderInstanceId.make("codex_work");
      const work = makeStubInstance(
        workId,
        makeStubTextGeneration({
          generateBranchName: () => Effect.succeed({ branch: "work-branch" }),
        }),
      );

      const tg = TextGeneration.makeTextGenerationFromRegistry(makeStubRegistry([personal, work]));

      const result = yield* tg.generateBranchName({
        cwd: process.cwd(),
        message: "Refactor the routing layer",
        modelSelection: createModelSelection(ProviderInstanceId.make("codex_personal"), "gpt-5"),
      });

      expect(result.branch).toBe("personal-branch");
      expect(personalCalls).toEqual(["Refactor the routing layer"]);
    }),
  );

  it.effect("reroutes to a ready provider when the selected one's probe reports an error", () =>
    Effect.gen(function* () {
      const codexCalls: string[] = [];
      const codex = makeStubInstance(
        ProviderInstanceId.make("codex"),
        makeStubTextGeneration({
          generateThreadTitle: (input) => {
            codexCalls.push(input.modelSelection.model);
            return Effect.succeed({ title: "from codex" });
          },
        }),
        { status: "error", message: "Codex app-server provider probe failed." },
      );
      const disabled = makeStubInstance(
        ProviderInstanceId.make("grok"),
        makeStubTextGeneration({
          generateThreadTitle: () => Effect.succeed({ title: "from grok" }),
        }),
        { enabled: false },
      );
      const claudeSelections: string[] = [];
      const claude = makeStubInstance(
        ProviderInstanceId.make("claudeAgent"),
        makeStubTextGeneration({
          generateThreadTitle: (input) => {
            claudeSelections.push(
              `${input.modelSelection.instanceId}:${input.modelSelection.model}`,
            );
            return Effect.succeed({ title: "from claude" });
          },
        }),
      );

      const tg = TextGeneration.makeTextGenerationFromRegistry(
        makeStubRegistry([codex, disabled, claude]),
      );
      const result = yield* tg.generateThreadTitle({
        cwd: process.cwd(),
        message: "Fix the login button",
        modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-luna"),
      });

      expect(result.title).toBe("from claude");
      expect(codexCalls).toEqual([]);
      expect(claudeSelections).toEqual(["claudeAgent:claude-haiku-4-5"]);
    }),
  );

  it.effect("keeps the selected provider while its probe is only pending or warning", () =>
    Effect.gen(function* () {
      const codex = makeStubInstance(
        ProviderInstanceId.make("codex"),
        makeStubTextGeneration({
          generateThreadTitle: (input) => Effect.succeed({ title: input.modelSelection.model }),
        }),
        { status: "warning", message: "Codex provider status has not been checked yet." },
      );
      const claude = makeStubInstance(
        ProviderInstanceId.make("claudeAgent"),
        makeStubTextGeneration({
          generateThreadTitle: () => Effect.succeed({ title: "from claude" }),
        }),
      );

      const tg = TextGeneration.makeTextGenerationFromRegistry(makeStubRegistry([codex, claude]));
      const result = yield* tg.generateThreadTitle({
        cwd: process.cwd(),
        message: "anything",
        modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-luna"),
      });

      expect(result.title).toBe("gpt-5.6-luna");
    }),
  );

  it.effect("still runs the selected provider when nothing else is ready", () =>
    Effect.gen(function* () {
      const codex = makeStubInstance(
        ProviderInstanceId.make("codex"),
        makeStubTextGeneration({
          generateThreadTitle: () => Effect.succeed({ title: "from codex" }),
        }),
        { status: "error" },
      );
      const alsoBroken = makeStubInstance(
        ProviderInstanceId.make("claudeAgent"),
        makeStubTextGeneration({
          generateThreadTitle: () => Effect.succeed({ title: "from claude" }),
        }),
        { installed: false, status: "error" },
      );

      const tg = TextGeneration.makeTextGenerationFromRegistry(
        makeStubRegistry([codex, alsoBroken]),
      );
      const result = yield* tg.generateThreadTitle({
        cwd: process.cwd(),
        message: "anything",
        modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-luna"),
      });

      expect(result.title).toBe("from codex");
    }),
  );

  it.effect("fails with TextGenerationError when the instance is unknown", () =>
    Effect.gen(function* () {
      // A ready provider must not absorb requests for an id that was never registered.
      const readyCalls: string[] = [];
      const claude = makeStubInstance(
        ProviderInstanceId.make("claudeAgent"),
        makeStubTextGeneration({
          generateBranchName: () => {
            readyCalls.push("claudeAgent");
            return Effect.succeed({ branch: "from-claude" });
          },
        }),
      );
      const tg = TextGeneration.makeTextGenerationFromRegistry(makeStubRegistry([claude]));

      const result = yield* tg
        .generateBranchName({
          cwd: process.cwd(),
          message: "anything",
          modelSelection: createModelSelection(
            ProviderInstanceId.make("missing_instance"),
            "gpt-5",
          ),
        })
        .pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure._tag).toBe("TextGenerationError");
        expect(result.failure.operation).toBe("generateBranchName");
        expect(result.failure.detail).toContain("missing_instance");
      }
      expect(readyCalls).toEqual([]);
    }),
  );
});
