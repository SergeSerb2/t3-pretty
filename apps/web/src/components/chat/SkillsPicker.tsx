/**
 * Composer `⋯` menu section for per-thread skill picks.
 *
 * Lists every skill the environment knows about: the T3 library (Settings →
 * Skills → Installed) plus the skills each provider CLI keeps in its own home
 * folder (Settings → Skills → On this environment). Enablement is a union of
 * global picks and per-thread picks. Rows that are already on regardless of
 * this thread render checked with a dimmed switch — library skills enabled
 * globally, and host skills the selected instance loads from its own home
 * anyway; both are only turned off from settings. The row stays enabled so
 * the favorite star works for mouse and keyboard. Everything else toggles
 * per thread:
 *   - draft sessions write the composer draft store and ride
 *     `bootstrap.createThread.enabledSkillIds` on the first turn;
 *   - server threads dispatch `thread.skills.set` (full replacement) and the
 *     change materializes from the next turn.
 * Host ids (`host:…`) ride the same `enabledSkillIds` list; the server copies
 * the folder into the workspace like a library skill. The picker search filters
 * by name/origin, and starred skills pin to a Favorites group (client setting).
 */
import { useAtomValue } from "@effect/atom-react";
import { useRouter } from "@tanstack/react-router";
import {
  defaultInstanceIdForDriver,
  type EnvironmentId,
  type HostSkill,
  type InstalledSkill,
  type ProviderInstanceId,
  type ScopedThreadRef,
  type SkillId,
} from "@t3tools/contracts";
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

export interface SkillsPickerProps {
  environmentId: EnvironmentId;
  /** Instance of the thread; its own home-folder host skills are already loaded and lock on. */
  selectedInstanceId: ProviderInstanceId;
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
  readonly description: string | undefined;
  /** Section header: "Library" for the T3 store, the origin for host skills. */
  readonly group: string;
  /** Checked and disabled — enabled outside this thread (settings). */
  readonly locked: boolean;
}

const LIBRARY_GROUP = "Library";

/** True when this host skill lives in the selected instance's own CLI home. */
function hostSkillBelongsToInstance(
  skill: HostSkill,
  selectedInstanceId: ProviderInstanceId,
): boolean {
  if (skill.driver === undefined) {
    return false;
  }
  // Default home roots omit instanceId; treat them as the driver's default instance.
  const skillInstanceId = skill.instanceId ?? defaultInstanceIdForDriver(skill.driver);
  return skillInstanceId === selectedInstanceId;
}

export function toPickerSkills(
  installedSkills: ReadonlyArray<InstalledSkill>,
  hostSkills: ReadonlyArray<HostSkill>,
  globallyEnabledIds: ReadonlySet<SkillId>,
  selectedInstanceId: ProviderInstanceId,
): PickerSkill[] {
  const library = installedSkills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    group: LIBRARY_GROUP,
    locked: globallyEnabledIds.has(skill.id),
  }));
  // A host skill that is on in the selected instance's own home is loaded by
  // that CLI no matter what this thread picks. Shared `~/.agents/skills` has
  // no driver, so it stays toggleable — copying it into the workspace is the
  // only lever we hold, and a duplicate is harmless where the CLI already
  // reads it. Sibling instances of the same driver (different homes) stay
  // toggleable too — their folders are not on this CLI's search path.
  const host = hostSkills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description ?? skill.displayPath,
    group: skill.origin,
    locked: skill.enabled && hostSkillBelongsToInstance(skill, selectedInstanceId),
  }));
  return [...library, ...host];
}

function useSkillsPickerState(props: SkillsPickerProps) {
  const skillsQuery = useEnvironmentQuery(skillsEnvironment.skillsStateAtom(props.environmentId));
  const hostSkillsQuery = useEnvironmentQuery(
    skillsEnvironment.hostSkillsStateAtom(props.environmentId),
  );
  const globallyEnabledSkills = useAtomValue(
    skillsEnvironment.globallyEnabledSkillsAtom(props.environmentId),
  );
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

  const globallyEnabledIds = useMemo(
    () => new Set(globallyEnabledSkills.map((skill) => skill.id)),
    [globallyEnabledSkills],
  );
  const installedSkills = skillsQuery.data?.installedSkills;
  const hostSkills = hostSkillsQuery.data?.skills;
  const skills = useMemo(
    () =>
      toPickerSkills(
        installedSkills ?? [],
        hostSkills ?? [],
        globallyEnabledIds,
        props.selectedInstanceId,
      ),
    [globallyEnabledIds, hostSkills, installedSkills, props.selectedInstanceId],
  );
  const lockedIds = useMemo(
    () => new Set(skills.filter((skill) => skill.locked).map((skill) => skill.id)),
    [skills],
  );
  const perThreadSkillIds = props.draftId ? draftEnabledSkillIds : threadSkillIds;
  const perThreadIds = useMemo(() => new Set(perThreadSkillIds), [perThreadSkillIds]);
  // Badge counts what T3 adds to the thread: global library picks plus this
  // thread's own picks. Host skills the provider loads anyway don't count,
  // and neither does a pick whose skill has since gone away.
  const enabledCount = useMemo(
    () =>
      skills.reduce(
        (count, skill) =>
          globallyEnabledIds.has(skill.id) || (!skill.locked && perThreadIds.has(skill.id))
            ? count + 1
            : count,
        0,
      ),
    [globallyEnabledIds, perThreadIds, skills],
  );
  const togglesEnabled = props.draftId !== undefined || props.enabledSkillIds !== undefined;

  const toggleSkill = (skillId: SkillId) => {
    if (lockedIds.has(skillId) || !togglesEnabled) {
      return;
    }
    const next = perThreadIds.has(skillId)
      ? perThreadSkillIds.filter((id) => id !== skillId)
      : [...perThreadSkillIds, skillId];
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
    isLoading: installedSkills === undefined && hostSkills === undefined,
    perThreadIds,
    enabledCount,
    togglesEnabled,
    toggleSkill,
  };
}

