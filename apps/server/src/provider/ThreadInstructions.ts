import {
  hiddenInstructionCloseMarker,
  hiddenInstructionOpenMarker,
} from "@t3tools/shared/hiddenInstructionBlocks";

/** Append T3 guidance at the provider boundary, leaving the user's stored message intact. */
export function threadInstructionsPrompt(
  text: string,
  globalInstructions: string,
  projectInstructions: string,
): string {
  const sections = [
    globalInstructions.trim() === "" ? "" : `Global instructions:\n${globalInstructions.trim()}`,
    projectInstructions.trim() === "" ? "" : `Project instructions:\n${projectInstructions.trim()}`,
  ].filter((section) => section !== "");
  if (sections.length === 0 || text.trimStart().startsWith("/")) return text;
  return `${text}\n\n${hiddenInstructionOpenMarker("t3_thread_instructions")}\n${sections.join("\n\n")}\n${hiddenInstructionCloseMarker("t3_thread_instructions")}`;
}
