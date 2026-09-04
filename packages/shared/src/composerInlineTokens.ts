import { PROJECT_PATH_MAX_LENGTH } from "@t3tools/contracts";

export type ComposerInlineToken =
  | {
      readonly type: "mention";
      readonly value: string;
      readonly source: string;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly type: "skill";
      readonly value: string;
      readonly source: string;
      readonly start: number;
      readonly end: number;
    };

export interface CollectComposerInlineTokensOptions {
  readonly preserveTrailingFrom?: ReadonlyArray<ComposerInlineToken>;
}

const SKILL_TOKEN_REGEX = /(^|\s)\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s)/g;
/**
 * The label body is bounded rather than `*`. Unbounded, every whitespace in
 * the composer is a candidate start: the engine scans the rest of the text for
 * a closing `]`, fails, and rescans from the next whitespace — quadratic on
 * input like " [[[[[…". A cap makes each attempt constant-bounded.
 *
 * Only a basename ever survives the `label !== basename` check below, so this
 * cannot reject a link a user could meaningfully write; the longest filename
 * any common filesystem allows is 255.
 */
const MAX_FILE_LINK_LABEL_LENGTH = 512;
const FILE_LINK_TOKEN_REGEX = new RegExp(
  `(^|\\s)\\[((?:\\\\.|[^\\]\\\\]){0,${MAX_FILE_LINK_LABEL_LENGTH}})\\]\\(([^)\\s]+)\\)(?=\\s)`,
  "g",
);
const URI_SCHEME_REGEX = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_DRIVE_PATH_REGEX = /^[A-Za-z]:[\\/]/;
// Autocomplete emits canonical file links, so ambiguous bare @scope/package text stays a package.
const SCOPED_PACKAGE_REFERENCE_REGEX =
  /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(?:\/[^\s@"]+)*$/;
const WHITESPACE_REGEX = /\s/u;

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && WHITESPACE_REGEX.test(value);
}

function collectAtMentionTokens(text: string): ComposerInlineToken[] {
  const matches: ComposerInlineToken[] = [];

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "@" || (index > 0 && !isWhitespace(text[index - 1]))) {
      continue;
    }

    const start = index;
    if (text[index + 1] === '"') {
      let cursor = index + 2;
      let decodedLength = 0;
      let closingQuote = -1;
      while (cursor < text.length) {
        const character = text[cursor]!;
        if (character === "\\") {
          if (cursor + 1 >= text.length) {
            break;
          }
          decodedLength += 1;
          cursor += 2;
          continue;
        }
        if (character === '"') {
          closingQuote = cursor;
          break;
        }
        decodedLength += 1;
        cursor += 1;
      }
      if (closingQuote === -1) {
        break;
      }

      const end = closingQuote + 1;
      if (
        decodedLength > 0 &&
        decodedLength <= PROJECT_PATH_MAX_LENGTH &&
        isWhitespace(text[end])
      ) {
        matches.push({
          type: "mention",
          value: text.slice(start + 2, closingQuote).replace(/\\(.)/g, "$1"),
          source: text.slice(start, end),
          start,
          end,
        });
      }
      index = closingQuote;
      continue;
    }

    let cursor = index + 1;
    while (
      cursor < text.length &&
      !isWhitespace(text[cursor]) &&
      text[cursor] !== "@" &&
      text[cursor] !== '"'
    ) {
      cursor += 1;
    }
    const pathLength = cursor - (index + 1);
    if (pathLength > 0 && pathLength <= PROJECT_PATH_MAX_LENGTH && isWhitespace(text[cursor])) {
      const path = text.slice(index + 1, cursor);
      if (!SCOPED_PACKAGE_REFERENCE_REGEX.test(path)) {
        matches.push({
          type: "mention",
          value: path,
          source: text.slice(start, cursor),
          start,
          end: cursor,
        });
      }
    }
    index = cursor - 1;
  }

  return matches;
}

function collectMentionTokens(text: string): ComposerInlineToken[] {
  const matches: ComposerInlineToken[] = [];

  for (const match of text.matchAll(FILE_LINK_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const label = (match[2] ?? "").replace(/\\(.)/g, "$1");
    const encodedPath = match[3] ?? "";
    let path = encodedPath;
    try {
      path = decodeURIComponent(encodedPath);
    } catch {
      // Preserve malformed source rather than dropping a user-authored token.
    }
    const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const basename = separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
    const hasExternalScheme = URI_SCHEME_REGEX.test(path) && !WINDOWS_DRIVE_PATH_REGEX.test(path);
    if (!path || hasExternalScheme || label !== basename) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "mention",
      value: path,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  matches.push(...collectAtMentionTokens(text));

  return matches;
}

export function collectComposerInlineTokens(
  text: string,
  options: CollectComposerInlineTokensOptions = {},
): ReadonlyArray<ComposerInlineToken> {
  const matches = collectMentionTokens(text);

  for (const match of text.matchAll(SKILL_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const value = match[2] ?? "";
    if (!value) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "skill",
      value,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  for (const token of options.preserveTrailingFrom ?? []) {
    if (
      token.end === text.length &&
      text.slice(token.start, token.end) === token.source &&
      !matches.some(
        (match) =>
          match.type === token.type && match.start === token.start && match.end === token.end,
      )
    ) {
      matches.push(token);
    }
  }

  return [...matches].sort((left, right) => left.start - right.start);
}
