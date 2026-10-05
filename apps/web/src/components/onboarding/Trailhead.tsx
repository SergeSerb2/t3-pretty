import { EnvironmentId, type ScopedProjectRef } from "@t3tools/contracts";
import { ArrowRightIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./trailhead.css";

import { APP_BASE_NAME } from "../../branding";
import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { useCompleteOnboarding } from "../../onboarding/firstRun";
import {
  resolveStepAfterRidge,
  TRAILHEAD_WAYPOINTS,
  trailheadWaypointIndex,
  type TrailheadStep,
} from "../../onboarding/trailhead.logic";
import { useAgentSurveys } from "../../onboarding/useAgentSurveys";
import { useProjectScans } from "../../onboarding/useProjectScans";
import { useProjects } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironment } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ChatGptWelcomeCoordinator } from "../settings/ChatGptWelcomeCoordinator";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { TrailheadAgents } from "./TrailheadAgents";
import { TrailheadBaseCamp } from "./TrailheadBaseCamp";
import { TrailheadCardBody, TrailheadCardFooter, TrailheadHeading } from "./TrailheadParts";
import { EMPTY_TRAILHEAD_HAUL, TrailheadProjects, type TrailheadHaul } from "./TrailheadProjects";
import { TrailheadAltimeter, TrailheadRidge } from "./TrailheadRidge";

const NO_ENVIRONMENTS: readonly EnvironmentId[] = [];

/**
 * T3 Pretty's first-run setup, rendered over the scenery at `/welcome` on a
 * fresh install. Four waypoints on one ridge: Base camp surveys the computer,
 * Ridge sets up agents, Saddle imports projects, Summit opens the app. Steps
 * that have nothing to do are walked past automatically; passed waypoints on
 * the ridge lead back. Completion is the `onboardingCompletedAt` client
 * setting, so revisiting `/welcome` climbs again.
 */
