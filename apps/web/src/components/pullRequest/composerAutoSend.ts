type Listener = () => void;

let pendingKey: string | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function composerAutoSendKey(
  target: string | { readonly environmentId: string; readonly threadId: string },
): string {
  return typeof target === "string" ? target : `${target.environmentId}:${target.threadId}`;
}

export function queueComposerAutoSend(key: string): void {
  pendingKey = key;
  emit();
}

export function peekComposerAutoSend(): string | null {
  return pendingKey;
}

export function takeComposerAutoSend(key: string): boolean {
  if (pendingKey !== key) return false;
  pendingKey = null;
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
  if (pendingKey === null) return;
  pendingKey = null;
  emit();
}
