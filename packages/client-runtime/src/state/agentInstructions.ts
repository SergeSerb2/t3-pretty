import { WS_METHODS } from "@t3tools/contracts";
import type * as Crypto from "effect/Crypto";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

export const AGENT_INSTRUCTION_CONTENT_IDLE_TTL_MS = 60_000;

/**
 * Atoms for the agent-instruction markdown files (`AGENTS.md`, `CLAUDE.md`,
 * …). Files are addressed by server-minted ids, never by paths — see
 * `agentInstructions.ts` in `@t3tools/contracts`.
 */
export function createAgentInstructionAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
) {
  const writeScheduler = createAtomCommandScheduler();
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:agent-instructions:list",
      tag: WS_METHODS.agentInstructionsList,
      staleTimeMs: 15_000,
      idleTtlMs: 5 * 60_000,
    }),
    read: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:agent-instructions:read",
      tag: WS_METHODS.agentInstructionsRead,
      staleTimeMs: 30_000,
      idleTtlMs: AGENT_INSTRUCTION_CONTENT_IDLE_TTL_MS,
    }),
    write: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:agent-instructions:write",
      tag: WS_METHODS.agentInstructionsWrite,
      scheduler: writeScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) =>
          JSON.stringify([environmentId, input.fileId, input.projectCwd ?? null]),
      },
    }),
  };
}
