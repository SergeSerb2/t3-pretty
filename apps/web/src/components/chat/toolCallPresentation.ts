import {
  buildToolCallDisplaySections,
  formatChangedFileDiffText,
  leftoverChangedFilePaths,
  serializeToolCallDisplaySections,
  toolCallDisplayAddsStructure,
  type ToolCallDisplaySection,
} from "@t3tools/shared/shellCommandFormat";

import type { ChangedFileDiff } from "../../session-logic";

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
  readonly changedFileDiffs?: ReadonlyArray<ChangedFileDiff> | null | undefined;
  readonly command?: string | null | undefined;
  readonly itemType?: string | undefined;
  readonly output?: string | null | undefined;
  readonly toolData?: unknown;
}): ToolCallDisplaySection[] {
  const mcpText =
    input.itemType === "mcp_tool_call" && input.toolData !== undefined
      ? `MCP call\n${JSON.stringify(input.toolData, null, 2)}`
      : null;
  const diffs = input.changedFileDiffs ?? [];
  const diffText = formatChangedFileDiffText(diffs);
  const changedPaths = (input.changedFilesText ?? "")
    .split("\n")
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
  const leftoverPaths = leftoverChangedFilePaths(changedPaths, diffs);
  return buildToolCallDisplaySections({
    leadingText: mcpText,
    command: input.command ?? null,
    output: diffText ? null : (input.output ?? null),
    diffText,
    trailingText: leftoverPaths ?? (diffText ? null : (input.changedFilesText ?? null)),
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
