import {
  buildToolCallDisplaySections,
  serializeToolCallDisplaySections,
  toolCallDisplayAddsStructure,
  type ToolCallDisplaySection,
} from "@t3tools/shared/shellCommandFormat";

export function resolveToolCallCommand(workEntry: {
  readonly command?: string;
  readonly rawCommand?: string;
}): string | null {
  const command = workEntry.command?.trim();
  const rawCommand = workEntry.rawCommand?.trim();
  if (rawCommand && command && rawCommand !== command) {
    return rawCommand;
  }
  return command || rawCommand || null;
}

export function buildWorkEntryDisplaySections(input: {
  readonly changedFilesText?: string | null | undefined;
  readonly command?: string | null | undefined;
  readonly itemType?: string | undefined;
  readonly output?: string | null | undefined;
  readonly toolData?: unknown;
}): ToolCallDisplaySection[] {
  const mcpText =
    input.itemType === "mcp_tool_call" && input.toolData !== undefined
      ? `MCP call\n${JSON.stringify(input.toolData, null, 2)}`
      : null;
  return buildToolCallDisplaySections({
    leadingText: mcpText,
    command: input.command ?? null,
    output: input.output ?? null,
    trailingText: input.changedFilesText ?? null,
  });
}

export function workEntryDisplayBody(
  sections: ReadonlyArray<ToolCallDisplaySection>,
): string | null {
  return serializeToolCallDisplaySections(sections);
}

export function workEntryDisplayAddsStructure(
  sections: ReadonlyArray<ToolCallDisplaySection>,
): boolean {
  return toolCallDisplayAddsStructure(sections);
}