/** Rows keep their order; a header is emitted where the group changes. */
function groupSkills(skills: ReadonlyArray<PickerSkill>): Array<[string, PickerSkill[]]> {
  const groups: Array<[string, PickerSkill[]]> = [];
  for (const skill of skills) {
    const last = groups[groups.length - 1];
    if (last && last[0] === skill.group) {
      last[1].push(skill);
    } else {
      groups.push([skill.group, [skill]]);
    }
  }
  return groups;
}

export const FAVORITES_GROUP = "Favorites";

export function skillMatchesQuery(
  skill: Pick<PickerSkill, "name" | "description" | "group">,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  return [skill.name, skill.group, skill.description ?? ""].some((value) =>
    value.toLowerCase().includes(normalized),
  );
}

/** Favorites first (still in list order), then origin groups. Search filters both. */
export function organizePickerSkills(
  skills: ReadonlyArray<PickerSkill>,
  favoriteIds: ReadonlySet<string>,
  query = "",
): Array<[string, PickerSkill[]]> {
  const visible = skills.filter((skill) => skillMatchesQuery(skill, query));
  const favorites: PickerSkill[] = [];
  const rest: PickerSkill[] = [];
  for (const skill of visible) {
    if (favoriteIds.has(skill.id)) {
      favorites.push(skill);
    } else {
      rest.push(skill);
    }
  }
  const groups = groupSkills(rest);
  return favorites.length > 0 ? [[FAVORITES_GROUP, favorites], ...groups] : groups;
}

/** One picker row: locked skills keep the switch off-limits but the star works. */
export function SkillPickerRow(props: {
  skill: PickerSkill;
  isEnabled: boolean;
  isFavorite: boolean;
  disabled: boolean;
  onToggle: () => void;
  onToggleFavorite: () => void;
}) {
  const { skill } = props;
  return (
    <MenuCheckboxItem
      checked={props.isEnabled}
      className={cn(
        "min-h-6 gap-2 py-0.5 sm:min-h-6",
        // Locked means the enable switch is off-limits, not the row. Keeping
        // the item enabled leaves the star in the keyboard/AT order.
        skill.locked && "[&>:last-child]:opacity-64",
      )}
      closeOnClick={false}
      disabled={props.disabled}
      // Locked rows stay enabled for the star. Omitting onCheckedChange still
      // lets the menu primitive toggle data-state on click/Space/Enter — cancel
      // the change and swallow the item click so only the star is interactive.
      onCheckedChange={
        skill.locked
          ? (_checked, details) => {
              details?.cancel?.();
            }
          : props.onToggle
      }
      onClick={
        skill.locked
          ? (event) => {
              event.preventDefault();
            }
          : undefined
      }
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
        <span className="min-w-0 truncate">{skill.name}</span>
        {skill.locked ? (
          <span className="shrink-0 text-[10px] text-muted-foreground/80">Global</span>
        ) : null}
      </span>
    </MenuCheckboxItem>
  );
}

/**
 * `Skills ▸` row of the composer's `⋯` menu: the trigger carries the enabled
 * count, the submenu lists library and host skills as switches.
 */
export const SkillsSubmenu = memo(function SkillsSubmenu(props: SkillsPickerProps) {
  const router = useRouter();
  const state = useSkillsPickerState(props);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const favoriteSkillIds = useClientSettings((settings) => settings.favoriteSkillIds);
  const updateClientSettings = useUpdateClientSettings();
  const favoriteIds = useMemo(() => new Set(favoriteSkillIds), [favoriteSkillIds]);
  const groups = useMemo(
    () => organizePickerSkills(state.skills, favoriteIds, searchQuery),
    [favoriteIds, searchQuery, state.skills],
  );
  const hasQuery = searchQuery.trim().length > 0;

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

  useLayoutEffect(() => {
    if (props.open !== true) {
      return;
    }
    const focusSearch = () => searchInputRef.current?.focus({ preventScroll: true });
    focusSearch();
    const frame = window.requestAnimationFrame(focusSearch);
    return () => window.cancelAnimationFrame(frame);
  }, [props.open]);

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
            <MenuItem disabled>No skills installed</MenuItem>
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
            {groups.length === 0 ? (
              <MenuItem disabled>
                {hasQuery ? "No matching skills" : "No skills installed"}
              </MenuItem>
            ) : (
              groups.map(([group, groupSkills]) => (
                <MenuGroup key={group}>
                  <MenuGroupLabel className="py-1">{group}</MenuGroupLabel>
                  {groupSkills.map((skill) => (
                    <SkillPickerRow
                      key={skill.id}
                      skill={skill}
                      isEnabled={skill.locked || state.perThreadIds.has(skill.id)}
                      isFavorite={favoriteIds.has(skill.id)}
                      disabled={!state.togglesEnabled}
                      onToggle={() => state.toggleSkill(skill.id)}
                      onToggleFavorite={() => toggleFavorite(skill.id)}
                    />
                  ))}
                </MenuGroup>
              ))
            )}
          </>
        )}
      </MenuSubPopup>
    </MenuSub>
  );
});
