import { createSkillAtoms } from "@t3tools/client-runtime/state/skills";

import { connectionAtomRuntime } from "../connection/runtime";

export const skillsEnvironment = createSkillAtoms(connectionAtomRuntime);
