export function appendDictationSegment(transcript: string, segment: string): string {
  const next = segment.trim();
  return next.length === 0 ? transcript : [transcript.trim(), next].filter(Boolean).join(" ");
}

export function formatDictationInsertion(input: {
  readonly before: string;
  readonly after: string;
  readonly transcript: string;
}): string {
  const text = input.transcript.trim();
  if (text.length === 0) return "";
  const prefix =
    input.before.length > 0 &&
    !/\s$/.test(input.before) &&
    !/[([{/]$/.test(input.before) &&
    !/^[,.;:!?)}\]]/.test(text)
      ? " "
      : "";
  const suffix =
    input.after.length > 0 && !/^\s/.test(input.after) && !/^[,.;:!?)}\]]/.test(input.after)
      ? " "
      : "";
  return `${prefix}${text}${suffix}`;
}

export function replaceDictationInsertion(input: {
  readonly value: string;
  readonly start: number;
  readonly before: string;
  readonly after: string;
  readonly previous: string;
  readonly next: string;
}): { readonly value: string; readonly cursor: number } | null {
  if (
    input.start !== input.before.length ||
    input.value !== `${input.before}${input.previous}${input.after}`
  ) {
    return null;
  }
  return {
    value: `${input.before}${input.next}${input.after}`,
    cursor: input.start + input.next.length,
  };
}
