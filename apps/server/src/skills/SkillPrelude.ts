/**
 * Renders skill documents into the text prelude a turn carries.
 *
 * Provider CLIs only learn a skill's name and description from disk; the
 * instructions reach the model when the skill is invoked. T3 Code invokes the
 * skills a user attached to a thread (or mentioned with `$skill`) itself, by
 * sending their `SKILL.md` bodies ahead of the user's message on the first
 * turn that carries them. The prelude is provider-neutral text so every
 * adapter gets the same behavior.
 */
import type { SkillDocument } from "./SkillMaterializer.ts";

const PRELUDE_HEADER = [
  "[Skills]",
  "The skills below are attached to this conversation. Their full instructions are included here, so they are already loaded: apply them where they are relevant, and do not call a Skill tool to load them again. Relative paths inside a skill resolve against that skill's directory.",
].join("\n");
const PRELUDE_FOOTER = "[End skills]";
const BLOCK_SEPARATOR = "\n\n";

function renderSkillBlock(skill: SkillDocument): string {
  return [
    `<skill name="${skill.name}" directory="${skill.directory}">`,
    skill.body,
    "</skill>",
  ].join("\n");
}

export interface SkillsPrelude {
  readonly text: string;
  /** Skills that fit the budget, in input order. */
  readonly included: ReadonlyArray<SkillDocument>;
  /** Skills dropped because they would push the turn over `maxChars`. */
  readonly omitted: ReadonlyArray<SkillDocument>;
}

/**
 * Render as many skills as fit in `maxChars`, keeping input order. A skill is
 * either sent whole or not at all: a truncated skill is a broken skill.
 * Returns undefined when no skill fits.
 */
export function renderSkillsPrelude(input: {
  readonly skills: ReadonlyArray<SkillDocument>;
  readonly maxChars: number;
}): SkillsPrelude | undefined {
  const included: Array<SkillDocument> = [];
  const omitted: Array<SkillDocument> = [];
  const blocks: Array<string> = [];
  let length = PRELUDE_HEADER.length + BLOCK_SEPARATOR.length * 2 + PRELUDE_FOOTER.length;
  for (const skill of input.skills) {
    const block = renderSkillBlock(skill);
    const blockLength = block.length + (blocks.length > 0 ? BLOCK_SEPARATOR.length : 0);
    if (length + blockLength > input.maxChars) {
      omitted.push(skill);
      continue;
    }
    length += blockLength;
    blocks.push(block);
    included.push(skill);
  }
  if (included.length === 0) {
    return undefined;
  }
  return {
    text: [PRELUDE_HEADER, blocks.join(BLOCK_SEPARATOR), PRELUDE_FOOTER].join(BLOCK_SEPARATOR),
    included,
    omitted,
  };
}
