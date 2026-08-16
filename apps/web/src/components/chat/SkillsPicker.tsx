/**
 * Composer footer control for per-thread skill picks.
 *
 * Lists every skill the environment knows about: the T3 library (Settings →
 * Skills → Installed) plus the skills each provider CLI keeps in its own home
 * folder (Settings → Skills → On this environment). Enablement is a union of
 * global picks and per-thread picks. Rows that are already on regardless of
 * this thread render checked and disabled — library skills enabled globally,
 * and host skills the selected instance loads from its own home anyway; both
 * are only turned off from settings. Everything else toggles per thread:
 *   - draft sessions write the composer draft store and ride
 *     `bootstrap.createThread.enabledSkillIds` on the first turn;
 *   - server threads dispatch `thread.skills.set` (full replacement) and the
 *     change materializes from the next turn.
 * Host ids (`host:…`) ride the same `enabledSkillIds` list; the server copies
 * the folder into the workspace like a library skill.
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
import { PackageIcon, SearchIcon } from "lucide-react";
import { memo, useId, useMemo, useState } from "react";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { useOptimisticIdList } from "~/hooks/useOptimisticIdList";
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
  /** Controlled popover state, so `/skills` can open the picker. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface PickerSkill {
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
          resetThreadSkillIds();
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

function filterSkills(skills: ReadonlyArray<PickerSkill>, search: string): PickerSkill[] {
  const query = search.trim().toLowerCase();
  if (query.length === 0) {
    return [...skills];
  }
  return skills.filter(
    (skill) =>
      skill.name.toLowerCase().includes(query) ||
      skill.group.toLowerCase().includes(query) ||
      (skill.description?.toLowerCase().includes(query) ?? false),
  );
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

export const SkillsPicker = memo(function SkillsPicker(props: SkillsPickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = props.open ?? uncontrolledOpen;
  const setIsOpen = (open: boolean) => {
    setUncontrolledOpen(open);
    props.onOpenChange?.(open);
  };
  const [search, setSearch] = useState("");
  const switchIdPrefix = useId();
  const router = useRouter();
  const state = useSkillsPickerState(props);
  const visibleGroups = groupSkills(filterSkills(state.skills, search));

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
          {state.isLoading ? (
            <p className="px-2.5 pt-1 pb-2 text-muted-foreground text-sm">Loading skills…</p>
          ) : state.skills.length === 0 ? (
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
          ) : visibleGroups.length === 0 ? (
            <p className="px-2.5 pt-1 pb-2 text-muted-foreground text-sm">No matching skills</p>
          ) : (
            <div className="min-h-0 overflow-y-auto px-1.5 pb-1">
              {visibleGroups.map(([group, groupSkills]) => (
                <div key={group}>
                  <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {group}
                  </div>
                  {groupSkills.map((skill) => {
                    const isEnabled = skill.locked || state.perThreadIds.has(skill.id);
                    const switchId = `${switchIdPrefix}:${skill.id}`;
                    return (
                      <label
                        key={skill.id}
                        htmlFor={switchId}
                        className={cn(
                          "flex items-center gap-3 rounded-sm px-2 py-1.5",
                          skill.locked || !state.togglesEnabled
                            ? "cursor-not-allowed"
                            : "cursor-pointer hover:bg-accent",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm">{skill.name}</span>
                            {skill.locked ? (
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
                          disabled={skill.locked || !state.togglesEnabled}
                          onCheckedChange={() => state.toggleSkill(skill.id)}
                          aria-label={`Enable ${skill.name} for this thread`}
                          className="[--thumb-size:--spacing(3.5)]"
                        />
                      </label>
                    );
                  })}
                </div>
              ))}
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
      {state.skills.length === 0 ? (
        <MenuItem disabled>No skills installed</MenuItem>
      ) : (
        state.skills.map((skill) => {
          const isEnabled = skill.locked || state.perThreadIds.has(skill.id);
          return (
            <MenuCheckboxItem
              key={skill.id}
              variant="switch"
              checked={isEnabled}
              disabled={skill.locked || !state.togglesEnabled}
              closeOnClick={false}
              onCheckedChange={() => state.toggleSkill(skill.id)}
            >
              <span className="min-w-0 truncate">
                {skill.name}
                <span className="text-muted-foreground/80">
                  {" · "}
                  {skill.group}
                  {skill.locked ? " · Global" : ""}
                </span>
              </span>
            </MenuCheckboxItem>
          );
        })
      )}
    </MenuGroup>
  );
});
