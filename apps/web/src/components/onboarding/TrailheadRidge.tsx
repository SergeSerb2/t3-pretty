import {
  formatTrailheadAltitude,
  TRAILHEAD_RIDGE_HEIGHT,
  TRAILHEAD_RIDGE_WIDTH,
  trailheadAltitudeAt,
  trailheadRidgePath,
  trailheadRidgeY,
} from "@t3tools/shared/trailhead";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";

import { TRAILHEAD_WAYPOINTS, type TrailheadStep } from "../../onboarding/trailhead.logic";

const RIDGE_LINE = trailheadRidgePath();
const RIDGE_MASS = trailheadRidgePath({ closed: true });
/** Mirrors --trailhead-climb-ms in trailhead.css. */
const CLIMB_MS = 900;

function motionAllowed(): boolean {
  if (typeof window === "undefined") return false;
  return (
    document.documentElement.hasAttribute("data-scenery-motion") &&
    !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)
  );
}

function ridgePosition(x: number): CSSProperties {
  return {
    "--trailhead-x": `${(x / TRAILHEAD_RIDGE_WIDTH) * 100}%`,
    "--trailhead-y": `${(trailheadRidgeY(x) / TRAILHEAD_RIDGE_HEIGHT) * 100}%`,
  } as CSSProperties;
}

/**
 * Altimeter readout for the top bar. Counts to the new altitude over the
 * same beat the marker climbs, then stops; a still page reads it instantly.
 */
export function TrailheadAltimeter({ altitude }: { readonly altitude: number }) {
  const [shown, setShown] = useState(altitude);
  const shownRef = useRef(altitude);

  useEffect(() => {
    const from = shownRef.current;
    if (from === altitude) return;
    if (!motionAllowed()) {
      shownRef.current = altitude;
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = (now - start) / CLIMB_MS;
      const next = trailheadAltitudeAt(from, altitude, progress);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [altitude]);

  return (
    <div data-trailhead="altimeter" role="img" aria-label={`Altitude ${altitude} metres`}>
      <span data-trailhead="altimeter-label" aria-hidden>
        Alt
      </span>
      <span data-trailhead="altimeter-value" aria-hidden>
        {formatTrailheadAltitude(motionAllowed() ? shown : altitude)}
      </span>
    </div>
  );
}

/**
 * The climb's progress line. Passed waypoints are buttons back to their
 * step; the current one is marked, later ones are printed but inert.
 */
export function TrailheadRidge({
  step,
  disabled,
  onStepChange,
}: {
  readonly step: TrailheadStep;
  readonly disabled: boolean;
  readonly onStepChange: (step: TrailheadStep) => void;
}) {
  const clipId = useId();
  const currentIndex = TRAILHEAD_WAYPOINTS.findIndex((waypoint) => waypoint.id === step);
  const current = TRAILHEAD_WAYPOINTS[currentIndex]!;
  const atSummit = step === "summit";

  return (
    <nav data-trailhead="ridge" aria-label="Setup progress">
      <svg
        viewBox={`0 0 ${TRAILHEAD_RIDGE_WIDTH} ${TRAILHEAD_RIDGE_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <clipPath id={clipId}>
            <rect
              data-trailhead="ridge-walked-clip"
              width={TRAILHEAD_RIDGE_WIDTH}
              height={TRAILHEAD_RIDGE_HEIGHT}
              style={{ "--trailhead-walked": current.x / TRAILHEAD_RIDGE_WIDTH } as CSSProperties}
            />
          </clipPath>
        </defs>
        <path data-trailhead="ridge-mass" d={RIDGE_MASS} />
        <path data-trailhead="ridge-line" d={RIDGE_LINE} vectorEffect="non-scaling-stroke" />
        <path
          data-trailhead="ridge-line"
          data-walked=""
          d={RIDGE_LINE}
          clipPath={`url(#${clipId})`}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <ol className="contents">
        {TRAILHEAD_WAYPOINTS.map((waypoint, index) => {
          const reached = index < currentIndex;
          const isCurrent = index === currentIndex;
          const content = (
            <>
              <span data-trailhead="waypoint-label">{waypoint.name}</span>
              <span data-trailhead="waypoint-altitude">
                {formatTrailheadAltitude(waypoint.altitude)}
              </span>
              {waypoint.id === "summit" && atSummit ? (
                <svg data-trailhead="flag" viewBox="0 0 24 30" fill="none" aria-hidden>
                  <path
                    d="M12 29V2"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                  <path d="M12.75 2.5h10l-3 4.25 3 4.25h-10z" fill="currentColor" />
                </svg>
              ) : (
                <span data-trailhead="waypoint-pole" aria-hidden />
              )}
              <span data-trailhead="waypoint-dot" aria-hidden />
            </>
          );
          return (
            <li key={waypoint.id}>
              {reached && !atSummit ? (
                <button
                  type="button"
                  data-trailhead="waypoint"
                  style={ridgePosition(waypoint.x)}
                  data-reached=""
                  disabled={disabled}
                  aria-label={`Back to ${waypoint.name}`}
                  onClick={() => onStepChange(waypoint.id)}
                >
                  {content}
                </button>
              ) : (
                <span
                  data-trailhead="waypoint"
                  style={ridgePosition(waypoint.x)}
                  data-reached={reached || (isCurrent && atSummit) ? "" : undefined}
                  aria-current={isCurrent ? "step" : undefined}
                >
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div data-trailhead="marker-track" style={ridgePosition(current.x)} aria-hidden>
        <span data-trailhead="marker" />
      </div>
    </nav>
  );
}
