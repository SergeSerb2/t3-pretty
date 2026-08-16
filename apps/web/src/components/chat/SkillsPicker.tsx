/**
 * Composer `⋯` menu section for per-thread skill picks.
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
import { PackageIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { useOptimisticIdList } from "~/hooks/useOptimisticIdList";
import { useEnvironmentQuery } from "~/state/query";
import { skillsEnvironment } from "~/state/skills";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { Badge } from "../ui/badge";
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

/**
 * `Skills ▸` row of the composer's `⋯` menu: the trigger carries the enabled
 * count, the submenu lists library and host skills as switches.
 */
export const SkillsSubmenu = memo(function SkillsSubmenu(props: SkillsPickerProps) {
  const router = useRouter();
  const state = useSkillsPickerState(props);
  const groups = groupSkills(state.skills);

  return (
    <MenuSub open={props.open} onOpenChange={props.onOpenChange}>
      <MenuSubTrigger>
        <PackageIcon aria-hidden="true" />
        <span>Skills</span>
        {state.enabledCount > 0 ? (
          <Badge variant="secondary" size="sm" className="px-1 font-semibold">
            {state.enabledCount}
          </Badge>
        ) : null}
      </MenuSubTrigger>
      <MenuSubPopup className="w-72 max-w-full">
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
          groups.map(([group, groupSkills]) => (
            <MenuGroup key={group}>
              <MenuGroupLabel>{group}</MenuGroupLabel>
              {groupSkills.map((skill) => {
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
                      {skill.locked ? (
                        <span className="text-muted-foreground/80"> · Global</span>
                      ) : null}
                    </span>
                  </MenuCheckboxItem>
                );
              })}
            </MenuGroup>
          ))
        )}
      </MenuSubPopup>
    </MenuSub>
  );
});
