import type { TrailheadWaypoint } from "@t3tools/shared/trailhead";

export type TrailheadStepId = "welcome" | "connect" | "notify" | "summit";

/** Mobile's stops along the shared ridge. */
export const TRAILHEAD_WAYPOINTS: ReadonlyArray<TrailheadWaypoint<TrailheadStepId>> = [
  { id: "welcome", name: "Trailhead", x: 110, altitude: 1200 },
  { id: "connect", name: "Base camp", x: 400, altitude: 2400 },
  { id: "notify", name: "Ridge", x: 640, altitude: 3100 },
  { id: "summit", name: "Summit", x: 880, altitude: 3812 },
];

export function trailheadStepIndex(step: TrailheadStepId): number {
  return TRAILHEAD_WAYPOINTS.findIndex((waypoint) => waypoint.id === step);
}

export function trailheadWaypoint(step: TrailheadStepId): TrailheadWaypoint<TrailheadStepId> {
  return TRAILHEAD_WAYPOINTS[trailheadStepIndex(step)]!;
}

/** "02 · BASE CAMP" */
export function trailheadKicker(step: TrailheadStepId): string {
  const index = trailheadStepIndex(step);
  return `${String(index + 1).padStart(2, "0")} · ${TRAILHEAD_WAYPOINTS[index]!.name.toUpperCase()}`;
}

/**
 * The ridge step only asks for notifications; it is skipped when they are
 * already granted or this build cannot deliver them.
 */
export function trailheadStepAfter(
  step: TrailheadStepId,
  options: { readonly skipNotify: boolean },
): TrailheadStepId {
  const next = TRAILHEAD_WAYPOINTS[trailheadStepIndex(step) + 1]?.id ?? "summit";
  return next === "notify" && options.skipNotify ? "summit" : next;
}

/** Previous stop for hardware back, or null on the first one. */
export function trailheadStepBefore(
  step: TrailheadStepId,
  options: { readonly skipNotify: boolean },
): TrailheadStepId | null {
  const previous = TRAILHEAD_WAYPOINTS[trailheadStepIndex(step) - 1]?.id ?? null;
  return previous === "notify" && options.skipNotify ? "connect" : previous;
}

export type TrailheadGateDecision = "wait" | "show" | "acknowledge" | "skip";

/**
 * Whether this launch should open Trailhead. Installs that already have a
 * saved connection never needed onboarding, so they are marked done silently.
 */
export function resolveTrailheadGate(input: {
  readonly preferencesLoaded: boolean;
  readonly onboardingCompletedAt: string | undefined;
  readonly catalogReady: boolean;
  readonly hasConnections: boolean;
}): TrailheadGateDecision {
  if (!input.preferencesLoaded) return "wait";
  if (input.onboardingCompletedAt !== undefined) return "skip";
  if (!input.catalogReady) return "wait";
  return input.hasConnections ? "acknowledge" : "show";
}
