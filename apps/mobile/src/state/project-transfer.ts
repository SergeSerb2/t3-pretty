import { createProjectTransferCommand } from "@t3tools/client-runtime/state/project-transfer";

import { connectionAtomRuntime } from "../connection/runtime";

export const projectTransfer = createProjectTransferCommand(connectionAtomRuntime);
