/**
 * The fork's motion driver: watches upstream's chat DOM through the same
 * MutationObserver + portal pattern as ComposerAttachControl and gives the
 * thread its animation layer without touching upstream files.
 *
 * Three jobs:
 *
 * 1. Row arrivals — tag a timeline row wrapper with `scenery-row-enter`
 *    (motion.css animates it) the FIRST time its row id is seen. Guards
 *    against the two virtualization traps: a thread switch replays every
 *    row (suppressed by a silent window keyed on the active thread), and
 *    scrolling up mounts older rows (suppressed by only animating rows
 *    that sit at/after the furthest content already seen).
 *
 * 2. Thinking orbs — canvas dot indicators (vendored thinking-orbs, MIT)
 *    portaled into the "Working…" row (replacing the pulse dots), the
 *    scroll-to-end pill, and the draft hero. Sidebar working threads stay
 *    text-only. The orb's verb is inferred from the newest timeline row,
 *    so the indicator narrates what the agent is doing: searching a globe
 *    while reading, weaving strands while editing, listening while an
 *    approval waits.
 *
 * 3. The html[data-scenery-motion] gate every motion.css rule hangs off,
 *    bound to the quick-settings Motion toggle.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useMotionStore } from "./motionStore";
import { ThinkingOrb } from "./orbs/vendor";
import type { OrbState } from "./orbs/vendor";
import { useActiveThreadKey } from "./useActiveThreadKey";
import { useIsDarkAppearance } from "./useHtmlAttributes";
import {
  HERO_SELECTOR,
  mutationsRequireSceneryMotionSync,
  PILL_SELECTOR,
  ROW_WRAPPER_SELECTOR,
  WORKING_ROW_SELECTOR,
} from "./sceneryMotionMutations";
import "./motion.css";

const ENTER_CLASS = "scenery-row-enter";
const ENTER_DELAY_PROP = "--sc-enter-delay";
const DIP_CLASS = "scenery-orb-dip";

const STAGGER_MS = 40;
const STAGGER_CAP = 3;
/** Rows appearing this soon after a thread switch seed silently. */
const SILENT_WINDOW_MS = 600;
/** Rows mounting above the furthest seen content are history, not news. */
const SEEN_TOP_SLACK_PX = 8;
/** Minimum time the orb holds a verb before switching to the next one. */
const MIN_HOLD_MS = 1500;
const SEEN_CAP = 5000;

/** Newest-tool heading → orb verb. Falls through to "working". */
const TOOL_STATE_RULES: ReadonlyArray<readonly [RegExp, OrbState]> = [
  [/read|search|grep|glob|fetch|web|find|list|explore/i, "searching"],
  [/edit|write|creat|apply|patch|notebook|save/i, "weaving"],
  [/plan/i, "shaping"],
];

interface OrbSlots {
  readonly working: HTMLElement | null;
  readonly pill: HTMLElement | null;
  readonly hero: HTMLElement | null;
}

const NO_SLOTS: OrbSlots = { working: null, pill: null, hero: null };

function sameSlots(left: OrbSlots, right: OrbSlots): boolean {
  return left.working === right.working && left.pill === right.pill && left.hero === right.hero;
}

function orbStateForToolHeading(heading: string): OrbState {
  for (const [pattern, state] of TOOL_STATE_RULES) {
    if (pattern.test(heading)) {
      return state;
    }
  }
  return "working";
}

/**
 * What the agent is doing right now, read from the DOM. Rows are ordered
 * by on-screen position (not document order — the virtualizer may keep
 * recycled nodes out of order) and walked bottom-up past the working row.
 */
function inferOrbState(): OrbState {
  if (document.querySelector("[data-approval-detail]")) {
    return "listening";
  }
  const rows = [...document.querySelectorAll<HTMLElement>("[data-timeline-row-kind]")]
    .map((row) => ({ row, top: row.getBoundingClientRect().top }))
    .sort((left, right) => left.top - right.top);
  for (let index = rows.length - 1; index >= 0; index--) {
    const entry = rows[index];
    if (!entry) {
      continue;
    }
    const { row } = entry;
    const kind = row.getAttribute("data-timeline-row-kind");
    if (kind === "working") {
      continue;
    }
    if (kind === "proposed-plan" || kind === "turn-plan") {
      return "shaping";
    }
    if (kind === "work") {
      const heading = row.querySelector("p > span")?.textContent ?? "";
      return orbStateForToolHeading(heading);
    }
    if (kind === "message") {
      return row.getAttribute("data-message-role") === "assistant" ? "composing" : "working";
    }
    return "working";
  }
  return "working";
}

