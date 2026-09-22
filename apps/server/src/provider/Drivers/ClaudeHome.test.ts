import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  claudeSignedOutMessage,
  importClaudeSessionTranscript,
  makeClaudeCapabilitiesCacheKey,
  makeClaudeEnvironment,
  resolveClaudeHomePath,
} from "./ClaudeHome.ts";

it.layer(NodeServices.layer)("ClaudeHome", (it) => {
  describe("Claude home resolution", () => {
    it.effect("treats empty, ~/.claude, and the expanded default as the same Claude home", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const resolved = path.resolve(path.join(NodeOS.homedir(), ".claude"));

        expect(yield* resolveClaudeHomePath({ homePath: "" })).toBe(resolved);
        expect(yield* resolveClaudeHomePath({ homePath: "~/.claude" })).toBe(resolved);
        expect(yield* resolveClaudeHomePath({ homePath: resolved })).toBe(resolved);
        expect(yield* makeClaudeEnvironment({ homePath: "" })).toBe(process.env);
      }),
    );

    it.effect("resolves configured Claude HOME and stamps the cache key with it", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const homePath = "~/.claude-work";
        const resolved = path.resolve(NodeOS.homedir(), ".claude-work");

        expect(yield* resolveClaudeHomePath({ homePath })).toBe(resolved);
        expect((yield* makeClaudeEnvironment({ homePath })).CLAUDE_CONFIG_DIR).toBe(resolved);
        expect(yield* makeClaudeCapabilitiesCacheKey({ binaryPath: "claude", homePath })).toBe(
          `claude\0${resolved}\0`,
        );
      }),
    );

    it.effect("uses inherited CLAUDE_CONFIG_DIR when homePath is empty", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const inherited = path.resolve("/tmp/claude-inherited");
        const environment = { CLAUDE_CONFIG_DIR: inherited };

        expect(yield* resolveClaudeHomePath({ homePath: "" }, environment)).toBe(inherited);

        const explicit = path.resolve(NodeOS.homedir(), ".claude-work");
        expect(yield* resolveClaudeHomePath({ homePath: "~/.claude-work" }, environment)).toBe(
          explicit,
        );
      }),
    );

    it("points the signed-out hint at the configured Claude home", () => {
      expect(claudeSignedOutMessage({ configDir: undefined, cwd: "/synthetic" })).toContain(
        "run `claude auth login`",
      );
      const configDir = "/synthetic/Claude work's $literal";
      const message = claudeSignedOutMessage({ configDir, cwd: "/synthetic/project" });
      expect(message).toContain(`CLAUDE_CONFIG_DIR set to "${configDir}"`);
      expect(message).not.toContain("CLAUDE_CONFIG_DIR=");
      expect(message).toContain("then start a new thread");
    });

    it.effect("copies a session transcript and its sidecar into another config dir", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped();
        const personal = path.join(root, "personal");
        const work = path.join(root, "work");
        const sessionId = "3f0c1a52-7c1e-4a51-9d7e-2b1f4c6a8e90";
        const project = path.join(personal, "projects", "-repo");
        yield* fileSystem.makeDirectory(path.join(project, sessionId, "subagents"), {
          recursive: true,
        });
        yield* fileSystem.writeFileString(path.join(project, `${sessionId}.jsonl`), "turns\n");
        yield* fileSystem.writeFileString(
          path.join(project, sessionId, "subagents", "agent.jsonl"),
          "subagent\n",
        );
        // An older copy from a previous switch must not win over the latest turns.
        yield* fileSystem.makeDirectory(path.join(work, "projects", "-repo"), { recursive: true });
        yield* fileSystem.writeFileString(
          path.join(work, "projects", "-repo", `${sessionId}.jsonl`),
          "stale\n",
        );

        const copied = yield* importClaudeSessionTranscript({
          sessionId,
          sourceConfigDir: personal,
          targetConfigDir: work,
        });

        expect(copied).toBe(true);
        const target = path.join(work, "projects", "-repo");
        expect(yield* fileSystem.readFileString(path.join(target, `${sessionId}.jsonl`))).toBe(
          "turns\n",
        );
        expect(
          yield* fileSystem.readFileString(
            path.join(target, sessionId, "subagents", "agent.jsonl"),
          ),
        ).toBe("subagent\n");
        expect(
          yield* importClaudeSessionTranscript({
            sessionId,
            sourceConfigDir: path.join(root, "missing"),
            targetConfigDir: work,
          }),
        ).toBe(false);
        expect(
          yield* importClaudeSessionTranscript({
            sessionId,
            sourceConfigDir: work,
            targetConfigDir: work,
          }),
        ).toBe(false);
      }).pipe(Effect.scoped),
    );

    it.effect("separates capability probes by cwd", () =>
      Effect.gen(function* () {
        const config = { binaryPath: "claude", homePath: "" };
        const first = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-a");
        const second = yield* makeClaudeCapabilitiesCacheKey(config, "/repo-b");
        expect(first).not.toBe(second);
      }),
    );
  });
});
