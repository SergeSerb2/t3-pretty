// Icon-collapse still occupies the rail. Only pad what that rail does not
// already cover, or the chat header double-counts the traffic-light inset.
export const COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS =
  "[[data-sidebar-state=collapsed]_&]:pl-[max(0px,calc(var(--workspace-titlebar-content-left)-var(--sidebar-width-icon)))] max-md:[[data-sidebar-state=expanded]_&]:pl-[var(--workspace-titlebar-content-left)]";

/** Native lights appear after the toggle has started sliding out of their slot. */
export const MACOS_TRAFFIC_LIGHT_REVEAL_DELAY_MS = 120;

export function shouldReserveMacosTrafficLights(input: {
  isMacosDesktop: boolean;
  isFullscreen: boolean;
  isMobile: boolean;
  sidebarOpen: boolean;
}): boolean {
  return input.isMacosDesktop && !input.isFullscreen && (input.isMobile || input.sidebarOpen);
}
