import { expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { VCS_REMOTE_MAX_COUNT, VcsListRemotesResult } from "./vcs.ts";

it("rejects remote collections beyond the VCS snapshot budget", () => {
  const decode = Schema.decodeUnknownSync(VcsListRemotesResult);
  const remote = {
    name: "origin",
    url: "https://example.com/repo.git",
    pushUrl: Option.none(),
    isPrimary: true,
  };

  expect(() =>
    decode({
      remotes: Array.from({ length: VCS_REMOTE_MAX_COUNT + 1 }, () => remote),
      freshness: {
        source: "live-local",
        observedAt: DateTime.nowUnsafe(),
        expiresAt: Option.none(),
      },
    }),
  ).toThrow();
});
