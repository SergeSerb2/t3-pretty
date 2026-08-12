/**
 * Classification and send-time payload for the fork's composer attach button.
 *
 * Images still ride the composer's own Files drop path (validation, compression,
 * limits, toasts). Non-image picks with a real absolute path (desktop
 * `desktopBridge.getPathForFile` → Electron `webUtils.getPathForFile`) become
 * pending path attachments: chips in the composer, filepath baked into the
 * outgoing prompt at send time. Browser picks have no absolute path — text content
 * is inserted into the prompt, and other files fall through the images-only drop
 * path so the composer can refuse them instead of inventing an unreadable basename.
 */

export const ATTACHED_FILE_PATHS_TAG = "attached_file_paths";
export const ATTACHED_FILE_PATHS_OPEN_MARKER = `<${ATTACHED_FILE_PATHS_TAG} source="t3-composer-attach">`;
export const ATTACHED_FILE_PATHS_CLOSE_MARKER = `</${ATTACHED_FILE_PATHS_TAG}>`;

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

export type AttachKind = "image" | "file" | "text";

export type AttachedFileRef = {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
};

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function isTextAttachment(file: { name: string; type: string; size: number }): boolean {
  const textByMime =
    TEXT_MIME_PREFIXES.some((prefix) => file.type.startsWith(prefix)) ||
    TEXT_MIME_TYPES.has(file.type);
  const textByName = file.type === "" && TEXT_EXTENSIONS.has(fileExtension(file.name));
  return (textByMime || textByName) && file.size <= TEXT_ATTACHMENT_MAX_BYTES;
}

export function classifyAttachment(file: { name: string; type: string; size: number }): AttachKind {
  if (file.type.startsWith("image/")) {
    return "image";
  }
  if (isTextAttachment(file)) {
    return "text";
  }
  return "file";
}

/** A NUL byte means the extension lied — treat the pick as binary after all. */
export function looksBinary(content: string): boolean {
  return content.includes("\u0000");
}

/**
 * The prompt block a text file becomes when we cannot hand the agent a real
 * absolute path. Four-backtick fence so files that themselves contain ```
 * fences survive; the trailing space matches the mention-insert convention.
 */
export function textAttachmentPayload(name: string, content: string): string {
  const language = fileExtension(name);
  const body = content.endsWith("\n") ? content : `${content}\n`;
  return `Attached file \`${name}\`:\n\`\`\`\`${language}\n${body}\`\`\`\`\n`;
}

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/**
 * Absolute path for a picked File when the desktop preload exposes one via
 * Electron `webUtils.getPathForFile` (`File.path` was removed in Electron 32+).
 * Browser `<input type="file">` only gives a basename — that is not a readable
 * environment path, so callers must inline text or refuse.
 */
export function resolvePickedFilePath(file: File): string | null {
  const getPathForFile =
    typeof window === "undefined" ? undefined : window.desktopBridge?.getPathForFile;
  const bridgePath = getPathForFile?.(file);
  if (typeof bridgePath === "string") {
    const trimmed = bridgePath.trim();
    if (trimmed.length > 0 && isAbsoluteFilePath(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

export function createAttachedFileRef(
  file: File,
  id: string = crypto.randomUUID(),
): AttachedFileRef | null {
  const path = resolvePickedFilePath(file);
  if (!path) {
    return null;
  }
  return {
    id,
    name: file.name || "file",
    path,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
  };
}

function escapeBackticks(value: string): string {
  return value.replaceAll("`", "'");
}

export function buildAttachedFilePathsSuffix(files: ReadonlyArray<AttachedFileRef>): string {
  const labels = files.map((file) => `\`${escapeBackticks(file.name)}\``).join(", ");
  const paths = files.map((file) => `- \`${escapeBackticks(file.path)}\``).join("\n");
  return `

Attached ${labels}.

${ATTACHED_FILE_PATHS_OPEN_MARKER}
The user attached the following files. Read them from these paths:
${paths}
${ATTACHED_FILE_PATHS_CLOSE_MARKER}`;
}

const SUFFIX_BLOCK_FROM_OPEN_TAG_PATTERN = new RegExp(
  `^${ATTACHED_FILE_PATHS_OPEN_MARKER}\\n[\\s\\S]*\\n${ATTACHED_FILE_PATHS_CLOSE_MARKER}\\s*$`,
);

function trailingAttachedFilePathsStart(text: string): number {
  const lastOpen = text.lastIndexOf(ATTACHED_FILE_PATHS_OPEN_MARKER);
  if (lastOpen === -1) {
    return -1;
  }
  return SUFFIX_BLOCK_FROM_OPEN_TAG_PATTERN.test(text.slice(lastOpen)) ? lastOpen : -1;
}

export function hasAttachedFilePathsSuffix(text: string): boolean {
  return trailingAttachedFilePathsStart(text) !== -1;
}

/**
 * Appends the path marker block (and a short visible "Attached …" summary) so
 * the agent receives absolute paths while the composer itself never shows them.
 * Idempotent when the marker is already present.
 */
export function applyAttachedFilePathsSuffix(
  text: string,
  files: ReadonlyArray<AttachedFileRef>,
): string {
  if (files.length === 0 || hasAttachedFilePathsSuffix(text)) {
    return text;
  }
  const suffix = buildAttachedFilePathsSuffix(files);
  return text.trim().length === 0 ? suffix.trimStart() : text + suffix;
}

/**
 * Removes the trailing path marker for display. The visible "Attached `name`"
 * summary stays so the bubble still records that files were sent; only the
 * agent-facing path list is hidden.
 */
export function stripAttachedFilePathsSuffix(text: string): string {
  let result = text;
  for (
    let start = trailingAttachedFilePathsStart(result);
    start !== -1;
    start = trailingAttachedFilePathsStart(result)
  ) {
    result = result.slice(0, start).trimEnd();
  }
  return result;
}
