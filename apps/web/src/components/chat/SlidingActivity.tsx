import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";

const HANDOFF_TIMING = { duration: 280, easing: "cubic-bezier(0.23, 1, 0.32, 1)" };

/** Keeps the live slot in place while one tool hands off to the next. */
export function SlidingActivity({
  activityKey,
  children,
}: {
  activityKey: string | null;
  children: ReactNode;
}) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const slotRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);
  const outgoingRef = useRef<HTMLDivElement>(null);
  const incomingAnimation = useRef<Animation | null>(null);
  const previous = useRef({ activityKey, children });
  const [outgoing, setOutgoing] = useState<{
    children: ReactNode;
    transform: string;
    opacity: string;
  } | null>(null);

  useLayoutEffect(() => {
    const last = previous.current;
    // Skipped calls are still current content; never replay an older tool on return.
    previous.current = { activityKey, children };
    const retire = () => {
      incomingAnimation.current?.cancel();
      incomingAnimation.current = null;
      if (outgoing) setOutgoing(null);
    };
    const element = currentRef.current;
    if (
      reducedMotion ||
      activityKey === null ||
      !element?.animate ||
      document.visibilityState === "hidden"
    ) {
      retire();
      return;
    }
    if (last.activityKey === null || last.activityKey === activityKey) return;
    const bounds = element.getBoundingClientRect();
    if (bounds.bottom <= 0 || bounds.top >= window.innerHeight) {
      retire();
      return;
    }

    // A fast follow-up departs from the incoming row's current position.
    // Keep only that row, so bursts never accumulate an animation backlog.
    const style = getComputedStyle(element);
    setOutgoing({ children: last.children, transform: style.transform, opacity: style.opacity });
    incomingAnimation.current?.cancel();
    incomingAnimation.current = element.animate(
      [
        { transform: "translateY(45%)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      HANDOFF_TIMING,
    );
  });

  useLayoutEffect(() => {
    if (!outgoing || !outgoingRef.current) return;
    const animation = outgoingRef.current.animate(
      [
        { transform: outgoing.transform, opacity: outgoing.opacity },
        { transform: "translateY(-45%)", opacity: 0 },
      ],
      { ...HANDOFF_TIMING, fill: "forwards" },
    );
    void animation.finished.then(
      () => setOutgoing((value) => (value === outgoing ? null : value)),
      () => {},
    );
    let observing = true;
    const retire = () => {
      if (!observing) return;
      observing = false;
      incomingAnimation.current?.cancel();
      incomingAnimation.current = null;
      animation.cancel();
      setOutgoing((value) => (value === outgoing ? null : value));
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") retire();
    };
    // Observe the stationary clip box only while a handoff is in flight.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => !entry.isIntersecting)) retire();
    });
    if (slotRef.current) observer.observe(slotRef.current);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      observing = false;
      animation.cancel();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [outgoing]);

  useLayoutEffect(() => () => incomingAnimation.current?.cancel(), []);

  return (
    <div ref={slotRef} className="relative min-w-0 flex-1 overflow-hidden">
      {outgoing ? (
        <div
          ref={outgoingRef}
          aria-hidden
          inert
          className="pointer-events-none absolute inset-x-0 top-0 select-none"
        >
          {outgoing.children}
        </div>
      ) : null}
      <div ref={currentRef} className="min-w-0">
        {children}
      </div>
    </div>
  );
}
