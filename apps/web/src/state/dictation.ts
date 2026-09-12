import { useAtomValue } from "@effect/atom-react";
import { createDictationHostAtoms } from "@t3tools/client-runtime/state/dictation";
import type { EnvironmentId } from "@t3tools/contracts";
import { T3CODE_BUILD_FLAVOR } from "@t3tools/shared/connectBranding";
import { Atom } from "effect/unstable/reactivity";

import { environmentPresentations } from "./presentation";
import { environmentSession } from "./session";

const dictationHostAtom = createDictationHostAtoms({
  presentationsAtom: environmentPresentations.presentationsAtom,
  preparedConnectionValueAtom: environmentSession.preparedConnectionValueAtom,
});
const disabledHostAtom = Atom.make(null);

export function useDictationHost(environmentId: EnvironmentId | null) {
  return useAtomValue(
    T3CODE_BUILD_FLAVOR === "internal" ? dictationHostAtom(environmentId) : disabledHostAtom,
  );
}
