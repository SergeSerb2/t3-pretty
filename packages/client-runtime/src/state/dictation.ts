export function appendDictationSegment(transcript: string, segment: string): string {
  const next = segment.trim();
  return next.length === 0 ? transcript : [transcript.trim(), next].filter(Boolean).join(" ");
}

// The recognizer revises the phrase currently being spoken. Older words stay.
const UNSTABLE_WORD_COUNT = 3;

function normalizeDictationSpaces(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function dictationWords(text: string): string[] {
  const normalized = normalizeDictationSpaces(text);
  return normalized.length === 0 ? [] : normalized.split(" ");
}

function dictationWordKey(word: string): string {
  const stripped = word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  return stripped.length > 0 ? stripped : word.toLowerCase();
}

function sameDictationWord(left: string, right: string): boolean {
  return dictationWordKey(left) === dictationWordKey(right);
}

function sameDictationWords(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (!sameDictationWord(left[index]!, right[index]!)) return false;
  }
  return true;
}

function commonDictationPrefixLength(left: readonly string[], right: readonly string[]): number {
  const count = Math.min(left.length, right.length);
  let index = 0;
  while (index < count && sameDictationWord(left[index]!, right[index]!)) index += 1;
  return index;
}

function wordsAfterDictationOverlap(
  previous: readonly string[],
  incoming: readonly string[],
): readonly string[] {
  const max = Math.min(previous.length, incoming.length);
  for (let size = max; size >= 1; size -= 1) {
    if (sameDictationWords(previous.slice(previous.length - size), incoming.slice(0, size))) {
      return incoming.slice(size);
    }
  }
  // A restarted hypothesis can repeat the settled tail after a rewritten head.
  for (let size = max; size >= 2; size -= 1) {
    const suffix = previous.slice(previous.length - size);
    for (let start = 1; start + size <= incoming.length; start += 1) {
      if (!sameDictationWords(suffix, incoming.slice(start, start + size))) continue;
      return incoming.slice(start + size);
    }
  }
  return incoming;
}

function withoutRepeatedDictationPhrase(words: readonly string[]): string[] {
  const result = words.slice();
  let removed = true;
  while (removed) {
    removed = false;
    for (let size = Math.floor(result.length / 2); size >= 3; size -= 1) {
      for (let index = 0; index + size * 2 <= result.length; index += 1) {
        if (
          !sameDictationWords(
            result.slice(index, index + size),
            result.slice(index + size, index + size * 2),
          )
        ) {
          continue;
        }
        result.splice(index + size, size);
        removed = true;
        break;
      }
      if (removed) break;
    }
  }
  return result;
}

/**
 * Merge one speech hypothesis onto text already shown.
 * The engine resends the whole guess, including a shortened window, so this
 * keeps words that are already on screen and adds only the new tail.
 */
export function appendDictationHypothesis(current: string, hypothesis: string): string {
  const incomingWords = dictationWords(hypothesis);
  if (incomingWords.length === 0) return normalizeDictationSpaces(current);
  const previousWords = dictationWords(current);
  if (previousWords.length === 0) return incomingWords.join(" ");

  const mismatch = commonDictationPrefixLength(previousWords, incomingWords);
  if (mismatch === incomingWords.length && incomingWords.length <= previousWords.length) {
    return previousWords.join(" ");
  }
  if (mismatch === previousWords.length) {
    return [...previousWords, ...incomingWords.slice(previousWords.length)].join(" ");
  }

  const unstableStart = Math.max(0, previousWords.length - UNSTABLE_WORD_COUNT);
  if (mismatch > 0 && mismatch >= unstableStart) {
    return [...previousWords.slice(0, mismatch), ...incomingWords.slice(mismatch)].join(" ");
  }

  const addition = wordsAfterDictationOverlap(previousWords, incomingWords);
  if (addition.length === 0) return previousWords.join(" ");
  return [...previousWords, ...addition].join(" ");
}

function cleanupDictationText(text: string): string {
  return withoutRepeatedDictationPhrase(dictationWords(text)).join(" ");
}

/**
 * Settle the dictated text when recording stops.
 * Live text is append-only. The final hypothesis may still add punctuation
 * or a last tail, but it cannot drop words already kept.
 */
export function finishDictationText(accumulated: string, latestHypothesis: string): string {
  const shown = cleanupDictationText(accumulated);
  const latest = cleanupDictationText(latestHypothesis);
  if (latest.length === 0) return shown;
  if (shown.length === 0) return latest;
  const shownWords = dictationWords(shown);
  const latestWords = dictationWords(latest);
  const prefix = commonDictationPrefixLength(shownWords, latestWords);
  if (prefix === shownWords.length && latestWords.length >= shownWords.length) return latest;
  return shown;
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
