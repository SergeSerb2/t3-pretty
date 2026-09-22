import { createHomeSuggestionsEnvironmentAtoms } from "@t3tools/client-runtime/state/homeSuggestions";

import { connectionAtomRuntime } from "../connection/runtime";

export const homeSuggestionsEnvironment =
  createHomeSuggestionsEnvironmentAtoms(connectionAtomRuntime);
