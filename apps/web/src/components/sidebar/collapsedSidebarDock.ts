// The collapsed icon rail grows to the macOS traffic-light inset (~90px). A
// single centered 32px column leaves gutters on both sides; past 4rem the
// dock uses two columns and tiles that fill each cell. The 3rem web rail
// stays a single column of full-bleed tiles.
export const COLLAPSED_DOCK_CONTAINER_CLASS = "@container/collapsed-dock";

export const COLLAPSED_DOCK_GRID_CLASS =
  "grid w-full min-w-0 grid-cols-1 content-start gap-1 @[4rem]/collapsed-dock:grid-cols-2";

export const COLLAPSED_DOCK_COLLAPSED_MENU_CLASS =
  "group-data-[collapsible=icon]:grid group-data-[collapsible=icon]:w-full group-data-[collapsible=icon]:grid-cols-1 group-data-[collapsible=icon]:gap-1 group-data-[collapsible=icon]:@[4rem]/collapsed-dock:grid-cols-2";

export const COLLAPSED_DOCK_TILE_BUTTON_CLASS =
  "group-data-[collapsible=icon]:aspect-square group-data-[collapsible=icon]:size-auto! group-data-[collapsible=icon]:h-auto! group-data-[collapsible=icon]:min-h-8 group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:p-1!";

export const COLLAPSED_DOCK_BAR_BUTTON_CLASS =
  "col-span-full aspect-auto! h-8 min-h-8 w-full justify-center gap-1";

export const COLLAPSED_DOCK_WIDE_LABEL_CLASS =
  "hidden text-[10px] font-medium leading-none @[4rem]/collapsed-dock:inline";
