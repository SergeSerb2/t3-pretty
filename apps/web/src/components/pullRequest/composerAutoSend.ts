type Listener = () => void;

export type PendingComposerAutoSend = {
  readonly keys: readonly string[];
  readonly prompt: string;
};

let pending: PendingComposerAutoSend | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function composerAutoSendKey(
  target: string | { readonly environmentId: string; readonly threadId: string },
): string {
  return typeof target === "string" ? target : `${target.environmentId}:${target.threadId}`;
}

export function pendingComposerAutoSendMatches(
  queued: PendingComposerAutoSend | null,
  key: string,
): queued is PendingComposerAutoSend {
  return queued !== null && queued.keys.includes(key);
}

/** The composer holds the queued task: exactly, or appended under the reader's own text. */
export function composerHoldsQueuedAutoSend(composerPrompt: string, queuedPrompt: string): boolean {
  if (queuedPrompt.length === 0) return false;
  return composerPrompt === queuedPrompt || composerPrompt.endsWith(`\n\n${queuedPrompt}`);
}

export function queueComposerAutoSend(keys: readonly string[], prompt: string): void {
  const uniqueKeys = [...new Set(keys.filter((key) => key.length > 0))];
  pending = uniqueKeys.length === 0 ? null : { keys: uniqueKeys, prompt };
  emit();
}

export function peekComposerAutoSend(): PendingComposerAutoSend | null {
  return pending;
}

export function takeComposerAutoSend(key: string, prompt: string): boolean {
  if (pending === null || !pending.keys.includes(key) || pending.prompt !== prompt) return false;
  pending = null;
  emit();
  return true;
}

export function subscribeComposerAutoSend(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearComposerAutoSend(): void {
  if (pending === null) return;
  pending = null;
  emit();
}
