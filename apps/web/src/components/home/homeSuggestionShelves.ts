import type { HomeSuggestionKind } from "@t3tools/contracts";

export interface HomeSuggestionShelf<T extends { readonly kind: HomeSuggestionKind }> {
  readonly kind: HomeSuggestionKind;
  readonly label: string;
  readonly cards: readonly T[];
}

const SHELF_LABEL: Record<HomeSuggestionKind, string> = {
  project: "Continue a project",
  explore: "New ideas",
};

/** Project work and new ideas each get their own shelf, in that order. */
export function groupHomeSuggestionShelves<T extends { readonly kind: HomeSuggestionKind }>(
  cards: readonly T[],
): readonly HomeSuggestionShelf<T>[] {
  const grouped: Record<HomeSuggestionKind, T[]> = { project: [], explore: [] };
  for (const card of cards) {
    grouped[card.kind].push(card);
  }
  const shelves: HomeSuggestionShelf<T>[] = [];
  if (grouped.project.length > 0) {
    shelves.push({ kind: "project", label: SHELF_LABEL.project, cards: grouped.project });
  }
  if (grouped.explore.length > 0) {
    shelves.push({ kind: "explore", label: SHELF_LABEL.explore, cards: grouped.explore });
  }
  return shelves;
}

export interface SuggestionScrollMetrics {
  readonly scrollLeft: number;
  readonly scrollWidth: number;
  readonly clientWidth: number;
}

/** Which edges of a shelf can still scroll. Tolerance absorbs subpixel rounding. */
export function suggestionScrollEdges(
  metrics: SuggestionScrollMetrics,
  tolerance = 4,
): { readonly left: boolean; readonly right: boolean } {
  const overflow = metrics.scrollWidth - metrics.clientWidth > tolerance;
  return {
    left: overflow && metrics.scrollLeft > tolerance,
    right: overflow && metrics.scrollLeft + metrics.clientWidth < metrics.scrollWidth - tolerance,
  };
}

/** Fades the cut-off side of a shelf so the peeking card dissolves instead of clipping. */
export function suggestionShelfMask(edges: {
  readonly left: boolean;
  readonly right: boolean;
}): string | undefined {
  const fadeRight = "#000 calc(100% - 4rem), transparent";
  if (edges.left && edges.right) {
    return `linear-gradient(to right, transparent, #000 1.75rem, ${fadeRight})`;
  }
  if (edges.right) {
    return `linear-gradient(to right, #000 0, ${fadeRight})`;
  }
  if (edges.left) {
    return "linear-gradient(to right, transparent, #000 1.75rem)";
  }
  return undefined;
}
