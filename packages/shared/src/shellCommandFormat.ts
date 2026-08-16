const CONTINUATION_INDENT = "  ";

export type ToolCallDisplayLanguage = "json" | "text";

export type ToolCallDisplaySection =
  | {
      readonly kind: "command";
      readonly original: string;
      readonly display: string;
    }
  | {
      readonly kind: "json";
      readonly text: string;
    }
  | {
      readonly kind: "text";
      readonly text: string;
    };

export function formatShellCommandForDisplay(command: string): string {
  const trimmed = command.trim();
  if (trimmed.length === 0 || /[\r\n]/u.test(trimmed)) {
    return trimmed;
  }

  const breaks = findTopLevelChainBreaks(trimmed);
  if (breaks.length === 0) {
    return trimmed;
  }

  let formatted = "";
  let cursor = 0;
  let wroteBreak = false;
  for (const breakAt of breaks) {
    const nextStart = skipHorizontalWhitespace(trimmed, breakAt);
    // A following comment is still on this line in the original command. Putting
    // it on the next line would make `cmd && # note` a syntax error, and would
    // un-comment anything after a later operator in that comment.
    if (nextStart >= trimmed.length || isShellCommentStart(trimmed, nextStart)) {
      continue;
    }
    formatted += `${trimmed.slice(cursor, breakAt).trimEnd()}\n${CONTINUATION_INDENT}`;
    cursor = nextStart;
    wroteBreak = true;
  }
  if (!wroteBreak) {
    return trimmed;
  }
  return formatted + trimmed.slice(cursor);
}

export function detectStructuredTextLanguage(text: string): ToolCallDisplayLanguage {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 256_000) {
    return "text";
  }
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return "text";
  }
  try {
    JSON.parse(trimmed);
    return "json";
  } catch {
    return "text";
  }
}

export function buildToolCallDisplaySections(input: {
  readonly leadingText?: string | null;
  readonly command?: string | null;
  readonly output?: string | null;
  readonly trailingText?: string | null;
}): ToolCallDisplaySection[] {
  const sections: ToolCallDisplaySection[] = [];
  const seen = new Set<string>();

  const pushText = (kind: "json" | "text", value: string | null | undefined) => {
    const text = value?.trim();
    if (!text || seen.has(text)) {
      return;
    }
    seen.add(text);
    sections.push(kind === "json" ? { kind: "json", text } : { kind: "text", text });
  };

  pushText("text", input.leadingText);

  const originalCommand = input.command?.trim();
  if (originalCommand && !seen.has(originalCommand)) {
    seen.add(originalCommand);
    sections.push({
      kind: "command",
      original: originalCommand,
      display: formatShellCommandForDisplay(originalCommand),
    });
  }

  const output = input.output?.trim();
  if (output) {
    pushText(detectStructuredTextLanguage(output), output);
  }

  pushText("text", input.trailingText);
  return sections;
}

export function serializeToolCallDisplaySections(
  sections: ReadonlyArray<ToolCallDisplaySection>,
): string | null {
  if (sections.length === 0) {
    return null;
  }
  return sections
    .map((section) => {
      switch (section.kind) {
        case "command":
          return section.display;
        case "json":
        case "text":
          return section.text;
      }
    })
    .join("\n\n");
}

export function toolCallDisplayAddsStructure(
  sections: ReadonlyArray<ToolCallDisplaySection>,
): boolean {
  return sections.some(
    (section) => section.kind === "command" && section.display !== section.original,
  );
}

function findTopLevelChainBreaks(source: string): number[] {
  const breaks: number[] = [];
  let index = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let parenDepth = 0;
  let braceDepth = 0;
  let doubleBracketDepth = 0;
  let inBackticks = false;

  const isDepthZero = () =>
    quote === null &&
    parenDepth === 0 &&
    braceDepth === 0 &&
    doubleBracketDepth === 0 &&
    !inBackticks;

  while (index < source.length) {
    const character = source[index]!;

    if (quote === "'") {
      if (character === "'") {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (escaped) {
      escaped = false;
      index += 1;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      index += 1;
      continue;
    }

    if (quote === '"') {
      if (character === '"') {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      index += 1;
      continue;
    }

    if (character === "`") {
      inBackticks = !inBackticks;
      index += 1;
      continue;
    }

    if (inBackticks) {
      index += 1;
      continue;
    }

    if (character === "$" && source[index + 1] === "{") {
      braceDepth += 1;
      index += 2;
      continue;
    }

    if (character === "}" && braceDepth > 0) {
      braceDepth -= 1;
      index += 1;
      continue;
    }

    if (character === "$" && source[index + 1] === "(") {
      parenDepth += 1;
      index += 2;
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      index += 1;
      continue;
    }

    if (character === ")") {
      if (parenDepth > 0) {
        parenDepth -= 1;
      }
      index += 1;
      continue;
    }

    if (character === "[" && source[index + 1] === "[") {
      doubleBracketDepth += 1;
      index += 2;
      continue;
    }

    if (character === "]" && source[index + 1] === "]" && doubleBracketDepth > 0) {
      doubleBracketDepth -= 1;
      index += 2;
      continue;
    }

    if (isDepthZero() && character === "<" && source[index + 1] === "<") {
      return [];
    }

    if (isDepthZero() && isShellCommentStart(source, index)) {
      break;
    }

    if (isDepthZero()) {
      if (character === "&" && source[index + 1] === "&") {
        breaks.push(index + 2);
        index += 2;
        continue;
      }
      if (character === "|" && source[index + 1] === "|") {
        breaks.push(index + 2);
        index += 2;
        continue;
      }
      if (character === "|" && source[index + 1] === "&") {
        breaks.push(index + 2);
        index += 2;
        continue;
      }
      if (character === "|") {
        breaks.push(index + 1);
        index += 1;
        continue;
      }
    }

    index += 1;
  }

  if (quote !== null || inBackticks) {
    return [];
  }

  return breaks;
}

function skipHorizontalWhitespace(source: string, start: number): number {
  let index = start;
  while (index < source.length && isHorizontalWhitespace(source[index]!)) {
    index += 1;
  }
  return index;
}

function isHorizontalWhitespace(character: string): boolean {
  return character === " " || character === "\t";
}

// Bash starts a comment when `#` is a new word: start of input, or after a
// POSIX metacharacter. `echo hi;# x && y` comments out `x && y`; `foo#bar` does not.
function isShellCommentStart(source: string, index: number): boolean {
  if (source[index] !== "#") {
    return false;
  }
  if (index === 0) {
    return true;
  }
  return /[\s;&|()<>]/u.test(source[index - 1]!);
}
