export interface ComposerNativeEventSnapshot {
  readonly eventCount: number;
  readonly value: string;
  readonly selection: ComposerEditorSelection | null;
}

interface ComposerEditorSelection {
  readonly start: number;
  readonly end: number;
}

export function acknowledgeComposerNativeEvent(
  mostRecentEventCount: number,
  incomingEventCount: number,
): number | null {
  if (!Number.isSafeInteger(incomingEventCount) || incomingEventCount < mostRecentEventCount) {
    return null;
  }
  return incomingEventCount;
}

export function resolveComposerControlledEventCount(
  value: string,
  selection: ComposerEditorSelection | null,
  mostRecentEventCount: number,
  snapshots: ReadonlyArray<ComposerNativeEventSnapshot>,
): number {
  let newestValueEventCount: number | null = null;
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index];
    if (snapshot?.value !== value) continue;

    newestValueEventCount ??= snapshot.eventCount;
    if (
      selection === null ||
      (snapshot.selection?.start === selection.start && snapshot.selection.end === selection.end)
    ) {
      return snapshot.eventCount;
    }
  }

  // A value emitted by native paired with a different selection is an
  // intermediate React render. Keep it behind the native revision so it
  // cannot move the caret while newer keystrokes are being processed.
  if (newestValueEventCount !== null && mostRecentEventCount > 0) {
    return Math.min(newestValueEventCount, mostRecentEventCount - 1);
  }

  return mostRecentEventCount;
}

export function isComposerNativeEcho(
  value: string,
  selection: ComposerEditorSelection | null,
  eventCount: number,
  snapshots: ReadonlyArray<ComposerNativeEventSnapshot>,
): boolean {
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index];
    if (
      snapshot !== undefined &&
      snapshot.eventCount === eventCount &&
      snapshot.value === value &&
      (selection === null ||
        (snapshot.selection?.start === selection.start && snapshot.selection.end === selection.end))
    ) {
      return true;
    }
  }
  return false;
}

export function pruneAcknowledgedComposerNativeEvents(
  snapshots: ReadonlyArray<ComposerNativeEventSnapshot>,
  acknowledgedEventCount: number,
): ComposerNativeEventSnapshot[] {
  let latestAcknowledged: ComposerNativeEventSnapshot | null = null;
  const pending: ComposerNativeEventSnapshot[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.eventCount > acknowledgedEventCount) {
      pending.push(snapshot);
      continue;
    }
    if (latestAcknowledged === null || snapshot.eventCount >= latestAcknowledged.eventCount) {
      latestAcknowledged = snapshot;
    }
  }

  // Keep the latest acknowledged document so a later parent re-render (thread
  // stream, tool call) still matches as a native echo. Dropping it made those
  // renders look like selection writes, which reloads the iOS keyboard session.
  return latestAcknowledged === null ? pending : [latestAcknowledged, ...pending];
}

export function replaceAcknowledgedComposerSnapshot(
  snapshots: ReadonlyArray<ComposerNativeEventSnapshot>,
  next: ComposerNativeEventSnapshot,
): ComposerNativeEventSnapshot[] {
  // A parent-driven write (thread switch, slash command) applies without a
  // native event. Replace the acknowledged snapshot so the previous document
  // cannot be reused as an echo against a different native buffer.
  return [next, ...snapshots.filter((snapshot) => snapshot.eventCount > next.eventCount)];
}
