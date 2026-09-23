import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { HomeSuggestion } from "@t3tools/contracts";
import { ChevronLeftIcon, ChevronRightIcon, CompassIcon, XIcon } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import {
  suggestionScrollEdges,
  suggestionShelfMask,
  type HomeSuggestionShelf as HomeSuggestionShelfModel,
} from "./homeSuggestionShelves";

// Two full cards plus a cut-off third. The 1.5rem is two `gap-3`s, so the
// next card stays visibly clipped instead of the row looking like a static grid.
const SHELF_CARD_FLEX = "0 0 clamp(15rem, calc((100% - 1.5rem) / 2.35), 22rem)";

/**
 * One horizontal row of suggestion cards under a single header line. The
 * caller fills the header's leading text and trailing actions; the row's
 * scroll arrows sit between them so they never cover a card.
 */
export function HomeSuggestionShelfView({
  shelf,
  heading,
  actions,
  projectFor,
  onStart,
  onDismiss,
}: {
  readonly shelf: HomeSuggestionShelfModel<HomeSuggestion>;
  readonly heading: ReactNode;
  readonly actions: ReactNode;
  readonly projectFor: (card: HomeSuggestion) => EnvironmentProject | null;
  readonly onStart: (card: HomeSuggestion) => void;
  readonly onDismiss: (card: HomeSuggestion) => void;
}) {
  const scrollerRef = useRef<HTMLUListElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const updateEdges = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const next = suggestionScrollEdges({
      scrollLeft: node.scrollLeft,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
    });
    setEdges((current) =>
      current.left === next.left && current.right === next.right ? current : next,
    );
    const active = document.activeElement;
    // The arrows live in the header, outside `node`. Move focus onto the row
    // before the focused arrow is disabled and drops it.
    if (!(active instanceof HTMLElement) || !node.parentElement?.contains(active)) return;
    const direction = active.dataset.shelfScroll;
    const exhausted =
      (direction === "back" && !next.left) || (direction === "forward" && !next.right);
    if (exhausted) node.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    updateEdges();
    node.addEventListener("scroll", updateEdges, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateEdges);
    observer?.observe(node);
    return () => {
      node.removeEventListener("scroll", updateEdges);
      observer?.disconnect();
    };
  }, [shelf.cards.length, updateEdges]);

  const scrollShelf = useCallback((direction: -1 | 1) => {
    const node = scrollerRef.current;
    if (!node) return;
    const card = node.querySelector<HTMLElement>(":scope > li");
    const gap = Number.parseFloat(getComputedStyle(node).columnGap || "0") || 0;
    const distance = (card?.offsetWidth ?? node.clientWidth * 0.8) + gap;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollBy({ left: direction * distance, behavior: reduceMotion ? "auto" : "smooth" });
  }, []);

  const mask = suggestionShelfMask(edges);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-7 items-center gap-2 px-0.5 text-xs text-muted-foreground">
        {heading}
        <div className="ml-auto flex items-center gap-0.5">
          {edges.left || edges.right ? (
            <>
              <ShelfScrollButton
                direction={-1}
                available={edges.left}
                label={`Previous ${shelf.label} cards`}
                onClick={() => scrollShelf(-1)}
              />
              <ShelfScrollButton
                direction={1}
                available={edges.right}
                label={`More ${shelf.label} cards`}
                onClick={() => scrollShelf(1)}
              />
              <div aria-hidden className="mx-1 h-3.5 w-px bg-border/70" />
            </>
          ) : null}
          {actions}
        </div>
      </div>
      <ul
        ref={scrollerRef}
        tabIndex={-1}
        aria-label={shelf.label}
        data-home-suggestion-shelf={shelf.kind}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain outline-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      >
        {shelf.cards.map((card) => (
          <li key={card.id} className="snap-start" style={{ flex: SHELF_CARD_FLEX }}>
            <SuggestionCard
              card={card}
              project={projectFor(card)}
              onStart={() => onStart(card)}
              onDismiss={() => onDismiss(card)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ShelfScrollButton({
  direction,
  available,
  label,
  onClick,
}: {
  readonly direction: -1 | 1;
  readonly available: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  const Icon = direction < 0 ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <Button
      size="icon-xs"
      variant="ghost-muted"
      data-shelf-scroll={direction < 0 ? "back" : "forward"}
      disabled={!available}
      aria-label={label}
      onClick={onClick}
    >
      <Icon className="size-3.5" />
    </Button>
  );
}

function SuggestionCard({
  card,
  project,
  onStart,
  onDismiss,
}: {
  readonly card: HomeSuggestion;
  readonly project: EnvironmentProject | null;
  readonly onStart: () => void;
  readonly onDismiss: () => void;
}) {
  return (
    <div className="group relative h-full">
      <button
        type="button"
        onClick={onStart}
        className="flex h-full w-full flex-col gap-1 rounded-xl border border-border/50 bg-card/60 px-3.5 py-3 text-left transition-colors hover:border-border hover:bg-card/80 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-1.5 pr-5 text-[.6875rem] text-muted-foreground">
          {project ? (
            <>
              <ProjectFavicon project={project} className="size-3.5 shrink-0" />
              <span className="truncate">{project.title}</span>
            </>
          ) : (
            <>
              <CompassIcon className="size-3.5 shrink-0" />
              <span>New idea</span>
            </>
          )}
        </span>
        <span className="mt-0.5 line-clamp-1 text-sm font-medium leading-snug text-foreground">
          {card.title}
        </span>
        <span className="line-clamp-2 text-xs leading-normal text-muted-foreground">
          {card.summary}
        </span>
      </button>
      <Button
        size="icon-xs"
        variant="ghost-muted"
        className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Dismiss ${card.title}`}
        onClick={onDismiss}
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  );
}
