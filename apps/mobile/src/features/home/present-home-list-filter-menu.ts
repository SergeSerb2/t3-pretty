import { presentAppMenu, type MenuEdgePlacement } from "../../components/AppMenuHost";
import { homeListFilterItemsToActions } from "../../components/anchored-menu.logic";
import type { HomeListFilterMenu } from "./home-list-filter-menu";

export function presentHomeListFilterMenu(
  menu: HomeListFilterMenu,
  placement: MenuEdgePlacement,
): void {
  const { actions, handlers } = homeListFilterItemsToActions(menu.items);
  presentAppMenu({
    actions,
    placement,
    title: menu.title,
    onPressAction: (event) => {
      handlers.get(event.nativeEvent.event)?.();
    },
  });
}
