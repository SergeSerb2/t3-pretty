import { useEffect, useState } from "react";

/**
 * True while `active` is, and for `holdMs` after it turns false, so motion
 * gated on it can finish the change that landed with the flip. A flag that
 * starts false stays false, and a new `resetKey` drops the hold at once.
 */
export function useHeldFlag(active: boolean, holdMs: number, resetKey?: string): boolean {
  const [previous, setPrevious] = useState({ active, resetKey });
  const [holding, setHolding] = useState(false);
  if (previous.active !== active || previous.resetKey !== resetKey) {
    setPrevious({ active, resetKey });
    setHolding(previous.active && !active && previous.resetKey === resetKey);
  }
  useEffect(() => {
    if (!holding) return;
    const timeout = setTimeout(() => setHolding(false), holdMs);
    return () => clearTimeout(timeout);
  }, [holding, holdMs]);
  return active || holding;
}
