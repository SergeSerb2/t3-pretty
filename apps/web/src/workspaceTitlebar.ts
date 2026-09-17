// Icon-collapse still occupies the rail. Only pad what that rail does not
// already cover, or the chat header double-counts the traffic-light inset.
export const COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS =
  "[[data-sidebar-state=collapsed]_&]:pl-[max(0px,calc(var(--workspace-titlebar-content-left)-var(--sidebar-width-icon)))] max-md:[[data-sidebar-state=expanded]_&]:pl-[var(--workspace-titlebar-content-left)]";
