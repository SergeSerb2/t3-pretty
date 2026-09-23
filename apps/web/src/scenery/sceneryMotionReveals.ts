/**
 * Disclosure reveals. When the user opens a disclosure in a timeline row
 * (any control with aria-expanded="false"), what that open adds unfolds from
 * its header: whole rows mounted under it (turn folds, tool groups) and
 * bodies mounted inside its own row (tool output, thinking, activity and
 * agent details, changed-file folders). Keyed on the gesture, never on
 * mount, so a thread switch, a restored disclosure or a virtualized
 * re-mount cannot replay it.
 */

/** On a body added inside the opened row; motion.css animates the element itself. */
export const REVEAL_CLASS = "scenery-reveal";
/** On a row wrapper the open mounted; motion.css animates its inner box. */
export const ROW_REVEAL_CLASS = "scenery-row-reveal";
export const REVEAL_DELAY_PROP = "--sc-reveal-delay";
/**
 * How long after the gesture the list may take to mount what it opened.
 * Row eligibility is snapshotted on the first live sync; this window only
 * keeps that gesture alive for in-row bodies and a late first commit.
 */
export const REVEAL_INTENT_MS = 400;
export const REVEAL_STAGGER_MS = 24;
export const REVEAL_STAGGER_CAP = 4;
/**
 * The row reveal is 200ms plus at most four stagger steps. A hard cap still
 * clears the class if `animationend` never fires (0-duration kill switch, a
 * node that left the document mid-animation).
 */
export const REVEAL_CLEAR_MS = 500;

const ROW_SELECTOR = "[data-timeline-row-id]";

export interface RevealIntent {
  /** The disclosure control the user activated. */
  readonly control: Element;
  readonly rowId: string;
  readonly at: number;
  /**
   * Timeline rows mounted when the gesture landed. An open inserts between
   * the header and the next of these; anything past that is live growth.
   */
  readonly mountedRowIds: ReadonlySet<string>;
  /**
   * Ids from the first live sync that belonged to the open. Later arrivals
   * during the intent window are streaming rows, not fold children.
   */
  readonly eligibleRowIds?: ReadonlySet<string>;
}

function isElement(target: EventTarget | null): target is Element {
  return target !== null && typeof (target as Element).closest === "function";
}

/** The disclosure a click, Enter or Space is about to open, when it lives in a timeline row. */
export function resolveRevealIntent(
  target: EventTarget | null,
  at: number,
  readMountedRowIds: () => ReadonlySet<string>,
): RevealIntent | null {
  if (!isElement(target)) return null;
  // The nearest disclosure owns the gesture: a click inside an open body must
  // not count as opening a closed disclosure further up the tree.
  const control = target.closest("[aria-expanded]");
  if (control?.getAttribute("aria-expanded") !== "false") return null;
  const rowId = control.closest(ROW_SELECTOR)?.getAttribute("data-timeline-row-id");
  if (!rowId) return null;
  return { control, rowId, at, mountedRowIds: readMountedRowIds() };
}

export function revealIntentIsLive(
  intent: RevealIntent | null,
  now: number,
): intent is RevealIntent {
  return intent !== null && now - intent.at <= REVEAL_INTENT_MS;
}

/**
 * Top-level elements an open added inside its own row: the disclosure body.
 * Never a remount of the row or its header, never content streaming into a
 * body that is already revealing (it rides that body's fade), and never a
 * native button's relabelled content (its chevron or label swap). A
 * role="button" container is different: a tool entry or agent member holds
 * the body it opens, so what mounts inside it is the reveal.
 */
export function collectInRowReveals(
  mutations: ReadonlyArray<Pick<MutationRecord, "addedNodes">>,
  intent: RevealIntent,
  row: Element,
): Element[] {
  const controlIsLabel = intent.control.tagName === "BUTTON";
  const added: Element[] = [];
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      if (
        element === row ||
        !row.contains(element) ||
        element.contains(intent.control) ||
        (controlIsLabel && intent.control.contains(element)) ||
        element.closest(`.${REVEAL_CLASS}`) !== null
      ) {
        continue;
      }
      added.push(element);
    }
  }
  return added.filter(
    (element) => !added.some((other) => other !== element && other.contains(element)),
  );
}

/**
 * The top of the first row below the header that was already mounted when the
 * gesture landed. An open inserts its rows between the header and that row;
 * rows streaming in past it are arrivals, not part of the disclosure. Null
 * when nothing mounted sat below the header.
 */
export function revealBoundaryTop(
  rows: ReadonlyArray<{ readonly id: string; readonly top: number }>,
  intent: RevealIntent,
  intentRowTop: number,
): number | null {
  let boundary: number | null = null;
  for (const row of rows) {
    if (row.top > intentRowTop && intent.mountedRowIds.has(row.id)) {
      boundary = boundary === null ? row.top : Math.min(boundary, row.top);
    }
  }
  return boundary;
}

function isEligibleRevealRow(
  row: { readonly id: string; readonly top: number },
  intent: RevealIntent,
  intentRowTop: number,
  boundaryTop: number | null,
): boolean {
  return (
    !intent.mountedRowIds.has(row.id) &&
    row.top > intentRowTop &&
    (boundaryTop === null || row.top < boundaryTop)
  );
}

/**
 * Freeze the rows the first live sync saw under the opened header. An empty
 * wave is left unfrozen so a click can still wait for React to commit the
 * fold; the next sync that actually mounts children becomes the snapshot.
 */
export function snapshotEligibleRevealRowIds(
  intent: RevealIntent,
  rows: ReadonlyArray<{ readonly id: string; readonly top: number }>,
  intentRowTop: number,
  boundaryTop: number | null,
): RevealIntent {
  if (intent.eligibleRowIds !== undefined) return intent;
  const eligibleRowIds = new Set<string>();
  for (const row of rows) {
    if (isEligibleRevealRow(row, intent, intentRowTop, boundaryTop)) {
      eligibleRowIds.add(row.id);
    }
  }
  if (eligibleRowIds.size === 0) return intent;
  return { ...intent, eligibleRowIds };
}

/** A row the open mounted under its header, as opposed to one that was already there. */
export function isRevealedRow(
  row: { readonly id: string; readonly top: number },
  intent: RevealIntent,
  intentRowTop: number,
  boundaryTop: number | null,
): boolean {
  if (!isEligibleRevealRow(row, intent, intentRowTop, boundaryTop)) return false;
  return intent.eligibleRowIds === undefined || intent.eligibleRowIds.has(row.id);
}

export function revealDelayMs(index: number): number {
  return Math.min(index, REVEAL_STAGGER_CAP) * REVEAL_STAGGER_MS;
}
