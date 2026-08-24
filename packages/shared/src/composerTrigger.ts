export type ComposerTriggerKind = "path" | "slash-command" | "slash-model" | "skill";
export type ComposerSlashCommand = "model" | "plan" | "default";

export interface ComposerTrigger {
  kind: ComposerTriggerKind;
  query: string;
  rangeStart: number;
  rangeEnd: number;
}

const SIMPLE_MENTION_PATH_REGEX = /^[^\s@"\\]+$/;
const COMPOSER_TRIGGER_QUERY_MAX_LENGTH = 256;
const COMPOSER_TRIGGER_TOKEN_MAX_LENGTH = COMPOSER_TRIGGER_QUERY_MAX_LENGTH + 1;
const COMPOSER_SLASH_LINE_MAX_LENGTH = COMPOSER_TRIGGER_QUERY_MAX_LENGTH + "/model ".length;

export function serializeComposerMentionPath(path: string): string {
  if (SIMPLE_MENTION_PATH_REGEX.test(path)) {
    return path;
  }
  return `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function composerFileLinkBasename(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

function escapeMarkdownLinkLabel(label: string): string {
  return label.replaceAll("\\", "\\\\").replaceAll("[", "\\[").replaceAll("]", "\\]");
}

function replaceUnpairedSurrogates(value: string): string {
  let result: string | undefined;
  let segmentStart = 0;

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
    } else if (code < 0xdc00 || code > 0xdfff) {
      continue;
    }

    result = `${result ?? ""}${value.slice(segmentStart, index)}\uFFFD`;
    segmentStart = index + 1;
  }

  return result === undefined ? value : `${result}${value.slice(segmentStart)}`;
}

function encodeMarkdownLinkDestination(path: string): string {
  return encodeURI(path)
    .replaceAll("(", "%28")
    .replaceAll(")", "%29")
    .replaceAll("#", "%23")
    .replaceAll("?", "%3F")
    .replaceAll("\\", "%5C");
}

export function serializeComposerFileLink(path: string): string {
  const safePath = replaceUnpairedSurrogates(path);
  const label = escapeMarkdownLinkLabel(composerFileLinkBasename(safePath));
  return `[${label}](${encodeMarkdownLinkDestination(safePath)})`;
}

function clampCursor(text: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return text.length;
  return Math.max(0, Math.min(text.length, Math.floor(cursor)));
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\n" || char === "\t" || char === "\r";
}

/**
 * Detect an active trigger (@path, $skill, /command) at the cursor position.
 *
 * Accepts an optional `isWhitespaceChar` override so callers with inline
 * placeholder characters (e.g. terminal context chips on web) can treat
 * those as token boundaries.
 */
export function detectComposerTrigger(
  text: string,
  cursorInput: number,
  isWhitespaceChar?: (char: string) => boolean,
): ComposerTrigger | null {
  const cursor = clampCursor(text, cursorInput);
  const lineWindowStart = Math.max(0, cursor - COMPOSER_SLASH_LINE_MAX_LENGTH);
  const lineWindow = text.slice(lineWindowStart, cursor);
  const newlineOffset = lineWindow.lastIndexOf("\n");
  const lineStart =
    newlineOffset >= 0 ? lineWindowStart + newlineOffset + 1 : lineWindowStart === 0 ? 0 : null;
  if (lineStart !== null) {
    const linePrefix = text.slice(lineStart, cursor);
    if (linePrefix.startsWith("/")) {
      const commandMatch = /^\/(\S*)$/.exec(linePrefix);
      if (commandMatch) {
        const commandQuery = commandMatch[1] ?? "";
        if (commandQuery.length > COMPOSER_TRIGGER_QUERY_MAX_LENGTH) {
          return null;
        }
        if (commandQuery.toLowerCase() === "model") {
          return {
            kind: "slash-model",
            query: "",
            rangeStart: lineStart,
            rangeEnd: cursor,
          };
        }
        return {
          kind: "slash-command",
          query: commandQuery,
          rangeStart: lineStart,
          rangeEnd: cursor,
        };
      }

      const modelMatch = /^\/model(?:\s+(.*))?$/.exec(linePrefix);
      if (modelMatch) {
        const modelQuery = (modelMatch[1] ?? "").trim();
        if (modelQuery.length > COMPOSER_TRIGGER_QUERY_MAX_LENGTH) {
          return null;
        }
        return {
          kind: "slash-model",
          query: modelQuery,
          rangeStart: lineStart,
          rangeEnd: cursor,
        };
      }
    }
  }

  const wsCheck = isWhitespaceChar ?? isWhitespace;
  let tokenIdx = cursor - 1;
  const tokenWindowStart = Math.max(0, cursor - COMPOSER_TRIGGER_TOKEN_MAX_LENGTH);
  while (tokenIdx >= tokenWindowStart && !wsCheck(text[tokenIdx] ?? "")) {
    tokenIdx -= 1;
  }
  if (tokenIdx >= 0 && !wsCheck(text[tokenIdx] ?? "")) {
    return null;
  }
  const tokenStart = tokenIdx + 1;

  const token = text.slice(tokenStart, cursor);
  if (token.startsWith("$")) {
    return {
      kind: "skill",
      query: token.slice(1),
      rangeStart: tokenStart,
      rangeEnd: cursor,
    };
  }
  if (!token.startsWith("@")) {
    return null;
  }

  return {
    kind: "path",
    query: token.slice(1),
    rangeStart: tokenStart,
    rangeEnd: cursor,
  };
}

export function parseStandaloneComposerSlashCommand(
  text: string,
): Exclude<ComposerSlashCommand, "model"> | null {
  const match = /^\/(plan|default)\s*$/i.exec(text.trim());
  if (!match) {
    return null;
  }
  const command = match[1]?.toLowerCase();
  if (command === "plan") return "plan";
  return "default";
}

export function replaceTextRange(
  text: string,
  rangeStart: number,
  rangeEnd: number,
  replacement: string,
): { text: string; cursor: number } {
  const safeStart = Math.max(0, Math.min(text.length, rangeStart));
  const safeEnd = Math.max(safeStart, Math.min(text.length, rangeEnd));
  const nextText = `${text.slice(0, safeStart)}${replacement}${text.slice(safeEnd)}`;
  return { text: nextText, cursor: safeStart + replacement.length };
}
