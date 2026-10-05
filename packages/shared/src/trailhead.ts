/**
 * Trailhead: T3 Pretty's first-run onboarding, drawn as a short climb along
 * one ridge. Web, desktop, and mobile render the same silhouette so setup
 * reads as one place on every surface; each surface picks its own waypoints
 * along it.
 *
 * Coordinates live in a fixed 1000 × 200 box, y pointing down, so callers can
 * draw the ridge into an SVG `viewBox="0 0 1000 200"` stretched to any width.
 */

export const TRAILHEAD_RIDGE_WIDTH = 1000;
export const TRAILHEAD_RIDGE_HEIGHT = 200;

/** Hand-placed ridge: a long approach, two false summits, the top, a short descent. */
export const TRAILHEAD_RIDGE_POINTS: ReadonlyArray<readonly [x: number, y: number]> = [
  [0, 186],
  [55, 178],
  [110, 160],
  [150, 167],
  [205, 140],
  [250, 147],
  [300, 120],
  [345, 128],
  [400, 98],
  [450, 107],
  [505, 84],
  [545, 93],
  [595, 68],
  [640, 77],
  [690, 54],
  [730, 63],
  [785, 38],
  [830, 44],
  [880, 16],
  [925, 34],
  [965, 52],
  [1000, 60],
];

export interface TrailheadWaypoint<Id extends string = string> {
  readonly id: Id;
  readonly name: string;
  /** Altitude printed on the altimeter, in metres. */
  readonly altitude: number;
  /** Horizontal position on the ridge, 0–1000. */
  readonly x: number;
}

/** Ridge height at `x`, linearly interpolated between the hand-placed points. */
export function trailheadRidgeY(x: number): number {
  const points = TRAILHEAD_RIDGE_POINTS;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index]!;
    if (x <= x1) {
      const [x0, y0] = points[index - 1]!;
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return last[1];
}

/**
 * SVG path for the ridge line. Points are joined with Catmull-Rom curves so
 * the line reads as terrain rather than a chart; `closed` drops the path to
 * the bottom edge for a filled silhouette.
 */
export function trailheadRidgePath(options: { readonly closed?: boolean } = {}): string {
  const points = TRAILHEAD_RIDGE_POINTS;
  const round = (value: number) => Math.round(value * 10) / 10;
  let path = `M${points[0]![0]} ${points[0]![1]}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[Math.min(points.length - 1, index + 2)]!;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    path += ` C${round(c1x)} ${round(c1y)} ${round(c2x)} ${round(c2y)} ${p2[0]} ${p2[1]}`;
  }
  if (options.closed) {
    path += ` L${TRAILHEAD_RIDGE_WIDTH} ${TRAILHEAD_RIDGE_HEIGHT} L0 ${TRAILHEAD_RIDGE_HEIGHT} Z`;
  }
  return path;
}

/** "3 812 m": thin-spaced thousands, like a printed trail map. */
export function formatTrailheadAltitude(metres: number): string {
  const rounded = Math.max(0, Math.round(metres));
  return `${String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} m`;
}

/**
 * Altimeter reading `progress` (0–1) of the way between two altitudes. Eases
 * out so the count settles onto the waypoint instead of stopping abruptly.
 */
export function trailheadAltitudeAt(from: number, to: number, progress: number): number {
  const t = Math.min(1, Math.max(0, progress));
  const eased = 1 - (1 - t) ** 3;
  return from + (to - from) * eased;
}
