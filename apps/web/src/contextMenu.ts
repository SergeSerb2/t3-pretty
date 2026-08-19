import type { ContextMenuItem, ContextMenuPosition } from "@t3tools/contracts";

import { dismissContextMenu, showContextMenuFallback } from "./contextMenuFallback";

export type ContextMenuSource = "authored" | "edit";

export type ContextMenuState =
  | { readonly status: "idle" }
  | {
      readonly status: "open";
      readonly items: readonly ContextMenuItem[];
      readonly position: ContextMenuPosition;
      readonly source: ContextMenuSource;
    };

type PendingContextMenu = {
  readonly resolve: (itemId: string | null) => void;
  readonly source: ContextMenuSource;
};

const idleState: ContextMenuState = { status: "idle" };
let state: ContextMenuState = idleState;
let activeMenu: PendingContextMenu | null = null;
let registeredHostCount = 0;
const listeners = new Set<() => void>();

function publish(next: ContextMenuState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function resolveActive(itemId: string | null): void {
  activeMenu?.resolve(itemId);
  activeMenu = null;
}

export function readContextMenuState(): ContextMenuState {
  return state;
}

export function subscribeContextMenu(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function registerContextMenuHost(): () => void {
  registeredHostCount += 1;
  let registered = true;

  return () => {
    if (!registered) return;
    registered = false;
    registeredHostCount = Math.max(0, registeredHostCount - 1);

    if (registeredHostCount === 0) {
      resolveActive(null);
      publish(idleState);
    }
  };
}

export function isAuthoredContextMenuOpen(): boolean {
  return state.status === "open" && state.source === "authored";
}

/**
 * Shows the menu through the React host when one is mounted. An undefined
 * result means no host is currently available.
 */
export function requestContextMenu(
  items: readonly ContextMenuItem[],
  position: ContextMenuPosition | undefined,
  source: ContextMenuSource = "authored",
): Promise<string | null> | undefined {
  if (registeredHostCount === 0) return undefined;

  // An authored menu already owns this gesture (sidebar, markdown, …).
  // The desktop edit-menu IPC arrives on the same right-click and must
  // not replace the menu the user asked for.
  if (source === "edit" && isAuthoredContextMenuOpen()) {
    return Promise.resolve(null);
  }

  return new Promise<string | null>((resolve) => {
    resolveActive(null);
    activeMenu = { resolve, source };
    publish({
      status: "open",
      items,
      position: position ?? { x: 0, y: 0 },
      source,
    });
  });
}

export function respondToContextMenu(itemId: string | null): void {
  if (state.status !== "open" || !activeMenu) return;
  resolveActive(itemId);
  publish(idleState);
}

export function dismissHostedContextMenu(): void {
  respondToContextMenu(null);
}

export function showInAppContextMenu<T extends string>(
  items: readonly ContextMenuItem<T>[],
  position?: ContextMenuPosition,
  source: ContextMenuSource = "authored",
): Promise<T | null> {
  const hosted = requestContextMenu(items, position, source);
  if (hosted) {
    return hosted as Promise<T | null>;
  }
  if (source === "edit" && isAuthoredContextMenuOpen()) {
    return Promise.resolve(null);
  }
  return showContextMenuFallback(items, position);
}

export function dismissInAppContextMenu(): void {
  dismissHostedContextMenu();
  dismissContextMenu();
}

export function resetContextMenuForTests(): void {
  resolveActive(null);
  registeredHostCount = 0;
  publish(idleState);
  listeners.clear();
}
