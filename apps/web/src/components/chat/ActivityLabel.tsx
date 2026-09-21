import { useLayoutEffect, useRef, type ReactNode } from "react";

import { useMediaQuery } from "../../hooks/useMediaQuery";

/** Reveal a generated headline once, without typing partial text into the live row. */
export function ActivityLabel({
  activityKey,
  headline,
  className,
  children,
}: {
  activityKey: string | null;
  headline: string | null;
  className: string;
  children: ReactNode;
}) {
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const labelRef = useRef<HTMLSpanElement>(null);
  const previous = useRef({ activityKey, headline });

  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = { activityKey, headline };
    const element = labelRef.current;
    if (
      reducedMotion ||
      activityKey === null ||
      last.activityKey !== activityKey ||
      !headline ||
      last.headline === headline ||
      !element?.animate ||
      document.visibilityState === "hidden"
    )
      return;

    // Wide feather (about half the row) so the headline settles in like a
    // sentence being read rather than a hard wipe. Mask is 260% wide so the
    // solid 40% still covers the whole row at the resting position.
    const mask = {
      maskImage: "linear-gradient(90deg, #000 0% 40%, transparent 60% 100%)",
      maskSize: "260% 100%",
      maskRepeat: "no-repeat",
    };
    let animation: Animation | undefined;
    const retire = () => {
      animation?.cancel();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") retire();
    };
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) {
        if (animation) retire();
        return;
      }
      if (animation) return;
      animation = element.animate(
        [
          { ...mask, maskPosition: "100% 0%", opacity: 0.35 },
          { ...mask, maskPosition: "0% 0%", opacity: 1 },
        ],
        { duration: 820, easing: "cubic-bezier(0.45, 0.05, 0.25, 1)" },
      );
      void animation.finished.then(retire, () => {});
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return retire;
  }, [activityKey, headline, reducedMotion]);

  return (
    <span ref={labelRef} className={className}>
      {children}
    </span>
  );
}
