import { TextGenerationError } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isTextGenerationError = Schema.is(TextGenerationError);

export const TEXT_GENERATION_RESULT_MAX_BYTES = 1024 * 1024;
export const TEXT_GENERATION_DIAGNOSTIC_MAX_BYTES = 64 * 1024;
const TEXT_GENERATION_ERROR_DETAIL_MAX_CHARS = 4_000;
const TEXT_GENERATION_OUTPUT_CHUNK_COMPACTION_THRESHOLD = 4_096;
const textGenerationOutputEncoder = new TextEncoder();
const textGenerationOutputDecoder = new TextDecoder("utf-8");

export interface BoundedTextGenerationOutput {
  chunks: Uint8Array[];
  byteLength: number;
  truncated: boolean;
}

export const makeBoundedTextGenerationOutput = (): BoundedTextGenerationOutput => ({
  chunks: [],
  byteLength: 0,
  truncated: false,
});

export const appendBoundedTextGenerationOutput = (
  state: BoundedTextGenerationOutput,
  value: string,
): BoundedTextGenerationOutput => {
  if (state.truncated || value.length === 0) return state;

  const remainingBytes = TEXT_GENERATION_RESULT_MAX_BYTES - state.byteLength;
  if (remainingBytes <= 0) return { ...state, truncated: true };

  const candidate = value.length > remainingBytes ? value.slice(0, remainingBytes) : value;
  const encoded = textGenerationOutputEncoder.encode(candidate);
  const retained = encoded.byteLength > remainingBytes ? encoded.slice(0, remainingBytes) : encoded;
  state.chunks.push(retained);
  const truncated = candidate.length < value.length || encoded.byteLength > remainingBytes;

  if (state.chunks.length >= TEXT_GENERATION_OUTPUT_CHUNK_COMPACTION_THRESHOLD) {
    const compacted = new Uint8Array(state.byteLength + retained.byteLength);
    let offset = 0;
    for (const chunk of state.chunks) {
      compacted.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      chunks: [compacted],
      byteLength: compacted.byteLength,
      truncated,
    };
  }

  return {
    chunks: state.chunks,
    byteLength: state.byteLength + retained.byteLength,
    truncated,
  };
};

export const decodeBoundedTextGenerationOutput = (state: BoundedTextGenerationOutput): string => {
  const bytes = new Uint8Array(state.byteLength);
  let offset = 0;
  for (const chunk of state.chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return textGenerationOutputDecoder.decode(bytes);
};

/** Convert an Effect Schema to a flat JSON Schema object, inlining `$defs` when present. */
export function toJsonSchemaObject(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(schema);
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    return { ...document.schema, $defs: document.definitions };
  }
  return document.schema;
}

/** Truncate a text section to `maxChars`, appending a `[truncated]` marker when needed. */
export function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const truncated = value.slice(0, maxChars);
  return `${truncated}\n\n[truncated]`;
}

export const limitTextGenerationErrorDetail = (value: string): string =>
  limitSection(value, TEXT_GENERATION_ERROR_DETAIL_MAX_CHARS);

/** Normalise a raw commit subject to imperative-mood, ≤72 chars, no trailing period. */
export function sanitizeCommitSubject(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  const withoutTrailingPeriod = singleLine.replace(/[.]+$/g, "").trim();
  if (withoutTrailingPeriod.length === 0) {
    return "Update project files";
  }

  if (withoutTrailingPeriod.length <= 72) {
    return withoutTrailingPeriod;
  }
  return withoutTrailingPeriod.slice(0, 72).trimEnd();
}

/** Normalise a raw PR title to a single line with a sensible fallback. */
export function sanitizePrTitle(raw: string): string {
  const singleLine = raw.trim().split(/\r?\n/g)[0]?.trim() ?? "";
  if (singleLine.length > 0) {
    return singleLine;
  }
  return "Update project changes";
}

/** Normalise a raw thread title to a compact single-line sidebar-safe label. */
export function sanitizeThreadTitle(raw: string): string {
  const normalized = raw
    .trim()
    .split(/\r?\n/g)[0]
    ?.trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized || normalized.trim().length === 0) {
    return "New thread";
  }

  if (normalized.length <= 50) {
    return normalized;
  }

  return `${normalized.slice(0, 47).trimEnd()}...`;
}

/**
 * Normalise a raw activity headline to one compact status-line label.
 * Returns "" when nothing usable remains; callers skip publishing then.
 */
export function sanitizeActivityHeadline(raw: string): string {
  const normalized = raw
    .trim()
    .split(/\r?\n/g)[0]
    ?.trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/[.]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");

  if (!normalized) {
    return "";
  }
  if (normalized.length <= 60) {
    return normalized;
  }
  return `${normalized.slice(0, 57).trimEnd()}...`;
}

/** CLI name to human-readable label, e.g. "codex" → "Codex CLI (`codex`)" */
function cliLabel(cliName: string): string {
  const capitalized = cliName.charAt(0).toUpperCase() + cliName.slice(1);
  return `${capitalized} CLI (\`${cliName}\`)`;
}

/**
 * Normalize an unknown error from a CLI text generation process into a
 * typed `TextGenerationError`. Parameterized by CLI name so both Codex
 * and Claude (and future providers) can share the same logic.
 */
export function normalizeCliError(
  cliName: string,
  operation: string,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (isTextGenerationError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes(`Command not found: ${cliName}`) ||
      lower.includes(`spawn ${cliName}`) ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: `${cliLabel(cliName)} is required but not available on PATH.`,
        cause: error,
      });
    }
    return new TextGenerationError({
      operation,
      detail: fallback,
      cause: error,
    });
  }

  return new TextGenerationError({
    operation,
    detail: fallback,
    cause: error,
  });
}
