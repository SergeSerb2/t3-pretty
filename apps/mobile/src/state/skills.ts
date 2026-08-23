import { createSkillAtoms } from "@t3tools/client-runtime/state/skills";

import { connectionAtomRuntime } from "../connection/runtime";
import { serverEnvironment } from "./server";

export const skillsEnvironment = createSkillAtoms(connectionAtomRuntime, {
  settingsValueAtom: serverEnvironment.settingsValueAtom,
});
