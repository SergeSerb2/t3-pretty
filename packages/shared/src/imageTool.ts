import { isWorkspaceImagePreviewPath } from "./filePreview.ts";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function compactToolName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function isImageGenerationCompact(compact: string): boolean {
  if (compact === "imagine" || compact.startsWith("imagine")) {
    return true;
  }
  return (
    compact.includes("imagegeneration") ||
    compact.includes("imagegen") ||
    compact.includes("generateimage") ||
    compact.includes("gptimage") ||
    compact === "dalle" ||
    compact.startsWith("dalle")
  );
}

/** Classify a provider tool/item as image generation vs viewing an existing image. */
export function classifyImageToolItemType(input: {
  readonly toolName?: string | undefined;
  readonly title?: string | undefined;
  readonly kind?: string | undefined;
  readonly type?: string | undefined;
}): "image_generation" | "image_view" | undefined {
  const values = [input.type, input.toolName, input.title, input.kind];
  for (const value of values) {
    if (value && isImageGenerationCompact(compactToolName(value))) {
      return "image_generation";
    }
  }
  for (const value of values) {
    if (value && compactToolName(value).includes("image")) {
      return "image_view";
    }
  }
  return undefined;
}

function maybeFilePath(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (/^(?:https?:|data:|blob:)/iu.test(value)) {
    return undefined;
  }
  return value;
}

function collectImagePaths(
  value: unknown,
  paths: string[],
  seen: Set<string>,
  depth: number,
): void {
  if (depth > 4 || paths.length >= 8) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectImagePaths(entry, paths, seen, depth + 1);
      if (paths.length >= 8) {
        return;
      }
    }
    return;
  }
  const record = asRecord(value);
  if (!record) {
    return;
  }
  for (const key of [
    "savedPath",
    "path",
    "filePath",
    "relativePath",
    "filename",
    "uri",
    "newPath",
  ]) {
    const candidate = maybeFilePath(asTrimmedString(record[key]));
    if (!candidate || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    paths.push(candidate);
    if (paths.length >= 8) {
      return;
    }
  }
  for (const nestedKey of [
    "locations",
    "item",
    "input",
    "result",
    "rawInput",
    "data",
    "files",
    "content",
  ]) {
    if (!(nestedKey in record)) {
      continue;
    }
    collectImagePaths(record[nestedKey], paths, seen, depth + 1);
    if (paths.length >= 8) {
      return;
    }
  }
}

function firstImagePath(paths: ReadonlyArray<string | undefined>): string | undefined {
  for (const path of paths) {
    if (path && isWorkspaceImagePreviewPath(path)) {
      return path;
    }
  }
  return paths.find((path) => path !== undefined && path.length > 0);
}

/** Pick a generated-image file path from tool payload, changed files, or detail text. */
export function extractGeneratedImagePath(input: {
  readonly data?: unknown;
  readonly changedFiles?: ReadonlyArray<string> | undefined;
  readonly detail?: string | undefined;
}): string | undefined {
  const collected: string[] = [];
  collectImagePaths(input.data, collected, new Set<string>(), 0);
  return firstImagePath([...collected, ...(input.changedFiles ?? []), input.detail]);
}

/** True when the project still uses automatic detection instead of a stored icon. */
export function projectNeedsGeneratedIcon(faviconPath: string | null | undefined): boolean {
  return faviconPath == null || faviconPath.length === 0;
}
