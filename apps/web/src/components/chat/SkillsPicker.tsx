/**
 * Composer footer control for per-thread skill picks.
 *
 * Enablement is a union of global (Settings → Skills, always on) and
 * per-thread picks. Global rows render checked and disabled — they can only
 * be turned off from settings. Per-thread picks toggle freely:
 *   - draft sessions write the composer draft store and ride
 *     `bootstrap.createThread.enabledSkillIds` on the first turn;
 *   - server threads dispatch `thread.skills.set` (full replacement) and the
 *     change materializes from the next turn.
 */
import { useAtomValue } from "@effect/atom-react";
import { useRouter } from "@tanstack/react-router";
import type { EnvironmentId, ScopedThreadRef, SkillId } from "@t3tools/contracts";
import { PackageIcon, SearchIcon } from "lucide-react";
import { memo, useId, useMemo, useState } from "react";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { skillsEnvironment } from "~/state/skills";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { MenuCheckboxItem, MenuGroup, MenuItem } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { ComposerControl, ComposerControlChevron, ComposerControlIcon } from "./ComposerControl";

const EMPTY_SKILL_IDS: ReadonlyArray<SkillId> = [];

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
}

function useSkillsPickerState(props: SkillsPickerProps) {
  const skillsQuery = useEnvironmentQuery(skillsEnvironment.skillsStateAtom(props.environmentId));
  const globallyEnabledSkills = useAtomValue(
    skillsEnvironment.globallyEnabledSkillsAtom(props.environmentId),
  );
  const draftEnabledSkillIds = useComposerDraftStore((store) =>
    props.draftId
      ? (store.getComposerDraft(props.draftId)?.enabledSkillIds ?? EMPTY_SKILL_IDS)
      : EMPTY_SKILL_IDS,
  );
  const setDraftEnabledSkillIds = useComposerDraftStore((store) => store.setEnabledSkillIds);
  const setThreadSkills = useAtomCommand(threadEnvironment.setThreadSkills, {
    reportFailure: false,
  });

  const installedSkills = useMemo(
    () => skillsQuery.data?.installedSkills ?? [],
    [skillsQuery.data],
  );
  const globallyEnabledIds = useMemo(
    () => new Set(globallyEnabledSkills.map((skill) => skill.id)),
    [globallyEnabledSkills],
  );
  const perThreadSkillIds = props.draftId
    ? draftEnabledSkillIds
    : (props.enabledSkillIds ?? EMPTY_SKILL_IDS);
  const perThreadIds = useMemo(() => new Set(perThreadSkillIds), [perThreadSkillIds]);
  // Count only installed skills so an uninstalled pick can't inflate the badge.
  const enabledCount = useMemo(
    () =>
      installedSkills.reduce(
        (count, skill) =>
          globallyEnabledIds.has(skill.id) || perThreadIds.has(skill.id) ? count + 1 : count,
        0,
      ),
    [globallyEnabledIds, installedSkills, perThreadIds],
  );
  const togglesEnabled = props.draftId !== undefined || props.enabledSkillIds !== undefined;

  const toggleSkill = (skillId: SkillId) => {
    if (globallyEnabledIds.has(skillId) || !togglesEnabled) {
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
      void setThreadSkills({
        environmentId: props.environmentId,
        input: { threadId: props.threadRef.threadId, enabledSkillIds: next },
      });
    }
  };

  return {
    installedSkills,
    globallyEnabledIds,
    perThreadIds,
    enabledCount,
    togglesEnabled,
    toggleSkill,
  };
}

type SkillsPickerState = ReturnType<typeof useSkillsPickerState>;

function filterInstalledSkills(
  installedSkills: SkillsPickerState["installedSkills"],
  search: string,
): SkillsPickerState["installedSkills"] {
  const query = search.trim().toLowerCase();
  if (query.length === 0) {
    return installedSkills;
  }
  return installedSkills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(query) ||
      (skill.description?.toLowerCase().includes(query) ?? false),
  );
}

