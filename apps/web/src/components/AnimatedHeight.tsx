"use client";

import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

const HEIGHT_TRANSITION_FALLBACK_MS = 250;

/**
 * Animates its height to follow the rendered size of `children`. When the
 * caller swaps children to null after showing content, the previous content
 * stays mounted and clipped while the container collapses to zero, so closing
 * animates symmetrically with opening; the content unmounts once the
 * transition settles.
 */
export function AnimatedHeight({ children }: { readonly children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<(() => void) | null>(null);
  const exitingRef = useRef(false);
  const hasContent = children !== null && children !== undefined && children !== false;
  const lastContentRef = useRef<ReactNode>(null);
  if (hasContent) lastContentRef.current = children;

  const [heightState, setHeightState] = useState<{
    readonly height: number | null;
    readonly isClipping: boolean;
  }>({ height: null, isClipping: false });
  const [exiting, setExiting] = useState(false);
  const [prevHasContent, setPrevHasContent] = useState(hasContent);

  // Start the collapse in the render phase so the outgoing content never
  // unmounts for an intermediate commit.
  if (hasContent !== prevHasContent) {
    setPrevHasContent(hasContent);
    if (!hasContent && lastContentRef.current !== null && heightState.height !== null) {
      setExiting(true);
      setHeightState((currentState) => ({ height: 0, isClipping: currentState.height !== 0 }));
    } else {
      setExiting(false);
    }
  }

  useLayoutEffect(() => {
    exitingRef.current = exiting;
  }, [exiting]);

  useEffect(() => {
    if (!heightState.isClipping && !exiting) return;
    const timeoutId = window.setTimeout(() => {
      setExiting(false);
      setHeightState((currentState) =>
        currentState.isClipping ? { ...currentState, isClipping: false } : currentState,
      );
    }, HEIGHT_TRANSITION_FALLBACK_MS);
    return () => window.clearTimeout(timeoutId);
  }, [heightState.height, heightState.isClipping, exiting]);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    let firstFrameId: number | null = null;
    let secondFrameId: number | null = null;

    const updateHeight = () => {
      // A collapse pins the container at zero; late measurements of the
      // still-mounted outgoing content must not revive it.
      if (exitingRef.current) return;
      const nextHeight = Math.ceil(element.scrollHeight || element.getBoundingClientRect().height);
      setHeightState((currentState) => {
        if (currentState.height === nextHeight) return currentState;
        return {
          height: nextHeight,
          isClipping: currentState.height !== null,
        };
      });
    };
    const cancelPendingFrames = () => {
      if (firstFrameId !== null) {
        window.cancelAnimationFrame(firstFrameId);
        firstFrameId = null;
      }
      if (secondFrameId !== null) {
        window.cancelAnimationFrame(secondFrameId);
        secondFrameId = null;
      }
    };
    const updateHeightAfterPaint = () => {
      cancelPendingFrames();
      updateHeight();
      firstFrameId = window.requestAnimationFrame(() => {
        firstFrameId = null;
        updateHeight();
        secondFrameId = window.requestAnimationFrame(() => {
          secondFrameId = null;
          updateHeight();
        });
      });
    };

    measureRef.current = updateHeightAfterPaint;
    updateHeightAfterPaint();
    const resizeObserver = new ResizeObserver(updateHeightAfterPaint);
    resizeObserver.observe(element);
    return () => {
      resizeObserver.disconnect();
      cancelPendingFrames();
      measureRef.current = null;
    };
  }, []);

  // Re-measure on every open: reopening with unchanged content emits no
  // ResizeObserver event, so the expand transition needs an explicit kick.
  useLayoutEffect(() => {
    if (!hasContent) return;
    exitingRef.current = false;
    measureRef.current?.();
  }, [hasContent]);

  return (
    <div
      data-slot="animated-height"
      className="transition-[height] duration-200 ease-out motion-reduce:transition-none"
      style={
        heightState.height === null
          ? undefined
          : { height: heightState.height, overflow: heightState.isClipping ? "hidden" : "visible" }
      }
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget || event.propertyName !== "height") return;
        setExiting(false);
        setHeightState((currentState) =>
          currentState.isClipping ? { ...currentState, isClipping: false } : currentState,
        );
      }}
    >
      <div ref={contentRef}>{hasContent ? children : exiting ? lastContentRef.current : null}</div>
    </div>
  );
}
