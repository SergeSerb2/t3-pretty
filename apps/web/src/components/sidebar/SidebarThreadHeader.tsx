/** Full-width search above the scope title and the new-thread control. */
import { SearchIcon, SquarePenIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useState,
  type ComponentProps,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "~/lib/utils";
import { useTeslaTouchUi } from "~/teslaTouchUi";
import { Button } from "../ui/button";
import { SidebarInput, SidebarMenuButton } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface SidebarThreadHeaderProps {
  /** Project or folder the rail selected. Omitted when the list shows every project. */
  scopeTitle?: ReactNode | undefined;
  /** Receives the click so Shift+click can skip the project picker. */
  onNewThread: (event: ReactMouseEvent) => void;
  newThreadDisabled: boolean;
  newThreadShortcutLabel: string | null | undefined;
  newThreadInProjectShortcutLabel: string | null | undefined;
  /** Shift+click only matters once there is more than one project to pick. */
  showNewThreadInProjectHint: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  isSearching: boolean;
  searchResultCount: number;
  activeSearchResultIndex: number;
  onClearSearch: () => void;
}

export function SidebarThreadHeader({
  scopeTitle,
  onNewThread,
  newThreadDisabled,
  newThreadShortcutLabel,
  newThreadInProjectShortcutLabel,
  showNewThreadInProjectHint,
  searchInputRef,
  searchQuery,
  onSearchQueryChange,
  onSearchKeyDown,
  isSearching,
  searchResultCount,
  activeSearchResultIndex,
  onClearSearch,
}: SidebarThreadHeaderProps) {
  const teslaTouch = useTeslaTouchUi();
  const [searchOpen, setSearchOpen] = useState(false);
  const showSearchField = !teslaTouch || searchOpen || searchQuery.length > 0;
  useEffect(() => {
    if (!teslaTouch || !searchOpen) return;
    const frame = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [searchInputRef, searchOpen, teslaTouch]);
  const resultsVisible = isSearching && searchResultCount > 0;
  // Results shrink as the query narrows, so the active index can outrun the
  // list; pointing aria-activedescendant at a removed option strands the
  // screen reader on nothing.
  const activeResultExists = resultsVisible && activeSearchResultIndex < searchResultCount;
  const newThreadLabel = newThreadShortcutLabel
    ? `New thread (${newThreadShortcutLabel})`
    : "New thread";
  const newThreadButton = (
    <SidebarHeaderIconButton
      label="New thread"
      className="bg-sidebar-control-surface text-sidebar-foreground"
      tooltip={
        showNewThreadInProjectHint ? (
          <span className="flex flex-col gap-0.5">
            <span>{newThreadLabel}</span>
            <span className="text-muted-foreground">
              New thread in current project: Shift+click
              {newThreadInProjectShortcutLabel ? ` (${newThreadInProjectShortcutLabel})` : ""}
            </span>
          </span>
        ) : (
          newThreadLabel
        )
      }
      disabled={newThreadDisabled}
      onClick={onNewThread}
    >
      <SquarePenIcon />
    </SidebarHeaderIconButton>
  );

  const searchField = (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-2 border border-sidebar-border bg-sidebar-control-surface/40 text-sidebar-muted-foreground focus-within:border-ring focus-within:ring-1 focus-within:ring-inset focus-within:ring-ring",
        teslaTouch ? "h-12 rounded-xl px-3 text-base" : "h-8 rounded-md px-2 text-sm",
      )}
    >
      <SearchIcon
        className={cn(
          "shrink-0 text-[var(--sidebar-icon-color)]",
          teslaTouch ? "size-5" : "size-4",
        )}
      />
      <SidebarInput
        ref={searchInputRef}
        nativeInput
        type="search"
        value={searchQuery}
        onChange={(event) => onSearchQueryChange(event.currentTarget.value)}
        onKeyDown={onSearchKeyDown}
        onBlur={
          teslaTouch
            ? () => {
                window.setTimeout(() => {
                  if (searchQuery.length > 0) return;
                  if (document.activeElement === searchInputRef.current) return;
                  setSearchOpen(false);
                }, 0);
              }
            : undefined
        }
        placeholder="Search threads"
        aria-label="Search threads"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={resultsVisible}
        aria-controls={resultsVisible ? "sidebar-thread-search-results" : undefined}
        aria-activedescendant={
          activeResultExists ? `sidebar-thread-search-result-${activeSearchResultIndex}` : undefined
        }
        className="min-w-0 flex-1 [&_[data-slot=input]]:placeholder:text-[var(--sidebar-icon-color)]"
      />
      {isSearching ? (
        <Button
          type="button"
          size={teslaTouch ? "icon" : "icon-micro"}
          variant="ghost"
          className="shrink-0 text-sidebar-muted-foreground hover:bg-sidebar-control-surface hover:text-sidebar-foreground"
          aria-label="Clear thread search"
          onClick={() => {
            onClearSearch();
            if (teslaTouch) {
              setSearchOpen(false);
              return;
            }
            searchInputRef.current?.focus();
          }}
        >
          <XIcon className={teslaTouch ? "size-4" : "size-3"} />
        </Button>
      ) : null}
    </div>
  );

  if (teslaTouch) {
    return (
      <div className="flex min-w-0 flex-col gap-2.5">
        <button
          type="button"
          data-tesla-new-thread=""
          disabled={newThreadDisabled}
          onClick={onNewThread}
          className="flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-primary px-4 text-lg font-medium text-primary-foreground outline-none transition-transform duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
        >
          <SquarePenIcon className="size-5" aria-hidden />
          New thread
        </button>
        {showSearchField ? (
          searchField
        ) : (
          <button
            type="button"
            data-tesla-search=""
            onClick={() => setSearchOpen(true)}
            className="flex h-12 w-full items-center gap-2.5 rounded-xl border border-sidebar-border bg-sidebar-control-surface/40 px-3 text-base text-sidebar-muted-foreground outline-none transition-transform duration-150 ease-out active:scale-[0.98]"
          >
            <SearchIcon className="size-5 shrink-0" aria-hidden />
            Search threads
          </button>
        )}
        {scopeTitle != null ? (
          <div className="flex min-w-0 items-center gap-2 px-1 text-base font-medium text-sidebar-foreground">
            {scopeTitle}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-1">
        {searchField}
        {scopeTitle == null ? newThreadButton : null}
      </div>
      {scopeTitle != null ? (
        <div className="flex min-w-0 items-center gap-1">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2 text-xs font-medium text-sidebar-foreground">
            {scopeTitle}
          </div>
          {newThreadButton}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Button with a tooltip, sized for the sidebar toolbar. Spreads
 * unknown props through so it can serve as a popup trigger's render target,
 * which injects its own handlers, ref and aria state.
 */
export function SidebarHeaderIconButton({
  label,
  tooltip = label,
  className,
  children,
  ...rest
}: {
  /** Accessible name; also the tooltip unless `tooltip` says more. */
  label: string;
  tooltip?: ReactNode;
  className?: string | undefined;
  children?: ReactNode;
} & Omit<
  ComponentProps<typeof SidebarMenuButton>,
  "children" | "className" | "tooltip" | "isActive" | "aria-label"
>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <SidebarMenuButton
            size="icon"
            type="button"
            aria-label={label}
            {...rest}
            className={cn(
              "relative size-7 shrink-0 pointer-coarse:size-9 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
              className,
            )}
          />
        }
      >
        {children}
        {/* Coarse-pointer hit area, matching the rest of the sidebar chrome. */}
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        />
      </TooltipTrigger>
      <TooltipPopup side="top">{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
