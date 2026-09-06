import { skillLinkedAt, skillVisibleAt } from "@t3tools/client-runtime/state/skills";
import type { Skill, SkillLocation } from "@t3tools/contracts";

export const SKILL_ROW_EXIT_MS = 200;

export interface Identified {
  readonly id: string;
}

export interface SkillRowView<T extends Identified> {
  readonly skill: T;
  readonly exiting: boolean;
}

export function pruneHiddenSkillIds(
  hiddenIds: ReadonlySet<string>,
  liveIds: ReadonlySet<string>,
): ReadonlySet<string> {
  let changed = false;
  const next = new Set<string>();
  for (const id of hiddenIds) {
    if (liveIds.has(id)) {
      next.add(id);
    } else {
      changed = true;
    }
  }
  return changed ? next : hiddenIds;
}

export function retainedSkillIds<T extends Identified>(
  serverSkills: ReadonlyArray<T>,
  exiting: ReadonlyMap<string, T>,
): ReadonlySet<string> {
  const retained = new Set<string>();
  for (const skill of serverSkills) {
    retained.add(skill.id);
  }
  for (const id of exiting.keys()) {
    retained.add(id);
  }
  return retained;
}

export function nextSkillOrderIds(
  previousOrder: ReadonlyArray<string>,
  serverIds: ReadonlyArray<string>,
  retainedIds: ReadonlySet<string>,
): ReadonlyArray<string> {
  const next: string[] = [];
  const used = new Set<string>();
  for (const id of previousOrder) {
    if (retainedIds.has(id) && !used.has(id)) {
      next.push(id);
      used.add(id);
    }
  }
  for (const id of serverIds) {
    if (retainedIds.has(id) && !used.has(id)) {
      next.push(id);
      used.add(id);
    }
  }
  return next;
}

export function displaySkillRows<T extends Identified>(
  serverSkills: ReadonlyArray<T>,
  hiddenIds: ReadonlySet<string>,
  exiting: ReadonlyMap<string, T>,
  orderIds: ReadonlyArray<string>,
): ReadonlyArray<SkillRowView<T>> {
  const serverById = new Map(serverSkills.map((skill) => [skill.id, skill] as const));
  const rows: Array<SkillRowView<T>> = [];
  const used = new Set<string>();
  for (const id of orderIds) {
    const exitingSkill = exiting.get(id);
    if (exitingSkill !== undefined) {
      rows.push({ skill: exitingSkill, exiting: true });
      used.add(id);
      continue;
    }
    if (hiddenIds.has(id)) {
      used.add(id);
      continue;
    }
    const serverSkill = serverById.get(id);
    if (serverSkill !== undefined) {
      rows.push({ skill: serverSkill, exiting: false });
      used.add(id);
    }
  }
  for (const skill of serverSkills) {
    if (used.has(skill.id) || hiddenIds.has(skill.id) || exiting.has(skill.id)) {
      continue;
    }
    rows.push({ skill, exiting: false });
  }
  return rows;
}

export function finishTombstoneExit<T extends Identified>(
  exiting: ReadonlyMap<string, T>,
  skillId: string,
): ReadonlyMap<string, T> {
  if (!exiting.has(skillId)) return exiting;
  const next = new Map(exiting);
  next.delete(skillId);
  return next;
}

/**
 * How one provider chip reads for a (skill, location) pair. `home` and
 * `inherited` are locked: the first because the folder lives there, the second
 * because the CLI already sees the skill through a folder it also reads.
 */
export type SkillChipState = "home" | "linked" | "inherited" | "off";

export function skillChipState(
  skill: Skill,
  location: SkillLocation,
  linkedOverride?: boolean,
): SkillChipState {
  if (location.key === skill.home) return "home";
  if (linkedOverride ?? skillLinkedAt(skill, location)) return "linked";
  // A pending unlink has to be taken out of `presentIn` before asking whether
  // the CLI can still see the skill some other way.
  const withoutLink =
    linkedOverride === false
      ? { ...skill, presentIn: skill.presentIn.filter((key) => key !== location.key) }
      : skill;
  return skillVisibleAt(withoutLink, location) ? "inherited" : "off";
}

/** Optimistic chip key; skill ids and location keys never contain a newline. */
export function linkOverrideKey(skillId: string, locationKey: string): string {
  return `${skillId}\n${locationKey}`;
}

/**
 * Drops optimistic chip states the refreshed inventory has caught up with (or
 * whose skill is gone), so the list falls back to server truth on its own.
 */
export function pruneSettledLinkOverrides(
  overrides: ReadonlyMap<string, boolean>,
  skills: ReadonlyArray<Skill>,
): ReadonlyMap<string, boolean> {
  if (overrides.size === 0) return overrides;
  const byId = new Map(skills.map((skill) => [skill.id, skill] as const));
  const next = new Map<string, boolean>();
  for (const [key, linked] of overrides) {
    const separator = key.indexOf("\n");
    const skill = byId.get(key.slice(0, separator));
    if (skill !== undefined && skill.presentIn.includes(key.slice(separator + 1)) !== linked) {
      next.set(key, linked);
    }
  }
  return next.size === overrides.size ? overrides : next;
}
