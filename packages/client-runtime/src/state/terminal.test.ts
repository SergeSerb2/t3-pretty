import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, TERMINAL_WRITE_MAX_LENGTH, ThreadId } from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createTerminalEnvironmentAtoms,
  splitTerminalWriteData,
  TERMINAL_STATE_IDLE_TTL_MS,
} from "./terminal.ts";

describe("terminal environment atoms", () => {
  it("splits oversized writes without separating a surrogate pair", () => {
    const prefix = "x".repeat(TERMINAL_WRITE_MAX_LENGTH - 1);
    const chunks = splitTerminalWriteData(`${prefix}\u{1f642}tail`);

    expect(chunks).toEqual([prefix, "\u{1f642}tail"]);
    expect(chunks.every((chunk) => chunk.length <= TERMINAL_WRITE_MAX_LENGTH)).toBe(true);
  });

  it("keeps an in-contract write as one command", () => {
    const data = "x".repeat(TERMINAL_WRITE_MAX_LENGTH);
    expect(splitTerminalWriteData(data)).toEqual([data]);
  });

  it("releases an idle terminal attachment before the generic subscription TTL", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry,
      never
    >;
    const atoms = createTerminalEnvironmentAtoms(runtime);

    const environmentId = EnvironmentId.make("environment-1");
    expect(
      atoms.attach({
        environmentId,
        input: { threadId: ThreadId.make("thread-1"), terminalId: "term-1" },
      }).idleTTL,
    ).toBe(TERMINAL_STATE_IDLE_TTL_MS);
    expect(
      atoms.events({
        environmentId,
        input: { threadId: ThreadId.make("thread-1") },
      }).idleTTL,
    ).toBe(TERMINAL_STATE_IDLE_TTL_MS);
    expect(atoms.metadata({ environmentId, input: null }).idleTTL).toBe(TERMINAL_STATE_IDLE_TTL_MS);
  });
});
