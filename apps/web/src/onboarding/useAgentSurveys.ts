import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { serverEnvironment } from "../state/server";
import { surveyTrailheadAgents } from "./trailhead.logic";

/** Agent readiness for each computer on the climb, read from its provider snapshot. */
export function useAgentSurveys(environmentIds: readonly EnvironmentId[]) {
  const surveysAtom = useMemo(
    () =>
      Atom.make((get) =>
        environmentIds.map((environmentId) => {
          const providers = get(serverEnvironment.providersValueAtom(environmentId));
          return { environmentId, providers, survey: surveyTrailheadAgents(providers) };
        }),
      ),
    [environmentIds],
  );
  return useAtomValue(surveysAtom);
}
