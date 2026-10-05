import type { ActiveTurnComposerAction } from "@t3tools/client-runtime/state/composer-dispatch";

/**
 * What the send button does while a turn is already running: `queue` waits for
 * the turn to finish, `steer` delivers the new message into the running turn.
 *
 * Queueing is a legacy opt-in stored per device alongside the other composer
 * preferences. Mobile has no client-settings sync.
 */
export type FollowUpBehavior = Extract<ActiveTurnComposerAction, "queue" | "steer">;

export const DEFAULT_FOLLOW_UP_BEHAVIOR: FollowUpBehavior = "steer";
