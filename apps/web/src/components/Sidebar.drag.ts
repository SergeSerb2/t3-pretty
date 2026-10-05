import { closestCenter, type CollisionDetection, type Modifier } from "@dnd-kit/core";
import { verticalListSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";
import {
  isSidebarShelfHeader,
  resolveSidebarDropTarget,
  SIDEBAR_SHELF_HEADERS,
  sidebarListItemId,
  sidebarMarkerId,
  type SidebarListItem,
  type SidebarListMarker,
  type SidebarSection,
} from "./Sidebar.logic";

const stationary = { x: 0, y: 0, scaleX: 1, scaleY: 1 };
const hidden = { ...stationary, scaleY: 0 };
type ThreadItem = Extract<SidebarListItem, { kind: "thread" }>;
type Layout = Parameters<SortingStrategy>[0];
const isShelfHeader = (item: SidebarListItem | undefined) =>
  item?.kind === "marker" && isSidebarShelfHeader(item.marker);

/** Keep the lifted card below the Pins label, including when Pins is empty.
 * The container rect follows scrolling; the offset is measured once at pickup. */
export function restrictBelowSidebarLabel(
  { transform, containerNodeRect, draggingNodeRect }: Parameters<Modifier>[0],
  offset: number,
) {
  if (!containerNodeRect || !draggingNodeRect) return transform;
  const minimumY = containerNodeRect.top + offset - draggingNodeRect.top;
  return transform.y < minimumY ? { ...transform, y: minimumY } : transform;
}

/** Reject the nearest unsupported target without selecting another section.
 * Recreate this detector when drop eligibility changes. */
export function createSidebarCollisionDetection(
  isValidTarget: (id: string) => boolean,
  options: {
    items?: readonly SidebarListItem[];
    activationY?: number | null;
  } = {},
): CollisionDetection {
  const validity = new Map<string, boolean>();
  const sections = new Map<string, SidebarSection | null>();
  let previousPointerY = options.activationY;
  let boundarySection: "pinned" | "active" | undefined;
  return (args) => {
    let collisions = closestCenter(args);
    const pointer = args.pointerCoordinates;
    const items = options.items;
    const source = items?.find((item) => item.kind === "thread" && item.key === args.active.id);
    const boundary = args.droppableContainers
      .find((container) => container.id === sidebarMarkerId("pinned-divider"))
      ?.node.current?.querySelector(".sidebar-drag-boundary-label")
      ?.getBoundingClientRect();
    if (items && boundary && source?.kind === "thread" && pointer) {
      boundarySection ??= source.section === "pinned" ? "pinned" : "active";
      // Use the visible divider row, including its sortable translation.
      // Only pointer movement can change sections: opening the destination
      // moves this row, but must not toggle a stationary gesture back.
      const previousY = previousPointerY ?? pointer.y;
      previousPointerY = pointer.y;
      if (pointer.x >= boundary.left && pointer.x <= boundary.right) {
        if (pointer.y < previousY && pointer.y <= boundary.bottom) boundarySection = "pinned";
        else if (pointer.y > previousY && pointer.y >= boundary.top) boundarySection = "active";
        const nextHeader = SIDEBAR_SHELF_HEADERS.map((header) =>
          args.droppableContainers.find((container) => container.id === sidebarMarkerId(header)),
        ).find((container) => container !== undefined);
        const activeBottom = nextHeader?.node.current?.getBoundingClientRect().top;
        if (boundarySection === "pinned" || (activeBottom != null && pointer.y < activeBottom)) {
          const target = collisions.find((collision) => {
            const id = String(collision.id);
            if (!sections.has(id)) {
              sections.set(
                id,
                resolveSidebarDropTarget(items, String(args.active.id), id)?.section ?? null,
              );
            }
            return sections.get(id) === boundarySection;
          });
          if (target)
            collisions = [target, ...collisions.filter((collision) => collision !== target)];
        }
      }
    }
    const nearest = collisions[0];
    if (!nearest || nearest.id === args.active.id) {
      return collisions;
    }
    const id = String(nearest.id);
    const valid = validity.get(id) ?? isValidTarget(id);
    validity.set(id, valid);
    return valid ? collisions : collisions.filter((collision) => collision.id === args.active.id);
  };
}

/** Preview the committed section layout without moving or mounting DOM nodes.
 * A zero scaleY marks rows/markers to hide while retaining their measured nodes. */
export function createSidebarSortingStrategy(input: {
  items: readonly SidebarListItem[];
  /** Suspend the reorder preview while the thread is dragged out as context. */
  enabled?: boolean;
  settledOrder: readonly string[];
  /** Time-ordered inbox (Working beta): where the lifted row would land. */
  activeOrder?: readonly string[];
  settledExpanded: boolean;
  settledVisibleCount?: number;
  routeThreadKey?: string | null;
  snoozedThreadCount?: number;
  storedThreadCount?: number;
  cardHeight?: number;
  slimHeight?: number;
  /** Space each pinned boundary opens for its label while dragging. The
   * markers stay zero height at rest, so nothing is reserved until pickup. */
  boundaryLabelHeight?: number;
}): SortingStrategy {
  if (input.enabled === false) return () => stationary;
  const { items } = input;
  const indices = new Map(items.map((item, index) => [sidebarListItemId(item), index]));
  let previous: Pick<Layout, "rects" | "activeIndex" | "overIndex"> | undefined;
  let transforms: ReturnType<SortingStrategy>[] | null = [];

  function project({ rects, activeIndex, overIndex }: Layout) {
    const active = items[activeIndex];
    const over = items[overIndex] ?? active;
    if (active?.kind !== "thread" || !over || !rects[0]) return [];
    const target = resolveSidebarDropTarget(items, active.key, sidebarListItemId(over));
    if (!target) return [];
    // Each section is a run of blocks: a row plus the nest children rendered
    // under it. Blocks move as a unit and keep their rows' relative order.
    const blocks: Record<SidebarSection, ThreadItem[][]> = {
      pinned: [],
      active: [],
      working: [],
      snoozed: [],
      stored: [],
      settled: [],
    };
    let cardHeight = input.cardHeight;
    let slimHeight = input.slimHeight;
    let headerScale: number | undefined;
    for (const [index, item] of items.entries()) {
      if (item.kind === "marker") {
        if (isShelfHeader(item)) {
          const height = rects[index]?.height;
          if (height) headerScale ??= height / 32;
        }
        continue;
      }
      if (item.section === "pinned" || item.section === "active" || item.section === "working")
        cardHeight ??= rects[index]?.height;
      else slimHeight ??= rects[index]?.height;
      const group = blocks[item.section];
      const last = group.at(-1);
      if (
        item.nest === "child" &&
        last?.[0]?.nest === "parent" &&
        last[0].pullRequestKey === item.pullRequestKey
      ) {
        last.push(item);
      } else {
        group.push([item]);
      }
    }
    // Cards are 3.25rem + 0.25rem padding; slim rows/placeholders are h-9.
    const scale =
      slimHeight !== undefined ? slimHeight / 36 : (headerScale ?? (cardHeight ?? 56) / 56);
    cardHeight ??= 56 * scale;
    slimHeight ??= 36 * scale;
    const labelHeight = (input.boundaryLabelHeight ?? 0) * scale;
    // Lift the active row out. Inside its own section a nest parent takes its
    // children along, hidden in the gap; leaving the section, it goes alone.
    // A child's place inside its section is fixed under its parent.
    const source = blocks[active.section];
    const sourceIndex = source.findIndex((block) => block.some((row) => row.key === active.key));
    const sourceBlock = source[sourceIndex]!;
    const travelling = new Set<string>();
    let lifted: ThreadItem[] | null = null;
    if (target.section !== active.section) {
      const remaining = sourceBlock.filter((row) => row.key !== active.key);
      source.splice(sourceIndex, 1, ...(remaining.length > 0 ? [remaining] : []));
      lifted = [{ ...active, section: target.section, nest: null }];
    } else if (sourceBlock[0]?.key === active.key) {
      source.splice(sourceIndex, 1);
      lifted = sourceBlock;
      for (const row of sourceBlock.slice(1)) travelling.add(row.key);
    }
    if (lifted) {
      const order =
        target.section === "pinned"
          ? target.pinnedOrder
          : target.section === "settled"
            ? input.settledOrder
            : (input.activeOrder ?? target.activeOrder);
      const ranks = new Map(order.map((key, index) => [key, index]));
      const rank = ranks.get(active.key) ?? Number.POSITIVE_INFINITY;
      const group = blocks[target.section];
      const index = group.findIndex(
        (block) => (ranks.get(block[0]!.key) ?? Number.POSITIVE_INFINITY) > rank,
      );
      group.splice(index < 0 ? group.length : index, 0, lifted);
    }
    const groups: Record<SidebarSection, ThreadItem[]> = {
      pinned: blocks.pinned.flat(),
      active: blocks.active.flat(),
      working: blocks.working.flat(),
      snoozed: blocks.snoozed.flat(),
      stored: blocks.stored.flat(),
      settled: blocks.settled.flat(),
    };
    const settledOrder = (
      input.settledOrder.length > 0 ? input.settledOrder : groups.settled.map((item) => item.key)
    ).filter((key) => key !== active.key || target.section === "settled");
    const visible = new Set(
      input.settledExpanded
        ? settledOrder.slice(0, input.settledVisibleCount ?? settledOrder.length)
        : [],
    );
    const routeKey = input.routeThreadKey;
    if (routeKey && settledOrder.includes(routeKey)) visible.add(routeKey);
    // Rendered rows keep their nest layout. A row the page newly reveals has
    // no node yet and only reserves its space at its time slot.
    const settledRows = groups.settled.filter((item) => visible.has(item.key));
    const shown = new Set(settledRows.map((item) => item.key));
    const settledRanks = new Map(settledOrder.map((key, index) => [key, index]));
    for (const [rank, key] of settledOrder.entries()) {
      if (!visible.has(key) || shown.has(key)) continue;
      const index = settledRows.findIndex(
        (item) =>
          item.nest !== "child" && (settledRanks.get(item.key) ?? Number.POSITIVE_INFINITY) > rank,
      );
      settledRows.splice(index < 0 ? settledRows.length : index, 0, {
        kind: "thread",
        key,
        section: "settled",
      });
    }
    groups.settled = settledRows;
    const projected: SidebarListItem[] = [];
    const marker = (name: SidebarListMarker) => projected.push({ kind: "marker", marker: name });
    const section = (name: "active" | "settled") => {
      if (groups[name].length > 0) projected.push(...groups[name]);
      else marker(`${name}-placeholder`);
    };
    // A shelf keeps its header while it still has rows, including collapsed
    // rows that are counted but not rendered.
    const shelf = (name: "snoozed" | "stored", count: number | undefined) => {
      const header = `${name}-header` as const;
      if (
        groups[name].length > 0 ||
        ((active.section !== name || (count ?? 0) > 1) &&
          items.some((item) => item.kind === "marker" && item.marker === header))
      ) {
        marker(header);
        projected.push(...groups[name]);
      }
    };
    marker("pinned-header");
    projected.push(...groups.pinned);
    marker("pinned-divider");
    section("active");
    if (items.some((item) => item.kind === "marker" && item.marker === "working-header")) {
      marker("working-header");
      projected.push(...groups.working);
    }
    shelf("snoozed", input.snoozedThreadCount);
    shelf("stored", input.storedThreadCount);
    marker("settled-header");
    section("settled");
    const heights = projected.map((item) => {
      const index = indices.get(sidebarListItemId(item));
      const rect = index === undefined ? undefined : rects[index];
      const fallback =
        item.kind === "thread" &&
        (item.section === "pinned" || item.section === "active" || item.section === "working")
          ? cardHeight
          : slimHeight;
      const moved = item.kind === "thread" && item.key === active.key;
      return item.kind === "marker" &&
        (item.marker === "pinned-header" || item.marker === "pinned-divider")
        ? labelHeight
        : item.kind === "marker" && item.marker.endsWith("placeholder")
          ? slimHeight
          : moved
            ? fallback
            : (rect?.height ?? fallback);
    });
    const firstShelf = items.findIndex(isShelfHeader);
    const shelfRect = rects[firstShelf];
    const beforeShelf = rects[firstShelf - 1];
    const lastRect = rects.at(-1);
    // Consume the shelf's auto margin as drag labels and resized rows need
    // room, keeping the combined shelves at their measured bottom.
    let shelfSpace =
      shelfRect && beforeShelf && lastRect && shelfRect.top > beforeShelf.bottom + 1
        ? Math.max(
            0,
            lastRect.bottom - rects[0].top - heights.reduce((sum, height) => sum + height + 1, -1),
          )
        : 0;
    const result = items.map(() => hidden);
    let top = rects[0].top;
    for (const [projectedIndex, item] of projected.entries()) {
      if (isShelfHeader(item)) {
        top += shelfSpace;
        shelfSpace = 0;
      }
      const index = indices.get(sidebarListItemId(item));
      const rect = index === undefined ? undefined : rects[index];
      if (index !== undefined && rect) {
        result[index] = {
          ...(item.kind === "thread" && travelling.has(item.key) ? hidden : stationary),
          y: top - rect.top,
        };
      }
      top += heights[projectedIndex]! + 1;
    }
    result[activeIndex] = stationary;
    return result;
  }

  return (args) => {
    if (
      previous?.rects !== args.rects ||
      previous.activeIndex !== args.activeIndex ||
      previous.overIndex !== args.overIndex
    ) {
      previous = args;
      transforms = project(args);
    }
    return transforms === null
      ? verticalListSortingStrategy(args)
      : (transforms[args.index] ?? stationary);
  };
}
