import type { ContextMenuItem, ContextMenuPosition } from "@t3tools/contracts";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  dismissHostedContextMenu,
  readContextMenuState,
  registerContextMenuHost,
  respondToContextMenu,
  showInAppContextMenu,
  subscribeContextMenu,
} from "../contextMenu";
import { contextMenuIcon } from "./contextMenuIcons";
import {
  Menu,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "./ui/menu";

const pointAnchor = (position: ContextMenuPosition) => ({
  getBoundingClientRect: () =>
    DOMRect.fromRect({ x: position.x, y: position.y, width: 0, height: 0 }),
});

function ContextMenuIcon(props: { readonly name: string | undefined }) {
  const Icon = contextMenuIcon(props.name);
  if (Icon === null) return null;
  return <Icon aria-hidden className="size-4 shrink-0" />;
}

function ContextMenuEntries(props: {
  readonly items: readonly ContextMenuItem[];
  readonly instant: boolean;
  readonly onSelect: (itemId: string) => void;
}) {
  return props.items.map((item) => {
    if (item.separator === true) {
      return <MenuSeparator key={item.id} />;
    }
    if (item.header === true) {
      return <MenuGroupLabel key={item.id}>{item.label}</MenuGroupLabel>;
    }

    const hasChildren = Array.isArray(item.children) && item.children.length > 0;
    if (hasChildren) {
      return (
        <MenuSub key={item.id}>
          <MenuSubTrigger
            closeDelay={150}
            delay={0}
            disabled={item.disabled === true}
            onClick={
              item.activateOnClick === true
                ? (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    props.onSelect(item.id);
                  }
                : undefined
            }
          >
            <ContextMenuIcon name={item.icon} />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </MenuSubTrigger>
          <MenuSubPopup align="start" instant={props.instant} positionerClassName="z-[10000]">
            <ContextMenuEntries
              instant={props.instant}
              items={item.children ?? []}
              onSelect={props.onSelect}
            />
          </MenuSubPopup>
        </MenuSub>
      );
    }

    return (
      <MenuItem
        key={item.id}
        disabled={item.disabled === true}
        variant={item.destructive === true ? "destructive" : "default"}
        onClick={() => {
          props.onSelect(item.id);
        }}
      >
        <ContextMenuIcon name={item.icon} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </MenuItem>
    );
  });
}

/**
 * Renders the in-app context menu for every `localApi.contextMenu.show`
 * call, plus desktop edit menus forwarded from Electron's context-menu
 * event. Mounted at the app root so pairing screens get the same chrome.
 */
export function ContextMenuHost() {
  const state = useSyncExternalStore(
    subscribeContextMenu,
    readContextMenuState,
    readContextMenuState,
  );

  useEffect(() => registerContextMenuHost(), []);

  useEffect(() => {
    const bridge = window.desktopBridge;
    if (bridge?.onEditContextMenu === undefined || bridge.resolveEditContextMenu === undefined) {
      return;
    }
    const resolve = bridge.resolveEditContextMenu;
    return bridge.onEditContextMenu((request) => {
      void showInAppContextMenu(request.items, request.position, "edit").then((itemId) => {
        void resolve(request.requestId, itemId);
      });
    });
  }, []);

  const anchor = useMemo(
    () => (state.status === "open" ? pointAnchor(state.position) : null),
    [state],
  );
  const instant = state.status === "open" && state.position.motion !== "dropdown";

  return (
    <Menu
      // Nested flyouts portal outside this root. Modal mode inerts the rest of
      // the document, so those popups look open but swallow no clicks.
      modal={false}
      open={state.status === "open"}
      onOpenChange={(open) => {
        if (!open) dismissHostedContextMenu();
      }}
    >
      {state.status === "open" && anchor !== null ? (
        <MenuPopup
          align="start"
          anchor={anchor}
          instant={instant}
          positionMethod="fixed"
          positionerClassName="z-[10000]"
          side="bottom"
          sideOffset={4}
        >
          <ContextMenuEntries
            instant={instant}
            items={state.items}
            onSelect={respondToContextMenu}
          />
        </MenuPopup>
      ) : null}
    </Menu>
  );
}
