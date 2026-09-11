// Retain recent thread snapshots across short subscriber gaps (thread switches,
// panel toggles, and back navigation) while allowing live subscriptions to end
// when the last detail consumer leaves. Snapshot retention is still a memory
// bound, so older threads re-hydrate from the IndexedDB snapshot.
export const THREAD_STATE_IDLE_TTL_MS = 300_000;
export const THREAD_SNAPSHOT_IDLE_TTL_MS = 90_000;
