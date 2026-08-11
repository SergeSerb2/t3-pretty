/**
 * Pending non-image composer attachments for the scenery attach button.
 * Keyed by scoped thread key so draft↔server URL swaps keep the chips put.
 */
import { useSyncExternalStore } from "react";

import type { AttachedFileRef } from "./attachFiles";

type AttachedFilesByThread = Readonly<Record<string, ReadonlyArray<AttachedFileRef>>>;

let attachedFilesByThread: AttachedFilesByThread = {};
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): AttachedFilesByThread {
  return attachedFilesByThread;
}

export function getAttachedFilesForThread(
  threadKey: string | null,
): ReadonlyArray<AttachedFileRef> {
  if (!threadKey) {
    return [];
  }
  return attachedFilesByThread[threadKey] ?? [];
}

export function useAttachedFiles(threadKey: string | null): ReadonlyArray<AttachedFileRef> {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (!threadKey) {
    return [];
  }
  return snapshot[threadKey] ?? [];
}

export function addAttachedFiles(threadKey: string, files: ReadonlyArray<AttachedFileRef>): void {
  if (files.length === 0) {
    return;
  }
  const existing = attachedFilesByThread[threadKey] ?? [];
  const seen = new Set(existing.map((file) => `${file.path}\0${file.name}\0${file.sizeBytes}`));
  const next = [...existing];
  for (const file of files) {
    const key = `${file.path}\0${file.name}\0${file.sizeBytes}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(file);
  }
  if (next.length === existing.length) {
    return;
  }
  attachedFilesByThread = { ...attachedFilesByThread, [threadKey]: next };
  emit();
}

export function removeAttachedFile(threadKey: string, fileId: string): void {
  const existing = attachedFilesByThread[threadKey];
  if (!existing) {
    return;
  }
  const next = existing.filter((file) => file.id !== fileId);
  if (next.length === existing.length) {
    return;
  }
  if (next.length === 0) {
    const { [threadKey]: _removed, ...rest } = attachedFilesByThread;
    attachedFilesByThread = rest;
  } else {
    attachedFilesByThread = { ...attachedFilesByThread, [threadKey]: next };
  }
  emit();
}

/** Snapshot + clear for the send path so a failed retry can re-attach. */
export function takeAttachedFilesForThread(
  threadKey: string | null,
): ReadonlyArray<AttachedFileRef> {
  if (!threadKey) {
    return [];
  }
  const existing = attachedFilesByThread[threadKey] ?? [];
  if (existing.length === 0) {
    return [];
  }
  const { [threadKey]: _removed, ...rest } = attachedFilesByThread;
  attachedFilesByThread = rest;
  emit();
  return existing;
}

export function restoreAttachedFiles(
  threadKey: string,
  files: ReadonlyArray<AttachedFileRef>,
): void {
  if (files.length === 0) {
    return;
  }
  attachedFilesByThread = { ...attachedFilesByThread, [threadKey]: [...files] };
  emit();
}

/** Test helper. */
export function resetAttachedFilesStore(): void {
  attachedFilesByThread = {};
  emit();
}
