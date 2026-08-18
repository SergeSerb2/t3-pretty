import { assert, it, afterEach, expect, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as OriginCli from "./OriginCli.ts";

const mockedRun = vi.fn<VcsProcess.VcsProcess["Service"]["run"]>();
const layer = it.layer(
  OriginCli.layer.pipe(
    Layer.provide(
      Layer.mock(VcsProcess.VcsProcess)({
        run: mockedRun,
      }),
    ),
  ),
);

function processOutput(stdout: string): VcsProcess.VcsProcessOutput {
  return {
    exitCode: ChildProcessSpawner.ExitCode(0),
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

afterEach(() => {
  mockedRun.mockReset();
});

layer("OriginCli.layer", (it) => {
  it.effect("parses pull request view output", () =>
    Effect.gen(function* () {
      mockedRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              number: 35,
              title: "chore(sync): merge upstream",
              url: "https://cursor.com/codebase/serbinenko/t3-pretty/pull/35",
              headRef: "automation/upstream",
              baseRef: "main",
              status: "merged",
            }),
          ),
        ),
      );

      const origin = yield* OriginCli.OriginCli;
      const result = yield* origin.getPullRequest({
        cwd: "/repo",
        reference: "35",
      });

      assert.deepStrictEqual(
        {
          number: result.number,
          title: result.title,
          url: result.url,
          baseRefName: result.baseRefName,
          headRefName: result.headRefName,
          state: result.state,
        },
        {
          number: 35,
          title: "chore(sync): merge upstream",
          url: "https://cursor.com/codebase/serbinenko/t3-pretty/pull/35",
          baseRefName: "main",
          headRefName: "automation/upstream",
          state: "merged",
        },
      );
      expect(mockedRun).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "origin",
          cwd: "/repo",
          args: expect.arrayContaining(["pr", "view", "35"]),
        }),
      );
    }),
  );

  it.effect("reads clone URLs from repo view", () =>
    Effect.gen(function* () {
      mockedRun.mockReturnValueOnce(
        Effect.succeed(
          processOutput(
            // @effect-diagnostics-next-line preferSchemaOverJson:off
            JSON.stringify({
              org: "serbinenko",
              name: "t3-pretty",
              defaultBranch: "main",
              cloneUrl: "https://origin.cursor.com/serbinenko/t3-pretty.git",
            }),
          ),
        ),
      );

      const origin = yield* OriginCli.OriginCli;
      const result = yield* origin.getRepositoryCloneUrls({
        cwd: "/repo",
        repository: "serbinenko/t3-pretty",
      });

      assert.deepStrictEqual(result, {
        nameWithOwner: "serbinenko/t3-pretty",
        url: "https://origin.cursor.com/serbinenko/t3-pretty.git",
        sshUrl: "git@origin.cursor.com:serbinenko/t3-pretty.git",
      });
    }),
  );
});
