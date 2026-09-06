/**
 * Registry of the agent-only instruction blocks T3 appends to a user message
 * (auto-PR guidelines, automation run context). Every block is a trailing
 * `<tag source="…">…</tag>` element, so one stripper hides them all from
 * chat bubbles, search snippets, title seeds, and terminal context.
 *
 * The `source` attribute is the generated-only discriminator: a user quoting
 * the bare tag while discussing the feature never matches.
 */

export const HIDDEN_INSTRUCTION_BLOCKS = [
  { tag: "create_pull_request_instructions", source: "t3-auto-pr" },
  { tag: "automation_run", source: "t3-automations" },
] as const;

export type HiddenInstructionTag = (typeof HIDDEN_INSTRUCTION_BLOCKS)[number]["tag"];

export function hiddenInstructionOpenMarker(tag: HiddenInstructionTag): string {
  const block = HIDDEN_INSTRUCTION_BLOCKS.find((candidate) => candidate.tag === tag)!;
  return `<${block.tag} source="${block.source}">`;
}

export function hiddenInstructionCloseMarker(tag: HiddenInstructionTag): string {
  return `</${tag}>`;
}

/**
 * A generated block viewed from its own opening marker: one open tag,
 * arbitrary wording, close tag at the end of the text. Applied to the slice
 * starting at the LAST opening marker, so user-authored occurrences of the
 * marker earlier in the message can never widen the match.
 */
const BLOCKS = HIDDEN_INSTRUCTION_BLOCKS.map(({ tag }) => {
  const open = hiddenInstructionOpenMarker(tag);
  return {
    tag,
    open,
    pattern: new RegExp(`^${open}\\n[\\s\\S]*\\n${hiddenInstructionCloseMarker(tag)}\\s*$`),
  };
});

/**
 * Walks trailing blocks from the end of the text, in any order. Returns where
 * the user's own text ends and which tags were found; `end === text.length`
 * when there is no trailing block.
 */
function trailingBlocks(text: string): { end: number; tags: Set<HiddenInstructionTag> } {
  const tags = new Set<HiddenInstructionTag>();
  let end = text.length;
  while (end > 0) {
    const match = BLOCKS.flatMap((block) => {
      const lastOpen = text.lastIndexOf(block.open, end - 1);
      return lastOpen !== -1 && block.pattern.test(text.slice(lastOpen, end))
        ? [{ tag: block.tag, lastOpen }]
        : [];
    })[0];
    if (match === undefined) {
      break;
    }
    tags.add(match.tag);
    end = match.lastOpen;
    while (end > 0 && /\s/u.test(text[end - 1]!)) {
      end -= 1;
    }
  }
  return { end, tags };
}

/**
 * Removes every trailing generated block for display so the chat bubble shows
 * only what the user typed. Mid-text occurrences are left alone. Idempotent.
 */
export function stripHiddenInstructionSuffixes(text: string): string {
  const { end } = trailingBlocks(text);
  return end === text.length ? text : text.slice(0, end);
}

/** True when the trailing generated blocks include one with `tag`. */
export function hasHiddenInstructionSuffix(text: string, tag: HiddenInstructionTag): boolean {
  return trailingBlocks(text).tags.has(tag);
}
