import { createAgentInstructionAtoms } from "@t3tools/client-runtime/state/agent-instructions";

import { connectionAtomRuntime } from "../connection/runtime";

export const agentInstructionsEnvironment = createAgentInstructionAtoms(connectionAtomRuntime);
