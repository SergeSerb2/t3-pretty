import { afterEach, assert, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as OriginCli from "../sourceControl/OriginCli.ts";
import * as OriginPullRequestCli from "./OriginPullRequestCli.ts";

const mockedExecute = vi.fn<OriginCli.OriginCli["Service"]["execute"]>();
const layer = it.layer(
  OriginPullRequestCli.layer.pipe(
    Layer.provide(Layer.mock(OriginCli.OriginCli)({ execute: mockedExecute })),
  ),
);

function output(stdout: string) {
  return {
    exitCode: ChildProcessSpawner.ExitCode(0),
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

function argsOfCall(index: number): ReadonlyArray<string> {
  const call = mockedExecute.mock.calls[index];
  assert.isDefined(call);
  return call[0].args;
}

afterEach(() => {
  mockedExecute.mockReset();
});

layer("OriginPullRequestCli.layer", (it) => {
  it.effect("requests the current Origin author field for list and detail", () =>
    Effect.gen(function* () {
      const row = {
        number: 35,
        title: "Fix Origin pull requests",
        status: "open",
        headRef: "fix/origin",
        baseRef: "main",
        author: { id: "user_01", displayName: "Serge" },
        createdAt: "2026-08-28T00:00:00Z",
        updatedAt: "2026-08-28T00:00:00Z",
      };
      mockedExecute
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        .mockReturnValueOnce(Effect.succeed(output(JSON.stringify([row]))))
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        .mockReturnValueOnce(Effect.succeed(output(JSON.stringify(row))));

      const cli = yield* OriginPullRequestCli.OriginPullRequestCli;
      const page = yield* cli.listPullRequests({
        cwd: "/repo",
        repository: "serbinenko/t3-pretty",
        state: "open",
        involvement: "all",
        viewer: "Serge",
        limit: 20,
      });
      const detail = yield* cli.getPullRequestDetail({
        cwd: "/repo",
        repository: "serbinenko/t3-pretty",
        number: 35,
      });

      expect(page.items[0]?.author?.login).toBe("Serge");
      expect(detail.author?.login).toBe("Serge");
      for (const index of [0, 1]) {
        const fields = argsOfCall(index)[argsOfCall(index).indexOf("--json") + 1];
        expect(fields?.split(",")).toContain("author");
        expect(fields?.split(",")).not.toContain("authorId");
      }
    }),
  );
});
