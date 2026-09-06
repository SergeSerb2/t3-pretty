import { createAutomationEnvironmentAtoms } from "@t3tools/client-runtime/state/automations";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSnapshotAtom } from "./shell";

export const automationEnvironment = createAutomationEnvironmentAtoms(connectionAtomRuntime, {
  snapshotAtom: environmentSnapshotAtom,
  catalogValueAtom: environmentCatalog.catalogValueAtom,
});
