/**
 * Classification for the fork's composer attach button. The composer's own
 * pipeline (paste/drop) accepts only images, so picked files split three
 * ways:
 *   - image  — hand to the composer's Files drop path (validation,
 *     compression, limits and error toasts all reused).
 *   - text   — the app has no non-image attachment type, but the agent can
 *     read prose: the content is inserted into the prompt as a fenced block.
 *   - binary — still dispatched down the Files drop path so the composer's
 *     own "images only" toast explains the refusal.
 */

export const TEXT_ATTACHMENT_MAX_BYTES = 128 * 1024;

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/x-sh",
]);

const TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "rst",
  "json",
  "jsonc",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "css",
  "scss",
  "html",
  "xml",
  "yml",
  "yaml",
  "toml",
  "ini",
  "conf",
  "env",
  "csv",
  "tsv",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "sh",
  "zsh",
  "bash",
  "fish",
  "sql",
  "log",
  "diff",
  "patch",
  "lock",
]);

export type AttachKind = "image" | "text" | "binary";

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function classifyAttachment(file: { name: string; type: string; size: number }): AttachKind {
  if (file.type.startsWith("image/")) {
    return "image";
  }
  const textByMime =
    TEXT_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix)) ||
    TEXT_MIME_TYPES.has(file.type);
  const textByName = file.type === "" && TEXT_EXTENSIONS.has(fileExtension(file.name));
  if ((textByMime || textByName) && file.size <= TEXT_ATTACHMENT_MAX_BYTES) {
    return "text";
  }
  return "binary";
}

/** A NUL byte means the extension lied — treat the pick as binary after all. */
export function looksBinary(content: string): boolean {
  return content.includes("\u0000");
}

/**
 * The prompt block a text file becomes. Four-backtick fence so files that
 * themselves contain ``` fences survive; the trailing space matches the
 * mention-insert convention.
 */
export function textAttachmentPayload(name: string, content: string): string {
  const language = fileExtension(name);
  const body = content.endsWith("\n") ? content : `${content}\n`;
  return `Attached file \`${name}\`:\n\`\`\`\`${language}\n${body}\`\`\`\`\n`;
}
