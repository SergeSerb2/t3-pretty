import { createContext } from "react";

/**
 * True while phone rows float as frosted cards over the scenery photo. Home
 * provides it so rows never subscribe to scenery state themselves.
 */
export const ThreadListGlassContext = createContext(false);
