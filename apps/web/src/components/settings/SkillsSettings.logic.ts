export const SKILL_ROW_EXIT_MS = 200;

export type SkillsSettingsTab = "library" | "machine" | "marketplace";

export const SKILLS_SETTINGS_TABS: ReadonlyArray<{
  readonly id: SkillsSettingsTab;
  readonly label: string;
  readonly searchTargetId: string;
}> = [
  { id: "library", label: "Library", searchTargetId: "skills-installed" },
  { id: "machine", label: "On this environment", searchTargetId: "skills-on-environment" },
  { id: "marketplace", label: "Marketplace", searchTargetId: "skills-marketplace" },
];

export function skillsTabForSearchTarget(targetId: string | null): SkillsSettingsTab | null {
  if (targetId === "skills-marketplace") return "marketplace";
  if (targetId === "skills-on-environment") return "machine";
  if (targetId === "skills-installed") return "library";
  return null;
}

export function skillTextMatches(query: string, parts: ReadonlyArray<string | undefined>): boolean {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) return true;
  return parts.some((part) => (part ?? "").toLowerCase().includes(normalized));
}

export function hostSkillCanUninstall(skill: {
  readonly canUninstall?: boolean | undefined;
  readonly kind?: string | undefined;
}): boolean {
  if (skill.canUninstall === false) return false;
  return skill.kind !== "plugin" && skill.kind !== "bundled" && skill.kind !== "system";
}

export function hostSkillKindLabel(kind: string | undefined): string | null {
  if (kind === "plugin") return "Plugin";
  if (kind === "bundled") return "Bundled";
  if (kind === "system") return "Built-in";
  return null;
}

export function originGroupId(origin: string): string {
  const slug = origin
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `skills-origin-${slug || "group"}`;
}

export function groupSkillRowsByOrigin<T extends { readonly skill: { readonly origin: string } }>(
  rows: ReadonlyArray<T>,
): Array<[string, T[]]> {
  const byOrigin = new Map<string, T[]>();
  for (const row of rows) {
    const group = byOrigin.get(row.skill.origin);
    if (group === undefined) {
      byOrigin.set(row.skill.origin, [row]);
    } else {
      group.push(row);
    }
  }
  return [...byOrigin.entries()];
}

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