export function Trailhead({
  localAvailable,
  onDone,
  resumeEnvironmentId,
}: {
  /** Whether this client is authenticated to the server serving the app. */
  readonly localAvailable: boolean;
  /** Resume at the Ridge for this computer, after a ChatGPT sign-in redirect. */
  readonly resumeEnvironmentId?: EnvironmentId | undefined;
  readonly onDone: (projectRef?: ScopedProjectRef) => void | Promise<void>;
}) {
  const completeOnboarding = useCompleteOnboarding();
  const [step, setStep] = useState<TrailheadStep>(resumeEnvironmentId ? "ridge" : "basecamp");
  const { environments } = useEnvironments();
  const primaryEnvironment = usePrimaryEnvironment();
  const [selection, setSelection] = useState<ReadonlySet<EnvironmentId> | null>(null);
  // Mutated in place: remembers which computers were already auto-picked.
  const [autoSelectedComputers] = useState(() => new Set<EnvironmentId>());
  const [setupIds, setSetupIds] = useState<readonly EnvironmentId[]>(
    resumeEnvironmentId ? [resumeEnvironmentId] : NO_ENVIRONMENTS,
  );
  const [haul, setHaul] = useState<TrailheadHaul | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [finishing, setFinishing] = useState(false);

  // Every computer this client knows is on the trip until unchecked,
  // including ones that turn up mid-climb through pairing or T3 Connect.
  useEffect(() => {
    const newComputers = environments.filter(
      (environment) => !autoSelectedComputers.has(environment.environmentId),
    );
    if (newComputers.length === 0) return;
    for (const environment of newComputers) {
      autoSelectedComputers.add(environment.environmentId);
    }
    setSelection(
      (current) =>
        new Set([
          ...(current ?? []),
          ...newComputers.map((environment) => environment.environmentId),
        ]),
    );
  }, [autoSelectedComputers, environments]);
  const selectedIds = useMemo(
    () => selection ?? new Set(primaryEnvironment ? [primaryEnvironment.environmentId] : []),
    [primaryEnvironment, selection],
  );

  // The computers Base camp can survey right now, stable across renders so
  // the scan and provider subscriptions are not rebuilt on every update.
  const surveyKey = environments
    .filter(
      (environment) =>
        selectedIds.has(environment.environmentId) && environment.connection.phase === "connected",
    )
    .map((environment) => environment.environmentId)
    .join("\n");
  const surveyIds = useMemo(
    () =>
      surveyKey === ""
        ? NO_ENVIRONMENTS
        : surveyKey.split("\n").map((environmentId) => EnvironmentId.make(environmentId)),
    [surveyKey],
  );

  // Base camp starts the history scan so the Saddle usually opens ready.
  const scans = useProjectScans(
    step === "basecamp" ? surveyIds : step === "summit" ? NO_ENVIRONMENTS : setupIds,
  );
  const agentSurveys = useAgentSurveys(step === "basecamp" ? surveyIds : NO_ENVIRONMENTS);

  // Re-probe each surveyed computer once so freshly installed CLIs count.
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const refreshedRef = useRef(new Set<EnvironmentId>());
  useEffect(() => {
    for (const environmentId of surveyIds) {
      if (refreshedRef.current.has(environmentId)) continue;
      refreshedRef.current.add(environmentId);
      void refreshProviders({ environmentId, input: {} });
    }
  }, [refreshProviders, surveyIds]);

  const reachSummit = (nextHaul: TrailheadHaul) => {
    setHaul(nextHaul);
    setStep("summit");
  };

  const finishingRef = useRef(false);
  const finish = useCallback(
    async (projectRef?: ScopedProjectRef) => {
      if (finishingRef.current) return;
      finishingRef.current = true;
      setFinishing(true);
      try {
        await completeOnboarding();
      } catch {
        finishingRef.current = false;
        setFinishing(false);
        toastManager.add({
          type: "error",
          title: "Could not finish setup",
          description: "Your settings could not be saved. Try again.",
        });
        return;
      }
      await onDone(projectRef);
      finishingRef.current = false;
    },
    [completeOnboarding, onDone],
  );

  const hasConnectedComputer = environments.some(
    (environment) => environment.connection.phase === "connected",
  );
  const altitude = TRAILHEAD_WAYPOINTS[trailheadWaypointIndex(step)]!.altitude;

  return (
    <div data-trailhead="root" data-trailhead-step={step}>
      <header data-trailhead="topbar" className={cn(isElectron && "drag-region")}>
        <span className="text-sm font-medium tracking-tight">{APP_BASE_NAME}</span>
        <div className="flex items-center gap-4">
          {step !== "summit" && hasConnectedComputer ? (
            <Button
              variant="ghost-muted"
              size="sm"
              disabled={isImporting || finishing}
              onClick={() => void finish()}
            >
              Skip setup
            </Button>
          ) : null}
          <TrailheadAltimeter altitude={altitude} />
        </div>
      </header>

      <main data-trailhead="stage">
        <section data-trailhead="card" className="dialog-glass" aria-labelledby="trailhead-title">
          {step === "basecamp" ? (
            <TrailheadBaseCamp
              key="basecamp"
              localAvailable={localAvailable}
              selectedIds={selectedIds}
              autoSelectedComputers={autoSelectedComputers}
              agentSurveys={agentSurveys}
              scans={scans}
              onSelectionChange={setSelection}
              onToggleEnvironment={(environmentId, checked) =>
                setSelection((current) => {
                  const next = new Set(current ?? selectedIds);
                  if (checked) next.add(environmentId);
                  else next.delete(environmentId);
                  return next;
                })
              }
              onPaired={(environmentId) => setSelection(new Set([...selectedIds, environmentId]))}
              onContinue={(next) => {
                if (surveyIds.length === 0) return;
                setSetupIds(surveyIds);
                setStep(next);
              }}
            />
          ) : step === "ridge" ? (
            <TrailheadAgents
              key="ridge"
              environmentIds={setupIds}
              onContinue={() => {
                const next = resolveStepAfterRidge(
                  scans.map((scan) => ({
                    isPending: scan.isPending,
                    error: scan.error,
                    candidateCount: scan.data?.candidates.length ?? 0,
                  })),
                );
                if (next === "summit") reachSummit(EMPTY_TRAILHEAD_HAUL);
                else setStep(next);
              }}
            />
          ) : step === "saddle" ? (
            <TrailheadProjects
              key="saddle"
              scans={scans}
              isImporting={isImporting}
              setIsImporting={setIsImporting}
              onFinish={reachSummit}
            />
          ) : (
            <TrailheadSummit
              key="summit"
              haul={haul ?? EMPTY_TRAILHEAD_HAUL}
              finishing={finishing}
              onFinish={finish}
            />
          )}
        </section>
      </main>

      <TrailheadRidge step={step} disabled={isImporting || finishing} onStepChange={setStep} />
      <ChatGptWelcomeCoordinator />
    </div>
  );
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Waypoint 4. Says what made it up, then opens the app on the first thread. */
function TrailheadSummit({
  haul,
  finishing,
  onFinish,
}: {
  readonly haul: TrailheadHaul;
  readonly finishing: boolean;
  readonly onFinish: (projectRef?: ScopedProjectRef) => void;
}) {
  const projects = useProjects();
  const { projectRef } = haul;
  // A new project reaches the read model a beat after its command succeeds;
  // opening its first thread before then would land on a missing project.
  const landingReady =
    projectRef === undefined ||
    projects.some(
      (project) =>
        project.id === projectRef.projectId && project.environmentId === projectRef.environmentId,
    );
  const carried =
    haul.importedProjectCount > 0
      ? `${plural(haul.importedProjectCount, "project", "projects")} and ${plural(haul.importedThreadCount, "conversation", "conversations")} made the climb with you.`
      : haul.importedThreadCount > 0
        ? `${plural(haul.importedThreadCount, "conversation", "conversations")} made the climb with you.`
        : "You travelled light. The first thread starts on a clean page.";

  return (
    <>
      <TrailheadCardBody>
        <TrailheadHeading step="summit" title="Summit.">
          {carried}
        </TrailheadHeading>
        {haul.warning ? (
          <Alert variant="warning" className="mt-5">
            <AlertDescription>{haul.warning}</AlertDescription>
          </Alert>
        ) : null}
      </TrailheadCardBody>
      <TrailheadCardFooter>
        <Button
          size="lg"
          autoFocus
          disabled={!landingReady || finishing}
          onClick={() => onFinish(projectRef)}
        >
          {!landingReady
            ? "Unpacking…"
            : projectRef !== undefined
              ? "Start the first thread"
              : `Open ${APP_BASE_NAME}`}
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </TrailheadCardFooter>
    </>
  );
}
