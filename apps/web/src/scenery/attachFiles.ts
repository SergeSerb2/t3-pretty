/**
 * Classification and send-time payload for the fork's composer attach button.
 *
 * Images still ride the composer's own Files drop path (validation, compression,
 * limits, toasts). Every other file becomes a pending path attachment: the UI
 * shows a chip, and at send time the absolute (or best-effort) filepath is
 * appended in a marker block the timeline strips from the bubble — same
 * invisible-to-the-user pattern as the auto-PR suffix.
 */

export const ATTACHED_FILE_PATHS_TAG = "attached_file_paths";
export const ATTACHED_FILE_PATHS_OPEN_MARKER = `<${ATTACHED_FILE_PATHS_TAG} source="t3-composer-attach">`;
export const ATTACHED_FILE_PATHS_CLOSE_MARKER = `</${ATTACHED_FILE_PATHS_TAG}>`;

export type AttachKind = "image" | "file";

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

export function classifyAttachment(file: { name: string; type: string }): AttachKind {
  return file.type.startsWith("image/") ? "image" : "file";
}

/**
 * Best-effort absolute path for a picked File. Electron still exposes
 * `File.path` for local picks; browsers only give the basename, which is still
 * enough for the chip label and a useful agent hint.
 */
export function resolvePickedFilePath(file: File): string {
  const withPath = file as File & { path?: unknown };
  if (typeof withPath.path === "string") {
    const trimmed = withPath.path.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return file.name;
}

export function createAttachedFileRef(
  file: File,
  id: string = crypto.randomUUID(),
): AttachedFileRef {
  return {
    id,
    name: file.name || "file",
    path: resolvePickedFilePath(file),
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
