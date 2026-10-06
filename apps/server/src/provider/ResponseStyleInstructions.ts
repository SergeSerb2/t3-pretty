import {
  hiddenInstructionCloseMarker,
  hiddenInstructionOpenMarker,
} from "@t3tools/shared/hiddenInstructionBlocks";

const CLEAR_RESPONSE_INSTRUCTIONS = `T3 Pretty's Clear responses setting is on for this prompt. Apply this guidance silently.
For user-facing English prose, aim for approximately 80% adherence to ASD-STE100 Simplified Technical English principles. Use short sentences, one topic per sentence, active voice, simple common words, and consistent terms. Explain necessary technical terms. Treat 80% as a style target, not a measured score or a claim of strict compliance. Do not change code, commands, paths, identifiers, quotations, or exact technical names to meet this prose-style target. Follow the user's requested language, format, and level of detail.
Visualize the response when a table, diagram, chart, or other visual makes it easier to understand. Use available rendering tools when they fit the task. Keep simple answers in prose, and do not add a visual that merely repeats the text.`;

const DISABLED_RESPONSE_INSTRUCTIONS = `T3 Pretty's Clear responses setting is off for this prompt. Stop applying the earlier T3 Pretty response-style guidance. Follow the user's requested style; visuals remain optional.`;

/** Applied at delivery so saved messages stay unchanged and existing threads follow the setting. */
export function responseStylePrompt(text: string, enabled: boolean): string {
  // Providers interpret slash commands themselves; extra text can change their arguments.
  if (text.trimStart().startsWith("/")) return text;
  return `${text}\n\n${hiddenInstructionOpenMarker("t3_pretty_response_style")}\n${enabled ? CLEAR_RESPONSE_INSTRUCTIONS : DISABLED_RESPONSE_INSTRUCTIONS}\n${hiddenInstructionCloseMarker("t3_pretty_response_style")}`;
}
