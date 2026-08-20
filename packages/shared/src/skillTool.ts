/**
 * Shared skill-tool detection for provider adapters and the thread log.
 *
 * Claude Code and Cursor surface skill loading as a tool-shaped
 * event, but the names and payloads differ. Keep the match tight: a generic
 * `name` field is too common to treat as a skill id.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function compactToolName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

/** True when a provider tool name/kind is the Skill loader, not an incidental substring. */
export function isSkillToolName(value: string): boolean {
  const compact = compactToolName(value);
  return compact === "skill" || compact === "skills" || compact === "loadskill";
}

export function skillNameFromToolInput(input: unknown): string | undefined {
  const record = asRecord(input);
  if (!record) {
    return undefined;
  }
  for (const key of ["skill", "skill_name", "skillName", "skillId"]) {
    const value = asTrimmedString(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function skillNameFromTitle(title: string): string | undefined {
  const match = /^(?:loaded\s+)?skills?\s*[:·\-–—]\s*(.+)$/iu.exec(title.trim());
  const name = match?.[1]?.trim();
  return name && name.length > 0 ? name : undefined;
}

export function isSkillToolTitle(title: string): boolean {
  if (isSkillToolName(title)) {
    return true;
  }
  return skillNameFromTitle(title) !== undefined;
}

export function classifySkillLoadItemType(input: {
  readonly toolName?: string | undefined;
  readonly title?: string | undefined;
  readonly kind?: string | undefined;
}): "skill_load" | undefined {
  if (input.toolName && isSkillToolName(input.toolName)) {
    return "skill_load";
  }
  if (input.kind && isSkillToolName(input.kind)) {
    return "skill_load";
  }
  if (input.title && isSkillToolTitle(input.title)) {
    return "skill_load";
  }
  return undefined;
}

export function resolveSkillToolName(input: {
  readonly title?: string | undefined;
  readonly toolInput?: unknown;
  readonly data?: unknown;
}): string | undefined {
  return (
    skillNameFromToolInput(input.toolInput) ??
    skillNameFromToolInput(input.data) ??
    (input.title ? skillNameFromTitle(input.title) : undefined)
  );
}

const SKILL_MENTION_PATTERN = /(^|\s)\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s|$)/g;
const SKILL_MENTION_TOKEN_PATTERN = /^[a-zA-Z][a-zA-Z0-9:_-]*$/;

/**
 * The `$token` the composer inserts for a skill. Skill names outside the
 * mention grammar (dots, spaces, uppercase-with-punctuation) are folded to
 * their directory-safe form, which the server's name matching also accepts.
 */
export function skillMentionToken(name: string): string {
  const trimmed = name.trim();
  return SKILL_MENTION_TOKEN_PATTERN.test(trimmed)
    ? trimmed
    : trimmed.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

/** True when a `$mention` refers to a skill with this name (exact or folded). */
export function skillMentionMatchesName(mention: string, name: string): boolean {
  return mention === name || mention === skillMentionToken(name);
}

/** `$skill-name` tokens in a user message, first-seen order, case-preserving. */
export function extractSkillMentions(text: string): ReadonlyArray<string> {
  const names: string[] = [];
  const seen = new Set<string>();
  const regex = new RegExp(SKILL_MENTION_PATTERN.source, SKILL_MENTION_PATTERN.flags);
  for (const match of text.matchAll(regex)) {
    const name = match[2];
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function skillLoadNameKey(name: string): string {
  return `name:${name.trim().toLowerCase()}`;
}

export function skillLoadIdKey(skillId: string): string {
  return `id:${skillId}`;
}
