import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import type * as Crypto from "effect/Crypto";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  AGENT_INSTRUCTION_CONTENT_IDLE_TTL_MS,
  createAgentInstructionAtoms,
} from "./agentInstructions.ts";

describe("agent-instruction atoms", () => {
  it("releases idle instruction-file contents before the lightweight listing", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry | Crypto.Crypto,
      never
    >;
    const atoms = createAgentInstructionAtoms(runtime);
    const environmentId = EnvironmentId.make("environment-1");

    expect(
      atoms.read({
        environmentId,
        input: { fileId: "project-agents", projectCwd: "/repo" },
      }).idleTTL,
    ).toBe(AGENT_INSTRUCTION_CONTENT_IDLE_TTL_MS);
    expect(atoms.list({ environmentId, input: { projectCwd: "/repo" } }).idleTTL).toBe(5 * 60_000);
  });
});
