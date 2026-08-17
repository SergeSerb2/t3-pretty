/** `id` is positional: the same attachment can be embedded twice in one body. */
export type PullRequestBodySegment =
  | { readonly id: string; readonly kind: "markdown"; readonly text: string }
  | {
      readonly id: string;
      readonly kind: "attachment";
      readonly url: string;
      readonly media: "video" | "unknown";
    };

const FENCE_PATTERN = /^\s{0,3}((?:`{3,})|(?:~{3,}))(.*)$/u;
const VIDEO_TAG_MAX_LINES = 8;
const INDENTED_CODE_PATTERN = /^(?: {4}|\t)/u;
const BARE_URL_PATTERN = /^<?(https?:\/\/\S+?)>?$/u;
const VIDEO_EXTENSION_PATTERN = /\.(?:mp4|webm|mov|m4v|ogv)(?:$|[?#])/iu;
const GITHUB_ASSET_PATTERN = /^https:\/\/github\.com\/user-attachments\/assets\/[\w-]+$/iu;
const VIDEO_TAG_SRC_PATTERN = /<(?:video|source)\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/iu;
const STANDALONE_VIDEO_TAG_PATTERN = /^\s*<video\b/iu;
const VIDEO_TAG_END_PATTERN = /<\/video>\s*$/iu;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/gu;
const HTML_IMAGE_TAG_PATTERN = /<img\b[^>]*>/giu;
const HTML_IMAGE_SRC_PATTERN = /\bsrc\s*=\s*["']([^"']+)["']/iu;
const HTML_IMAGE_ALT_PATTERN = /\balt\s*=\s*["']([^"']*)["']/iu;
const SUGGESTION_FENCE_PATTERN = /^(\s{0,3}(?:`{3,}|~{3,}))suggestion\b[^\n]*/gmu;

function isWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function attachmentFromLine(line: string): { url: string; media: "video" | "unknown" } | null {
  const url = BARE_URL_PATTERN.exec(line.trim())?.[1];
  if (url === undefined || !isWebUrl(url)) return null;
  if (VIDEO_EXTENSION_PATTERN.test(url) || GITHUB_ASSET_PATTERN.test(url)) {
    return { url, media: "video" };
  }
  return null;
}

/** Host review templates hide notes in HTML comments; those should never render as prose. */
export function stripHtmlComments(markdown: string): string {
  return markdown.replace(HTML_COMMENT_PATTERN, "");
}

/**
 * GitHub writes a dropped image as an `<img>` tag. Native markdown does not render raw HTML,
 * so turn a well-formed tag into a markdown image before the renderer sees it.
 */
export function convertHtmlImagesToMarkdown(markdown: string): string {
  return markdown.replace(HTML_IMAGE_TAG_PATTERN, (tag) => {
    const src = HTML_IMAGE_SRC_PATTERN.exec(tag)?.[1];
    if (src === undefined || !isWebUrl(src)) return tag;
    const alt = HTML_IMAGE_ALT_PATTERN.exec(tag)?.[1]?.trim() || "image";
    return `![${alt}](${src})`;
  });
}

/**
 * A `suggestion` fence is not a language the highlighter knows. Keep the snippet, drop the
 * unknown info string, and label it so the block does not look like a broken code sample.
 */
export function relabelSuggestionFences(markdown: string): string {
  return markdown.replace(SUGGESTION_FENCE_PATTERN, "Suggested change\n\n$1");
}

/** Shape a host body so the native renderer can lay it out without leftover HTML. */
export function preparePullRequestMarkdown(markdown: string): string {
  return relabelSuggestionFences(convertHtmlImagesToMarkdown(stripHtmlComments(markdown)));
}

/**
 * Splits a pull request body into markdown runs and the uploads embedded in it, which the
 * markdown renderer drops. Same shapes as the web parser: a `<video>` tag, or a bare link on
 * its own line to a video file or a GitHub user-attachment.
 */
export function splitPullRequestBody(body: string): ReadonlyArray<PullRequestBodySegment> {
  const segments: PullRequestBodySegment[] = [];
  const markdown: string[] = [];
  let openFence: string | null = null;

  const flushMarkdown = () => {
    const text = markdown.join("\n").replace(/^\n+/u, "").replace(/\s+$/u, "");
    markdown.length = 0;
    if (text.trim().length > 0) {
      segments.push({ id: `markdown:${segments.length}`, kind: "markdown", text });
    }
  };

  const lines = body.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const fenceMatch = FENCE_PATTERN.exec(line);
    if (fenceMatch !== null) {
      const fence = fenceMatch[1]!;
      const closes =
        openFence !== null &&
        fence[0] === openFence[0] &&
        fence.length >= openFence.length &&
        fenceMatch[2]!.trim().length === 0;
      if (openFence === null) {
        openFence = fence;
      } else if (closes) {
        openFence = null;
      }
      markdown.push(line);
      continue;
    }
    if (openFence !== null || INDENTED_CODE_PATTERN.test(line)) {
      markdown.push(line);
      continue;
    }

    const bareAttachment = attachmentFromLine(line);
    if (bareAttachment !== null) {
      flushMarkdown();
      segments.push({ id: `attachment:${segments.length}`, kind: "attachment", ...bareAttachment });
      continue;
    }

    if (!STANDALONE_VIDEO_TAG_PATTERN.test(line)) {
      markdown.push(line);
      continue;
    }
    const lastCandidate = Math.min(index + VIDEO_TAG_MAX_LINES, lines.length) - 1;
    let cursor = index;
    while (cursor < lastCandidate && !VIDEO_TAG_END_PATTERN.test(lines[cursor]!)) {
      cursor += 1;
    }
    const source = VIDEO_TAG_END_PATTERN.test(lines[cursor]!)
      ? VIDEO_TAG_SRC_PATTERN.exec(lines.slice(index, cursor + 1).join("\n"))?.[1]
      : undefined;
    if (source !== undefined && isWebUrl(source)) {
      flushMarkdown();
      segments.push({
        id: `attachment:${segments.length}`,
        kind: "attachment",
        url: source,
        media: "video",
      });
      index = cursor;
    } else {
      markdown.push(line);
    }
  }

  flushMarkdown();
  return segments;
}

export function pullRequestBodySegments(markdown: string): ReadonlyArray<PullRequestBodySegment> {
  return splitPullRequestBody(preparePullRequestMarkdown(markdown));
}

export function hasVisiblePullRequestBody(markdown: string): boolean {
  return pullRequestBodySegments(markdown).length > 0;
}
