import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import {
  environmentMachineKey,
  resolveWritableThreadEnvironmentId,
  type ThreadEnvironmentCandidate,
} from "./threadEnvironmentTarget.ts";

const LOCAL = EnvironmentId.make("environment-local");
const STALE = EnvironmentId.make("environment-stale");
const OTHER = EnvironmentId.make("environment-other");
const THREAD = ThreadId.make("thread-1");
const OTHER_THREAD = ThreadId.make("thread-2");

function candidate(
  environmentId: EnvironmentId,
  overrides: Partial<ThreadEnvironmentCandidate> = {},
): ThreadEnvironmentCandidate {
  return {
    environmentId,
    connected: false,
    machineKey: "nduserca1159.testlab.newspaperdirect.com",
    threadIds: new Set([THREAD]),
    ...overrides,
  };
}

describe("environmentMachineKey", () => {
  it("collapses case and surrounding space", () => {
    expect(environmentMachineKey("  NDUserCA1159.testlab.newspaperdirect.com ")).toBe(
      "nduserca1159.testlab.newspaperdirect.com",
    );
  });
});

describe("resolveWritableThreadEnvironmentId", () => {
  it("keeps the original environment when it is connected", () => {
    expect(
      resolveWritableThreadEnvironmentId({
        environmentId: STALE,
        threadId: THREAD,
        candidates: [candidate(STALE, { connected: true }), candidate(LOCAL, { connected: true })],
      }),
    ).toBe(STALE);
  });

  it("retargets a disconnected row to a live same-machine environment that has the thread", () => {
    expect(
      resolveWritableThreadEnvironmentId({
        environmentId: STALE,
        threadId: THREAD,
        candidates: [
          candidate(STALE),
          candidate(LOCAL, { connected: true }),
          candidate(OTHER, {
            connected: true,
            machineKey: "other-host",
            threadIds: new Set([THREAD]),
          }),
        ],
      }),
    ).toBe(LOCAL);
  });

  it("does not retarget to a different machine that happens to have the thread id", () => {
    expect(
      resolveWritableThreadEnvironmentId({
        environmentId: STALE,
        threadId: THREAD,
        candidates: [
          candidate(STALE),
          candidate(OTHER, {
            connected: true,
            machineKey: "other-host",
            threadIds: new Set([THREAD]),
          }),
        ],
      }),
    ).toBe(STALE);
  });

  it("does not retarget when no connected environment has the thread", () => {
    expect(
      resolveWritableThreadEnvironmentId({
        environmentId: STALE,
        threadId: THREAD,
        candidates: [
          candidate(STALE),
          candidate(LOCAL, { connected: true, threadIds: new Set([OTHER_THREAD]) }),
        ],
      }),
    ).toBe(STALE);
  });
});
