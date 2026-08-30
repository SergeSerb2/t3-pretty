/**
 * Pending non-image composer attachments for the scenery attach button.
 * Keyed by scoped thread key so draft↔server URL swaps keep the chips put.
 */
import { useSyncExternalStore } from "react";

import type { AttachedFileRef } from "./attachFiles";

type AttachedFilesByThread = Readonly<Record<string, ReadonlyArray<AttachedFileRef>>>;

export const ATTACHED_FILE_PATH_MAX_COUNT = 32;

export interface AttachedFileStoreUpdate {
  readonly addedCount: number;
  readonly droppedCount: number;
}

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

function mergeAttachedFiles(
  existing: ReadonlyArray<AttachedFileRef>,
  files: ReadonlyArray<AttachedFileRef>,
): { readonly files: ReadonlyArray<AttachedFileRef> } & AttachedFileStoreUpdate {
  const seen = new Set(existing.map((file) => `${file.path}\0${file.name}\0${file.sizeBytes}`));
  const next = [...existing];
  let addedCount = 0;
  let droppedCount = 0;
  for (const file of files) {
    const key = `${file.path}\0${file.name}\0${file.sizeBytes}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (next.length >= ATTACHED_FILE_PATH_MAX_COUNT) {
      droppedCount += 1;
      continue;
    }
    next.push(file);
    addedCount += 1;
  }
  return { files: next, addedCount, droppedCount };
}

export function addAttachedFiles(
  threadKey: string,
  files: ReadonlyArray<AttachedFileRef>,
): AttachedFileStoreUpdate {
  if (files.length === 0) {
    return { addedCount: 0, droppedCount: 0 };
  }
  const existing = attachedFilesByThread[threadKey] ?? [];
  const update = mergeAttachedFiles(existing, files);
  if (update.addedCount === 0) {
    return update;
  }
  attachedFilesByThread = { ...attachedFilesByThread, [threadKey]: update.files };
  emit();
  return update;
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

export function clearAttachedFilesForThread(threadKey: string): void {
  if (!(threadKey in attachedFilesByThread)) {
    return;
  }
  const { [threadKey]: _removed, ...rest } = attachedFilesByThread;
  attachedFilesByThread = rest;
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
): AttachedFileStoreUpdate {
  if (files.length === 0) {
    return { addedCount: 0, droppedCount: 0 };
  }
  const existing = attachedFilesByThread[threadKey] ?? [];
  const update = mergeAttachedFiles(existing, files);
  if (update.addedCount === 0) {
    return update;
  }
  attachedFilesByThread = { ...attachedFilesByThread, [threadKey]: update.files };
  emit();
  return update;
}

/** Test helper. */
export function resetAttachedFilesStore(): void {
  attachedFilesByThread = {};
  emit();
}
