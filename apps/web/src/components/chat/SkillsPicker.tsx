/**
 * Composer `⋯ → Skills` submenu: which skills ride along with this thread.
 *
 * The environment reports one inventory of skill folders, and these switches
 * are purely a per-thread attach: T3 sends the picked skills' instructions
 * with the thread's first turn, and again after a provider handoff. Nothing
 * here changes what the CLI can reach on its own — a skill the provider should
 * be able to invoke itself (`$mention`, `/slash`) is linked into that CLI's
 * folder from Settings → Skills.
 *   - draft sessions write the composer draft store and ride
 *     `bootstrap.createThread.enabledSkillIds` on the first turn;
 *   - server threads dispatch `thread.skills.set` (full replacement) and the
 *     change materializes from the next turn.
 * Threads picked before the library rewrite hold pre-library ids; those are
 * folded onto library ids for the checked state and written back folded on the
 * first toggle. The search filters by name and description, and starred skills
 * pin to a Favorites group (client setting).
 */
import { useRouter } from "@tanstack/react-router";
import type { EnvironmentId, ScopedThreadRef, Skill, SkillId } from "@t3tools/contracts";
import { normalizeSkillId } from "@t3tools/shared/skillTool";
import { PackageIcon, StarIcon } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { useOptimisticIdList } from "~/hooks/useOptimisticIdList";
import { useClientSettings, useUpdateClientSettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { skillsEnvironment } from "~/state/skills";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
} from "../ui/menu";

const EMPTY_SKILL_IDS: ReadonlyArray<SkillId> = [];
/** Shorter lists read fine without a filter, and the input costs a row of height. */
const SEARCH_MIN_SKILLS = 8;

export interface SkillsPickerProps {
  environmentId: EnvironmentId;
  /** Server-thread target — toggles dispatch `thread.skills.set`. */
  threadRef?: ScopedThreadRef | undefined;
  /**
   * Per-thread picks of the server thread (orchestration read model). While
   * the thread is still loading this is undefined and toggles stay disabled —
   * a full-replacement write computed from an unloaded set would drop picks.
   */
  enabledSkillIds?: ReadonlyArray<SkillId> | undefined;
  /** Draft-session target — toggles write the composer draft store. */
  draftId?: DraftId | undefined;
  /** Controlled submenu state, so `/skills` can open this list. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export interface PickerSkill {
  readonly id: SkillId;
  readonly name: string;
  /** Frontmatter description, or the folder as a stand-in. Searchable either way. */
  readonly description: string;
}

export function toPickerSkills(skills: ReadonlyArray<Skill>): PickerSkill[] {
  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description ?? skill.displayPath,
  }));
}

/**
 * Fold pre-library picks (`owner/repo:path/to/dir`) onto the library ids the
 * server reports today, dropping the duplicates that folding can create.
 */
export function normalizePickedSkillIds(ids: ReadonlyArray<SkillId>): SkillId[] {
  return [...new Set(ids.map(normalizeSkillId))];
}

export function skillMatchesQuery(
  skill: Pick<PickerSkill, "name" | "description">,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  return [skill.name, skill.description].some((value) => value.toLowerCase().includes(normalized));
}

/** Favorites pin to the top (still in list order); the search filters both halves. */
export function organizePickerSkills(
  skills: ReadonlyArray<PickerSkill>,
  favoriteIds: ReadonlySet<string>,
  query = "",
): { favorites: PickerSkill[]; rest: PickerSkill[] } {
  const favorites: PickerSkill[] = [];
  const rest: PickerSkill[] = [];
  for (const skill of skills) {
    if (!skillMatchesQuery(skill, query)) {
      continue;
    }
    (favoriteIds.has(skill.id) ? favorites : rest).push(skill);
  }
  return { favorites, rest };
}

