import type { Root, RootContent } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const parser = unified().use(remarkParse).use(remarkGfm);
export type MarkdownNode = Root | RootContent;

function decodeCodePoint(codePoint: number, entity: string): string {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return entity;
  }
  return String.fromCodePoint(codePoint);
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|amp|apos|gt|lt|nbsp|quot);/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      if (decimal) {
        return decodeCodePoint(Number.parseInt(decimal, 10), entity);
      }
      if (hexadecimal) {
        return decodeCodePoint(Number.parseInt(hexadecimal, 16), entity);
      }
      switch (entity.toLowerCase()) {
        case "&amp;":
          return "&";
        case "&apos;":
          return "'";
        case "&gt;":
          return ">";
        case "&lt;":
          return "<";
        case "&nbsp;":
          return "\u00a0";
        case "&quot;":
          return '"';
        default:
          return entity;
      }
    },
  );
}

const HTML_TAG = /<!--[\s\S]*?-->|<\/?[a-z](?:[^>"']|"[^"]*"|'[^']*')*>/gi;

function attribute(tag: string, name: string): string | null {
  const attributes = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(attributes)) {
    if (match[1]?.toLowerCase() === name) {
      return decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
    }
  }
  return null;
}

/** Called only for parsed HTML nodes, so Markdown code examples keep their literal tags. */
export function markdownHtmlContent(content: string): string {
  // An HTML block such as <details> can also contain Markdown fences and code spans.
  const codeRanges: Array<{ start: number; end: number }> = [];
  const tags = [...content.matchAll(HTML_TAG)];
  let tagIndex = 0;
  const delimiters = [...content.matchAll(/`+|~{3,}/g)].filter((delimiter) => {
    while (tags[tagIndex] && tags[tagIndex]!.index + tags[tagIndex]![0].length <= delimiter.index)
      tagIndex += 1;
    const tag = tags[tagIndex];
    return !tag || delimiter.index < tag.index;
  });
  for (let index = 0; index < delimiters.length; index += 1) {
    const opening = delimiters[index]!;
    const lineStart = content.lastIndexOf("\n", opening.index - 1) + 1;
    const fenced =
      opening[0].length >= 3 && /^ {0,3}$/.test(content.slice(lineStart, opening.index));
    if (opening[0][0] === "~" && !fenced) continue;
    let closingIndex = -1;
    for (let candidate = index + 1; candidate < delimiters.length; candidate += 1) {
      const closing = delimiters[candidate]!;
      if (!fenced && closing[0] === opening[0]) {
        closingIndex = candidate;
        break;
      }
      if (!fenced || closing[0][0] !== opening[0][0] || closing[0].length < opening[0].length)
        continue;
      const start = content.lastIndexOf("\n", closing.index - 1) + 1;
      const nextLine = content.indexOf("\n", closing.index);
      const end = nextLine === -1 ? content.length : nextLine;
      if (
        /^ {0,3}$/.test(content.slice(start, closing.index)) &&
        /^\s*$/.test(content.slice(closing.index + closing[0].length, end))
      ) {
        closingIndex = candidate;
        break;
      }
    }
    if (closingIndex === -1) {
      if (fenced) codeRanges.push({ start: opening.index, end: content.length });
      continue;
    }
    const closing = delimiters[closingIndex]!;
    codeRanges.push({ start: opening.index, end: closing.index + closing[0].length });
    index = closingIndex;
  }
  return content.replace(HTML_TAG, (tag, offset: number) => {
    if (codeRanges.some((range) => offset >= range.start && offset < range.end)) return tag;
    if (tag.startsWith("<!--")) return "";
    if (/^<img\b/i.test(tag)) {
      const src = attribute(tag, "src");
      if (!src) return "";
      const alt = (attribute(tag, "alt") ?? "").replace(/[\\[\]&]/g, "\\$&");
      const href = src
        .replace(/&/g, "\\&")
        .replace(/</g, "%3C")
        .replace(/>/g, "%3E")
        .replace(/\n/g, "");
      return `![${alt}](<${href}>)`;
    }
    if (/^<summary\b/i.test(tag)) return "\n\n**";
    if (/^<\/summary\s*>/i.test(tag)) return "**\n\n";
    if (/^<br\b/i.test(tag)) return "  \n";
    if (/^<\/?(?:p|div|details)\b/i.test(tag)) return "\n\n";
    return "";
  });
}

const HTML_CANDIDATE = /<(?:!--|\/?[a-z])/i;

function needsHtmlConversion(markdown: string): boolean {
  if (!HTML_CANDIDATE.test(markdown)) return false;
  // The parser normalizes BOM/control input before recognizing blocks.
  // oxlint-disable-next-line no-control-regex -- Control normalization makes fence recognition ambiguous.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufeff]/.test(markdown)) return true;
  let closingFence: RegExp | null = null;
  for (const line of markdown.split(/\r\n?|\n/)) {
    if (closingFence) {
      if (closingFence.test(line)) closingFence = null;
      continue;
    }
    // A container or reference definition can change how later fence lines
    // parse. Only unmistakable top-level fences bypass the Markdown parser.
    if (/^(?:[ \t]+(?:`{3,}|~{3,})|[ \t]*(?:>|[-+*](?:[ \t]|$)|\d+[.)](?:[ \t]|$)|\[))/.test(line))
      return true;
    const opening = /^(`{3,}|~{3,})(.*)$/.exec(line);
    if (opening) {
      const fence = opening[1]!;
      if (fence[0] === "`" && opening[2]!.includes("`")) return true;
      closingFence = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*$`);
      continue;
    }
    if (HTML_CANDIDATE.test(line)) return true;
  }
  return false;
}

/** Convert parsed HTML fragments only, preserving Markdown code and source around them. */
export function markdownWithHtml(markdown: string): string {
  if (!needsHtmlConversion(markdown)) return markdown;
  const edits: Array<{ start: number; end: number; content: string }> = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "html") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start !== undefined && end !== undefined)
        edits.push({ start, end, content: markdownHtmlContent(node.value) });
    } else if ("children" in node) node.children.forEach(visit);
  };
  visit(parser.parse(markdown));
  for (const edit of edits.reverse())
    markdown = markdown.slice(0, edit.start) + edit.content + markdown.slice(edit.end);
  return markdown;
}

export function parseMarkdownDocument(markdown: string): Root {
  return parser.parse(markdownWithHtml(markdown));
}
