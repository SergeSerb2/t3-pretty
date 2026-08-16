/**
 * Composer `⋯` menu section for per-thread skill picks.
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
import { PackageIcon } from "lucide-react";
import { memo, useMemo } from "react";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { useOptimisticIdList } from "~/hooks/useOptimisticIdList";
import { useEnvironmentQuery } from "~/state/query";
import { skillsEnvironment } from "~/state/skills";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { Badge } from "../ui/badge";
import { MenuCheckboxItem, MenuItem, MenuSub, MenuSubPopup, MenuSubTrigger } from "../ui/menu";

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

  const installedSkills = useMemo(
    () => skillsQuery.data?.installedSkills ?? [],
    [skillsQuery.data],
  );
  const globallyEnabledIds = useMemo(
    () => new Set(globallyEnabledSkills.map((skill) => skill.id)),
    [globallyEnabledSkills],
  );
  const perThreadSkillIds = props.draftId ? draftEnabledSkillIds : threadSkillIds;
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
    installedSkills,
    globallyEnabledIds,
    perThreadIds,
    enabledCount,
    togglesEnabled,
    toggleSkill,
  };
}

/**
 * `Skills ▸` row of the composer's `⋯` menu: the trigger carries the enabled
 * count, the submenu lists installed skills as switches.
 */
export const SkillsSubmenu = memo(function SkillsSubmenu(props: SkillsPickerProps) {
  const router = useRouter();
  const state = useSkillsPickerState(props);
  return (
    <MenuSub>
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
        {state.installedSkills.length === 0 ? (
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
      </MenuSubPopup>
    </MenuSub>
  );
});
