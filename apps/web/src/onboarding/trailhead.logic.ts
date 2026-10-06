import type { ServerProvider } from "@t3tools/contracts";
import type { TrailheadWaypoint } from "@t3tools/shared/trailhead";

import { getOnboardingProviderState } from "./providerReadiness.logic";

/**
 * The desktop and web climb. Mobile walks the same ridge with its own stops
 * (see apps/mobile/src/features/trailhead).
 */
export const TRAILHEAD_WAYPOINTS = [
  { id: "basecamp", name: "Base camp", altitude: 1200, x: 110 },
  { id: "ridge", name: "Ridge", altitude: 2400, x: 400 },
  { id: "saddle", name: "Saddle", altitude: 3100, x: 640 },
  { id: "summit", name: "Summit", altitude: 3812, x: 880 },
] as const satisfies ReadonlyArray<TrailheadWaypoint>;

export type TrailheadStep = (typeof TRAILHEAD_WAYPOINTS)[number]["id"];

export function trailheadWaypointIndex(step: TrailheadStep): number {
  return TRAILHEAD_WAYPOINTS.findIndex((waypoint) => waypoint.id === step);
}

export type TrailheadAgentSurvey = "checking" | "ready" | "needsSetup";

/**
 * One computer's agent readiness. Any ready provider counts, not only the
 * two the Ridge step can set up: a Cursor-only machine is already equipped.
 */
export function surveyTrailheadAgents(
  providers: ReadonlyArray<ServerProvider> | null | undefined,
): TrailheadAgentSurvey {
  if (providers === null || providers === undefined) return "checking";
  const states = providers.map((provider) => getOnboardingProviderState(provider));
  if (states.includes("ready")) return "ready";
  if (states.length === 0 || states.includes("checking")) return "checking";
  return "needsSetup";
}

/** Skip the Ridge only when every selected computer already has a working agent. */
export function resolveStepAfterBaseCamp(
  surveys: ReadonlyArray<TrailheadAgentSurvey>,
): Extract<TrailheadStep, "ridge" | "saddle"> {
  return surveys.length > 0 && surveys.every((survey) => survey === "ready") ? "saddle" : "ridge";
}

export interface TrailheadScanSummary {
  readonly isPending: boolean;
  readonly error: string | null;
  readonly candidateCount: number;
}

/**
 * Skip the Saddle only when every scan finished cleanly and found nothing to
 * import. A pending or failed scan still lands on the Saddle, where it can be
 * watched or retried.
 */
export function resolveStepAfterRidge(
  scans: ReadonlyArray<TrailheadScanSummary>,
): Extract<TrailheadStep, "saddle" | "summit"> {
  const nothingToImport =
    scans.length > 0 &&
    scans.every((scan) => !scan.isPending && scan.error === null && scan.candidateCount === 0);
  return nothingToImport ? "summit" : "saddle";
}

function pluralThreads(count: number): string {
  return `${count} ${count === 1 ? "thread" : "threads"}`;
}

/**
 * What the Summit says when some selected history did not make it. `null`
 * when every selected project landed with all of its conversations.
 */
export function resolveTrailheadImportWarning(input: {
  readonly selectedCount: number;
  readonly landedCount: number;
  readonly importedThreadCount: number;
  readonly skippedThreadCount: number;
}): string | null {
  const { selectedCount, landedCount, importedThreadCount, skippedThreadCount } = input;
  if (landedCount >= selectedCount) return null;
  if (importedThreadCount > 0 && skippedThreadCount > 0) {
    return `Imported ${pluralThreads(importedThreadCount)}. ${pluralThreads(skippedThreadCount)} could not be imported.`;
  }
  if (skippedThreadCount > 0) {
    return `${pluralThreads(skippedThreadCount)} could not be imported.`;
  }
  if (importedThreadCount > 0) {
    return `Imported ${pluralThreads(importedThreadCount)}. Some thread history could not be imported.`;
  }
  return "Could not import thread history.";
}