export const SkillsPicker = memo(function SkillsPicker(props: SkillsPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const switchIdPrefix = useId();
  const router = useRouter();
  const state = useSkillsPickerState(props);
  const visibleSkills = filterInstalledSkills(state.installedSkills, search);

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) {
          setSearch("");
        }
      }}
    >
      <PopoverTrigger
        render={<ComposerControl variant="ghost" className="shrink-0 whitespace-nowrap" />}
      >
        <ComposerControlIcon icon={PackageIcon} />
        <span>Skills</span>
        {state.enabledCount > 0 ? (
          <Badge variant="secondary" size="sm" className="px-1 font-semibold">
            {state.enabledCount}
          </Badge>
        ) : null}
        <ComposerControlChevron />
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        className="w-80 max-w-full"
        viewportClassName="py-1.5 [--viewport-inline-padding:--spacing(1.5)]"
      >
        <div className="flex max-h-80 min-h-0 flex-col">
          <div className="shrink-0 px-1.5 pb-1.5">
            <div className="relative">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground/70"
              />
              <Input
                autoFocus
                size="sm"
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
                placeholder="Search skills…"
                aria-label="Search skills"
                className="[&_input]:ps-7.5"
              />
            </div>
          </div>
          {state.installedSkills.length === 0 ? (
            <div className="flex flex-col items-start gap-2 px-2.5 pt-1 pb-2">
              <p className="text-muted-foreground text-sm">No skills installed</p>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  setIsOpen(false);
                  // The settings route lands with the skills settings surface;
                  // it is not in the generated route tree yet, so navigate
                  // through the untyped history API instead of `Link`.
                  router.history.push("/settings/skills");
                }}
              >
                Open Skills settings
              </Button>
            </div>
          ) : visibleSkills.length === 0 ? (
            <p className="px-2.5 pt-1 pb-2 text-muted-foreground text-sm">No matching skills</p>
          ) : (
            <div className="min-h-0 overflow-y-auto px-1.5 pb-1">
              {visibleSkills.map((skill) => {
                const isGlobal = state.globallyEnabledIds.has(skill.id);
                const isEnabled = isGlobal || state.perThreadIds.has(skill.id);
                const switchId = `${switchIdPrefix}:${skill.id}`;
                return (
                  <label
                    key={skill.id}
                    htmlFor={switchId}
                    className={cn(
                      "flex items-center gap-3 rounded-sm px-2 py-1.5",
                      isGlobal || !state.togglesEnabled
                        ? "cursor-not-allowed"
                        : "cursor-pointer hover:bg-accent",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm">{skill.name}</span>
                        {isGlobal ? (
                          <Badge variant="outline" size="sm" className="text-muted-foreground">
                            Global
                          </Badge>
                        ) : null}
                      </span>
                      {skill.description ? (
                        <span className="block truncate text-muted-foreground/80 text-xs">
                          {skill.description}
                        </span>
                      ) : null}
                    </span>
                    <Switch
                      id={switchId}
                      checked={isEnabled}
                      disabled={isGlobal || !state.togglesEnabled}
                      onCheckedChange={() => state.toggleSkill(skill.id)}
                      aria-label={`Enable ${skill.name} for this thread`}
                      className="[--thumb-size:--spacing(3.5)]"
                    />
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
});

/**
 * Compact-layout variant of the picker: the same rows embedded in the
 * ellipsis menu (no search), mirroring how `TraitsMenuContent` collapses.
 */
export const SkillsMenuContent = memo(function SkillsMenuContent(props: SkillsPickerProps) {
  const state = useSkillsPickerState(props);
  return (
    <MenuGroup>
      <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">Skills</div>
      {state.installedSkills.length === 0 ? (
        <MenuItem disabled>No skills installed</MenuItem>
      ) : (
        state.installedSkills.map((skill) => {
          const isGlobal = state.globallyEnabledIds.has(skill.id);
          const isEnabled = isGlobal || state.perThreadIds.has(skill.id);
          return (
            <MenuCheckboxItem
              key={skill.id}
              variant="switch"
              checked={isEnabled}
              disabled={isGlobal || !state.togglesEnabled}
              closeOnClick={false}
              onCheckedChange={() => state.toggleSkill(skill.id)}
            >
              <span className="min-w-0 truncate">
                {skill.name}
                {isGlobal ? <span className="text-muted-foreground/80"> · Global</span> : null}
              </span>
            </MenuCheckboxItem>
          );
        })
      )}
    </MenuGroup>
  );
});
