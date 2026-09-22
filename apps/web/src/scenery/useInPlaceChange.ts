import { useState } from "react";

/**
 * True once `value` has changed in front of the user: after the component's
 * first render under the current `scope`. Pair it with a `key` on the value
 * so the remount runs a motion.css entry only for changes the user watched
 * happen (a generated title, a new status), never for first paint, a list
 * mount, or a switch to another thread (a new scope starts clean).
 */
export function useInPlaceChange<T>(value: T, scope: string): boolean {
  const [state, setState] = useState(() => ({ scope, value, changed: false }));
  if (state.scope !== scope) {
    setState({ scope, value, changed: false });
    return false;
  }
  if (!Object.is(state.value, value)) {
    setState({ scope, value, changed: true });
    return true;
  }
  return state.changed;
}
