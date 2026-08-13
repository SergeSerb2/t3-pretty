// Retain stream-backed state across short subscriber gaps. Clients with tighter
// memory budgets can override this when creating their thread atom families.
export const THREAD_STATE_IDLE_TTL_MS = 5 * 60_000;
