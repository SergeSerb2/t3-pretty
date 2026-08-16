// Retain stream-backed state across short subscriber gaps (thread switches,
// panel toggles). Each retained thread keeps its subscribeThread stream, reducer
// and window alive, so this is a memory bound as much as a UX one; anything
// revisited later re-hydrates from the IndexedDB snapshot. Clients with tighter
// memory budgets can override this when creating their thread atom families.
export const THREAD_STATE_IDLE_TTL_MS = 90_000;
