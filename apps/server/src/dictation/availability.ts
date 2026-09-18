import type { ReadAloudUnavailableReason } from "@t3tools/contracts";
import { T3CODE_BUILD_FLAVOR } from "@t3tools/shared/connectBranding";

export type GroqSpeechAvailability =
  | { readonly available: true; readonly reason: null }
  | { readonly available: false; readonly reason: ReadAloudUnavailableReason };

/** Groq TTS (read aloud) needs an internal build and a host API key. */
export function resolveDictationAvailability(
  buildFlavor = T3CODE_BUILD_FLAVOR,
  apiKey = process.env.GROQ_API_KEY,
): GroqSpeechAvailability {
  if (buildFlavor !== "internal") {
    return { available: false, reason: "internal_build_required" };
  }
  if (!apiKey?.trim()) {
    return { available: false, reason: "groq_api_key_missing" };
  }
  return { available: true, reason: null };
}
