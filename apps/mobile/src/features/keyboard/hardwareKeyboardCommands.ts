import { ENTITY_ID_MAX_LENGTH, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";

export type HardwareKeyboardCommand =
  | "newTask"
  | "focusSearch"
  | "back"
  | "files"
  | "terminal"
  | "review"
  | "copyThreadReference"
  | "toggleSidebar";

type CommandHandler = () => boolean | void;

const ENCODED_ENTITY_ID_MAX_LENGTH = ENTITY_ID_MAX_LENGTH * 6;
const MOBILE_THREAD_ROUTE_MAX_LENGTH = 96 * 1024;

const handlers = new Map<HardwareKeyboardCommand, Set<CommandHandler>>();
const registrationListeners = new Set<() => void>();
let registrationVersion = 0;

/**
 * Registers a context-specific hardware-keyboard action. The most recently mounted handler gets
 * the first chance to consume the command, allowing focused screens to override app defaults.
 */
export function useHardwareKeyboardCommand(
  command: HardwareKeyboardCommand,
  handler: CommandHandler,
): void {
  useEffect(() => {
    const commandHandlers = handlers.get(command) ?? new Set<CommandHandler>();
    commandHandlers.add(handler);
    handlers.set(command, commandHandlers);
    registrationVersion += 1;
    registrationListeners.forEach((listener) => listener());
    return () => {
      commandHandlers.delete(handler);
      if (commandHandlers.size === 0) handlers.delete(command);
      registrationVersion += 1;
      registrationListeners.forEach((listener) => listener());
    };
  }, [command, handler]);
}

export function getRegisteredHardwareKeyboardCommands(): ReadonlySet<HardwareKeyboardCommand> {
  return new Set(handlers.keys());
}

export function getHardwareKeyboardCommandRegistrationVersion(): number {
  return registrationVersion;
}

export function subscribeToHardwareKeyboardCommandRegistrations(listener: () => void): () => void {
  registrationListeners.add(listener);
  return () => registrationListeners.delete(listener);
}

export function dispatchHardwareKeyboardCommand(command: HardwareKeyboardCommand): boolean {
  const commandHandlers = handlers.get(command);
  if (!commandHandlers) return false;
  for (const handler of [...commandHandlers].toReversed()) {
    if (handler() !== false) return true;
  }
  return false;
}

export function parseActiveThreadPath(pathname: string): {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
} | null {
  if (pathname.length > MOBILE_THREAD_ROUTE_MAX_LENGTH) return null;
  const match = /^\/threads\/([^/]+)\/([^/]+)(?:\/|$)/.exec(pathname);
  if (!match?.[1] || !match[2]) return null;
  if (
    match[1].length > ENCODED_ENTITY_ID_MAX_LENGTH ||
    match[2].length > ENCODED_ENTITY_ID_MAX_LENGTH
  ) {
    return null;
  }
  try {
    const environmentId = decodeURIComponent(match[1]);
    const threadId = decodeURIComponent(match[2]);
    if (
      environmentId.length === 0 ||
      environmentId.length > ENTITY_ID_MAX_LENGTH ||
      threadId.length === 0 ||
      threadId.length > ENTITY_ID_MAX_LENGTH
    ) {
      return null;
    }
    return {
      environmentId: EnvironmentId.make(environmentId),
      threadId: ThreadId.make(threadId),
    };
  } catch {
    return null;
  }
}