function ensureSlot(
  managed: Map<string, HTMLElement>,
  key: string,
  className: string,
  tagName: "span" | "div",
  place: (slot: HTMLElement) => void,
): HTMLElement {
  const existing = managed.get(key);
  const slot = existing ?? document.createElement(tagName);
  slot.className = className;
  place(slot);
  managed.set(key, slot);
  return slot;
}

export function SceneryMotion() {
  const enabled = useMotionStore((state) => state.enabled);
  const threadKey = useActiveThreadKey();
  const isDark = useIsDarkAppearance();
  const orbTheme = isDark ? "dark" : "light";
  const [slots, setSlots] = useState<OrbSlots>(NO_SLOTS);
  const [orbState, setOrbState] = useState<OrbState>("working");

  // A thread switch (or first mount) opens the silent window: the burst of
  // rows a freshly mounted timeline renders must seed, not animate.
  const silentUntilRef = useRef(0);
  useEffect(() => {
    silentUntilRef.current = performance.now() + SILENT_WINDOW_MS;
  }, [threadKey]);

  useEffect(() => {
    if (!enabled || typeof document === "undefined") {
      return;
    }
    document.documentElement.setAttribute("data-scenery-motion", "");

    const seenRowIds = new Set<string>();
    const managedSlots = new Map<string, HTMLElement>();
    const orbHold = { state: "working" as OrbState, since: 0 };
    let holdTimer: number | null = null;
    let queued = false;
    let disposed = false;

    const syncRowArrivals = () => {
      const wrappers = [...document.querySelectorAll<HTMLElement>(ROW_WRAPPER_SELECTOR)];
      const silent = performance.now() < silentUntilRef.current;
      let maxSeenTop = Number.NEGATIVE_INFINITY;
      const unseen: Array<{ wrapper: HTMLElement; id: string; top: number }> = [];
      for (const wrapper of wrappers) {
        const id = wrapper
          .querySelector("[data-timeline-row-id]")
          ?.getAttribute("data-timeline-row-id");
        if (!id) {
          continue;
        }
        if (seenRowIds.has(id)) {
          maxSeenTop = Math.max(maxSeenTop, wrapper.getBoundingClientRect().top);
        } else {
          unseen.push({ wrapper, id, top: wrapper.getBoundingClientRect().top });
        }
      }
      if (seenRowIds.size > SEEN_CAP) {
        seenRowIds.clear();
        silentUntilRef.current = performance.now() + SILENT_WINDOW_MS;
      }
      unseen.sort((left, right) => left.top - right.top);
      let batchIndex = 0;
      for (const { wrapper, id, top } of unseen) {
        seenRowIds.add(id);
        // History mounting in from a scroll-up (or an expanded fold) sits
        // above content we have already seen — seed it without animating.
        if (silent || top < maxSeenTop - SEEN_TOP_SLACK_PX) {
          continue;
        }
        wrapper.style.setProperty(
          ENTER_DELAY_PROP,
          `${Math.min(batchIndex, STAGGER_CAP) * STAGGER_MS}ms`,
        );
        wrapper.classList.add(ENTER_CLASS);
        wrapper.addEventListener(
          "animationend",
          () => {
            wrapper.classList.remove(ENTER_CLASS);
            wrapper.style.removeProperty(ENTER_DELAY_PROP);
          },
          { once: true },
        );
        batchIndex++;
      }
    };

    const syncOrbSlots = (): OrbSlots => {
      let working: HTMLElement | null = null;
      let pill: HTMLElement | null = null;
      let hero: HTMLElement | null = null;

      const workingRow = document.querySelector<HTMLElement>(WORKING_ROW_SELECTOR);

      const workingDots = workingRow?.querySelector("span.inline-flex");
      if (workingDots?.parentElement) {
        working = ensureSlot(
          managedSlots,
          "working",
          "scenery-orb-slot scenery-orb-slot--working",
          "span",
          (slot) => {
            if (slot.nextElementSibling !== workingDots) {
              workingDots.parentElement?.insertBefore(slot, workingDots);
            }
          },
        );
      }

      const pillButton = document.querySelector<HTMLElement>(PILL_SELECTOR);
      if (pillButton) {
        pill = ensureSlot(managedSlots, "pill", "scenery-orb-slot", "span", (slot) => {
          if (slot.parentElement !== pillButton) {
            pillButton.insertBefore(slot, pillButton.firstChild);
          }
        });
      }

      const heroHeadline = document.querySelector<HTMLElement>(HERO_SELECTOR);
      if (heroHeadline?.parentElement) {
        hero = ensureSlot(managedSlots, "hero", "scenery-orb-hero", "div", (slot) => {
          if (slot.nextElementSibling !== heroHeadline) {
            heroHeadline.parentElement?.insertBefore(slot, heroHeadline);
          }
        });
      }

      for (const [key, slot] of managedSlots) {
        const live = key === "working" ? working : key === "pill" ? pill : hero;
        if (!live) {
          slot.remove();
          managedSlots.delete(key);
        }
      }

      return { working, pill, hero };
    };

    const commitOrbState = (next: OrbState) => {
      orbHold.state = next;
      orbHold.since = performance.now();
      setOrbState(next);
      for (const key of ["working", "pill"] as const) {
        const slot = managedSlots.get(key);
        if (slot) {
          slot.classList.add(DIP_CLASS);
          slot.addEventListener("animationend", () => slot.classList.remove(DIP_CLASS), {
            once: true,
          });
        }
      }
    };

    const syncOrbState = (workingPresent: boolean) => {
      if (!workingPresent) {
        return;
      }
      const inferred = inferOrbState();
      if (inferred === orbHold.state) {
        return;
      }
      const elapsed = performance.now() - orbHold.since;
      if (elapsed >= MIN_HOLD_MS) {
        commitOrbState(inferred);
        return;
      }
      // Too soon to switch verbs — re-check once the hold expires.
      if (holdTimer === null) {
        holdTimer = window.setTimeout(() => {
          holdTimer = null;
          if (!disposed) {
            sync();
          }
        }, MIN_HOLD_MS - elapsed);
      }
    };

    const sync = () => {
      queued = false;
      syncRowArrivals();
      const nextSlots = syncOrbSlots();
      syncOrbState(nextSlots.working !== null);
      setSlots((current) => (sameSlots(current, nextSlots) ? current : nextSlots));
    };

    const observer = new MutationObserver((mutations) => {
      if (!mutationsRequireSceneryMotionSync(mutations)) {
        return;
      }
      if (!queued) {
        queued = true;
        requestAnimationFrame(sync);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-timeline-row-id", "data-timeline-row-kind"],
    });
    sync();

    return () => {
      disposed = true;
      observer.disconnect();
      if (holdTimer !== null) {
        window.clearTimeout(holdTimer);
      }
      for (const slot of managedSlots.values()) {
        slot.remove();
      }
      setSlots(NO_SLOTS);
      document.documentElement.removeAttribute("data-scenery-motion");
    };
  }, [enabled]);

  return (
    <>
      {slots.working
        ? createPortal(
            // The row's own "Working for Xs" text is the announcement;
            // the orb is decorative next to it.
            <ThinkingOrb state={orbState} size={20} theme={orbTheme} aria-hidden />,
            slots.working,
          )
        : null}
      {slots.pill && slots.working
        ? createPortal(
            <ThinkingOrb
              state={orbState}
              size={20}
              theme={orbTheme}
              style={{ width: 16, height: 16 }}
              aria-hidden
            />,
            slots.pill,
          )
        : null}
      {slots.hero
        ? createPortal(
            <ThinkingOrb state="breathing" size={64} theme={orbTheme} aria-hidden />,
            slots.hero,
          )
        : null}
    </>
  );
}

export default SceneryMotion;
