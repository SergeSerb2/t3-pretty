import { RegistryContext } from "@effect/atom-react";
import { useCallback, useContext, useRef, useSyncExternalStore } from "react";
import type { Atom } from "effect/reactivity";

export { useStackRouteVisible as useHomeRouteVisible } from "../../native/use-stack-route-visible";

/**
 * Like `useAtomValue`, but unsubscribed while `visible` is false: the last
 * visible value is held and atom changes do not re-render. Resubscribing reads
 * the current value in the same render that turns visibility back on.
 */
export function useAtomValueWhileVisible<A>(atom: Atom.Atom<A>, visible: boolean): A {
  const registry = useContext(RegistryContext);
  const held = useRef<{ readonly value: A } | null>(null);
  const subscribe = useCallback(
    (onChange: () => void) => (visible ? registry.subscribe(atom, onChange) : () => undefined),
    [registry, atom, visible],
  );
  return useSyncExternalStore(subscribe, () => {
    if (visible || held.current === null) held.current = { value: registry.get(atom) };
    return held.current.value;
  });
}
