import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { HomeSuggestion } from "@t3tools/contracts";
import { ChevronLeftIcon, ChevronRightIcon, CompassIcon, XIcon } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
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

export function HomeSuggestionShelfView({
  shelf,
  showLabel,
  projectFor,
  onStart,
  onDismiss,
}: {
  readonly shelf: HomeSuggestionShelfModel<HomeSuggestion>;
  readonly showLabel: boolean;
  readonly projectFor: (projectId: HomeSuggestion["projectId"]) => EnvironmentProject | null;
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
    <div role="group" aria-label={shelf.label} className="flex flex-col gap-2">
      {showLabel ? (
        <div className="flex items-center gap-3 px-0.5">
          <h3 className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">
            {shelf.label}
          </h3>
          <div aria-hidden className="h-px min-w-6 flex-1 bg-border/55" />
          <span className="text-[11px] text-muted-foreground/70 tabular-nums">
            {shelf.cards.length}
          </span>
        </div>
      ) : null}
      <div className="relative rounded-2xl bg-foreground/[0.04] p-1.5 ring-1 ring-foreground/15 backdrop-blur-[2px]">
        <ul
          ref={scrollerRef}
          data-home-suggestion-shelf={shelf.kind}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={
            mask
              ? {
                  maskImage: mask,
                  WebkitMaskImage: mask,
                }
              : undefined
          }
        >
          {shelf.cards.map((card) => (
            <li key={card.id} className="snap-start" style={{ flex: SHELF_CARD_FLEX }}>
              <SuggestionCard
                card={card}
                project={projectFor(card.projectId)}
                onStart={() => onStart(card)}
                onDismiss={() => onDismiss(card)}
              />
            </li>
          ))}
        </ul>
        {edges.left ? (
          <ShelfScrollButton
            direction={-1}
            label={`Previous ${shelf.label} cards`}
            onClick={() => scrollShelf(-1)}
          />
        ) : null}
        {edges.right ? (
          <ShelfScrollButton
            direction={1}
            label={`More ${shelf.label} cards`}
            onClick={() => scrollShelf(1)}
          />
        ) : null}
      </div>
    </div>
  );
}

function ShelfScrollButton({
  direction,
  label,
  onClick,
}: {
  readonly direction: -1 | 1;
  readonly label: string;
  readonly onClick: () => void;
}) {
  const Icon = direction < 0 ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <Button
      size="icon-sm"
      variant="glass"
      className={cn(
        "absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-background/85 shadow-md",
        direction < 0 ? "left-1.5" : "right-2",
      )}
      aria-label={label}
      onClick={onClick}
    >
      <Icon className="size-4" />
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
        className="flex h-full min-h-32 w-full flex-col gap-1.5 rounded-xl border border-border/60 bg-card/55 px-3.5 py-3 text-left shadow-sm transition-colors hover:border-border hover:bg-card/75 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
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
        <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
          {card.title}
        </span>
        <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground/78">
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