function useSkillsPickerState(props: SkillsPickerProps) {
  const skillsQuery = useEnvironmentQuery(skillsEnvironment.skillsStateAtom(props.environmentId));
  const draftEnabledSkillIds = useComposerDraftStore((store) =>
    props.draftId
      ? (store.getComposerDraft(props.draftId)?.enabledSkillIds ?? EMPTY_SKILL_IDS)
      : EMPTY_SKILL_IDS,
  );
  const setDraftEnabledSkillIds = useComposerDraftStore((store) => store.setEnabledSkillIds);
  const setThreadSkills = useAtomCommand(threadEnvironment.setThreadSkills, "thread skills update");
  // Server-thread picks are replaced wholesale, and the read model echoes a
  // write back a round trip later: chain toggles off the last list sent so a
  // second flip does not clobber the first, and move the switch right away.
  const {
    ids: threadSkillIds,
    setIds: setThreadSkillIds,
    reset: resetThreadSkillIds,
  } = useOptimisticIdList(
    props.enabledSkillIds ?? EMPTY_SKILL_IDS,
    `${props.environmentId}:${props.threadRef?.threadId ?? ""}`,
  );

  const inventory = skillsQuery.data?.skills;
  const skills = useMemo(() => toPickerSkills(inventory ?? []), [inventory]);
  const rawPickedIds = props.draftId ? draftEnabledSkillIds : threadSkillIds;
  const pickedIds = useMemo(() => normalizePickedSkillIds(rawPickedIds), [rawPickedIds]);
  const pickedIdSet = useMemo(() => new Set(pickedIds), [pickedIds]);
  // Badge counts what this thread attaches; a pick whose skill has since gone
  // away from the environment does not count.
  const enabledCount = useMemo(
    () => skills.reduce((count, skill) => (pickedIdSet.has(skill.id) ? count + 1 : count), 0),
    [pickedIdSet, skills],
  );
  const togglesEnabled = props.draftId !== undefined || props.enabledSkillIds !== undefined;

  const toggleSkill = (skillId: SkillId) => {
    if (!togglesEnabled) {
      return;
    }
    // Writing the normalized list means a thread carrying pre-library ids
    // converges the first time anyone touches this menu.
    const next = pickedIdSet.has(skillId)
      ? pickedIds.filter((id) => id !== skillId)
      : [...pickedIds, skillId];
    if (props.draftId) {
      setDraftEnabledSkillIds(props.draftId, next.length > 0 ? next : undefined);
      return;
    }
    if (props.threadRef) {
      setThreadSkillIds(next);
      void setThreadSkills({
        environmentId: props.environmentId,
        input: { threadId: props.threadRef.threadId, enabledSkillIds: next },
      }).then((result) => {
        if (result._tag === "Failure") {
          resetThreadSkillIds(next);
        }
      });
    }
  };

  return {
    skills,
    isLoading: inventory === undefined,
    pickedIdSet,
    enabledCount,
    togglesEnabled,
    toggleSkill,
  };
}

/** One picker row: the switch attaches the skill, the star pins it to Favorites. */
function SkillPickerRow(props: {
  skill: PickerSkill;
  isEnabled: boolean;
  isFavorite: boolean;
  disabled: boolean;
  onToggle: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <MenuCheckboxItem
      checked={props.isEnabled}
      className="min-h-6 gap-2 py-0.5 sm:min-h-6"
      closeOnClick={false}
      disabled={props.disabled}
      onCheckedChange={props.onToggle}
      variant="switch"
    >
      <span className="flex min-w-0 items-center gap-1">
        <Button
          aria-label={props.isFavorite ? "Remove from favorites" : "Add to favorites"}
          className={cn(
            "text-muted-foreground/70 opacity-70 hover:text-foreground hover:opacity-100",
            props.isFavorite && "text-foreground opacity-100",
          )}
          disabled={props.disabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (props.disabled) {
              return;
            }
            props.onToggleFavorite();
          }}
          onKeyDown={(event) => {
            if (event.key === " " || event.key === "Enter") {
              event.stopPropagation();
            }
          }}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          size="icon-micro"
          variant="ghost"
        >
          <StarIcon className={cn(props.isFavorite && "fill-current text-yellow-500")} />
        </Button>
        <span className="min-w-0 truncate">{props.skill.name}</span>
      </span>
    </MenuCheckboxItem>
  );
}

/**
 * `Skills ▸` row of the composer's `⋯` menu: the trigger carries the count of
 * skills attached to this thread, the submenu lists the environment's skills.
 */
