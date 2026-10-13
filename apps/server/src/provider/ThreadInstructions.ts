import {
  hiddenInstructionCloseMarker,
  hiddenInstructionOpenMarker,
} from "@t3tools/shared/hiddenInstructionBlocks";

const TYPESCRIPT_VALIDATION_INSTRUCTIONS = `TypeScript validation:
If the project uses TypeScript, always typecheck and compile the relevant packages before you report the task complete.
Use tsc-rs from https://github.com/pingdotgg/ts-rust for TypeScript checks and compiler output.
Use the project's package manager, existing tsconfig files, and compiler options. Reuse scripts that already run tsc-rs.
For typechecking, run tsc-rs --noEmit -p <tsconfig>.
For builds that use tsc or tsgo, run tsc-rs with the existing build configuration and emit options. For project references, use tsc-rs -b <build-tsconfig>.
For bundler or framework builds, also run the project's existing build command.
If tsc-rs is missing, use the package manager's temporary package runner without changing project dependencies or lockfiles.
If the platform or project configuration prevents tsc-rs from running, use the existing compiler. Report the reason.
Respect explicit user instructions and project limits on validation scope.`;

/** Append T3 guidance at the provider boundary, leaving the user's stored message intact. */
export function threadInstructionsPrompt(
  text: string,
  globalInstructions: string,
  projectInstructions: string,
): string {
  if (text.trimStart().startsWith("/")) return text;
  const sections = [
    TYPESCRIPT_VALIDATION_INSTRUCTIONS,
    globalInstructions.trim() === "" ? "" : `Global instructions:\n${globalInstructions.trim()}`,
    projectInstructions.trim() === "" ? "" : `Project instructions:\n${projectInstructions.trim()}`,
  ].filter((section) => section !== "");
  return `${text}\n\n${hiddenInstructionOpenMarker("t3_thread_instructions")}\n${sections.join("\n\n")}\n${hiddenInstructionCloseMarker("t3_thread_instructions")}`;
}