export const SkillsSubmenu = memo(function SkillsSubmenu(props: SkillsPickerProps) {
  const router = useRouter();
  const state = useSkillsPickerState(props);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const favoriteSkillIds = useClientSettings((settings) => settings.favoriteSkillIds);
  const updateClientSettings = useUpdateClientSettings();
  const favoriteIds = useMemo(() => new Set(favoriteSkillIds), [favoriteSkillIds]);
  const { favorites, rest } = useMemo(
    () => organizePickerSkills(state.skills, favoriteIds, searchQuery),
    [favoriteIds, searchQuery, state.skills],
  );
  const hasQuery = searchQuery.trim().length > 0;
  const showSearch = state.skills.length > SEARCH_MIN_SKILLS;

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSearchQuery("");
    }
    props.onOpenChange?.(open);
  };

  const toggleFavorite = (skillId: SkillId) => {
    const next = favoriteIds.has(skillId)
      ? favoriteSkillIds.filter((id) => id !== skillId)
      : [...favoriteSkillIds, skillId];
    updateClientSettings({ favoriteSkillIds: next });
  };

  const renderRow = (skill: PickerSkill) => (
    <SkillPickerRow
      key={skill.id}
      skill={skill}
      isEnabled={state.pickedIdSet.has(skill.id)}
      isFavorite={favoriteIds.has(skill.id)}
      disabled={!state.togglesEnabled}
      onToggle={() => state.toggleSkill(skill.id)}
      onToggleFavorite={() => toggleFavorite(skill.id)}
    />
  );

  useLayoutEffect(() => {
    if (props.open !== true || !showSearch) {
      return;
    }
    const focusSearch = () => searchInputRef.current?.focus({ preventScroll: true });
    focusSearch();
    const frame = window.requestAnimationFrame(focusSearch);
    return () => window.cancelAnimationFrame(frame);
  }, [props.open, showSearch]);

  return (
    <MenuSub open={props.open} onOpenChange={handleOpenChange}>
      <MenuSubTrigger>
        <PackageIcon aria-hidden="true" />
        <span>Skills</span>
        {state.enabledCount > 0 ? (
          <Badge variant="secondary" size="sm" className="px-1 font-semibold">
            {state.enabledCount}
          </Badge>
        ) : null}
      </MenuSubTrigger>
      <MenuSubPopup className="min-w-0 w-72 max-w-full">
        {state.isLoading ? (
          <MenuItem disabled>Loading skills…</MenuItem>
        ) : state.skills.length === 0 ? (
          <>
            <MenuItem disabled>No skills on this environment</MenuItem>
            <MenuItem
              onClick={() => {
                // The settings route lands with the skills settings surface;
                // it is not in the generated route tree yet, so navigate
                // through the untyped history API instead of `Link`.
                router.history.push("/settings/skills");
              }}
            >
              Open Skills settings
            </MenuItem>
          </>
        ) : (
          <>
            {showSearch ? (
              <div className="sticky -top-1 z-10 -mx-1 mb-0.5 border-b border-border/50 bg-popover px-1.5 pt-1 pb-1">
                <Input
                  ref={searchInputRef}
                  aria-label="Search skills"
                  nativeInput
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") {
                      event.stopPropagation();
                    }
                  }}
                  placeholder="Search skills…"
                  size="compact"
                  type="search"
                  value={searchQuery}
                />
              </div>
            ) : null}
            {favorites.length === 0 && rest.length === 0 ? (
              <MenuItem disabled>{hasQuery ? "No matching skills" : "No skills"}</MenuItem>
            ) : (
              <>
                {favorites.length > 0 ? (
                  <MenuGroup>
                    <MenuGroupLabel className="py-1">Favorites</MenuGroupLabel>
                    {favorites.map(renderRow)}
                  </MenuGroup>
                ) : null}
                {rest.length > 0 ? (
                  <MenuGroup>
                    {favorites.length > 0 ? (
                      <MenuGroupLabel className="py-1">All skills</MenuGroupLabel>
                    ) : null}
                    {rest.map(renderRow)}
                  </MenuGroup>
                ) : null}
              </>
            )}
          </>
        )}
      </MenuSubPopup>
    </MenuSub>
  );
});
