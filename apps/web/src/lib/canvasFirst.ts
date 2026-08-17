import type { CanvasDocument, EnvironmentId, ServerConfig } from "@t3tools/contracts";

import type { CanvasSelectionNodeSummary } from "./canvasSelection";

export type DraftStartSurface = "chat" | "canvas";

export function environmentSupportsCanvas(
  serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>,
  environmentId: EnvironmentId,
): boolean {
  return serverConfigs.get(environmentId)?.environment.capabilities.canvas === true;
}

export function anyEnvironmentSupportsCanvas(
  serverConfigs: ReadonlyMap<EnvironmentId, ServerConfig>,
): boolean {
  for (const config of serverConfigs.values()) {
    if (config.environment.capabilities.canvas === true) return true;
  }
  return false;
}

/**
 * Nodes to send with a canvas-first turn: the current selection if any,
 * otherwise every node in the document.
 */
export function canvasFirstSendNodeIds(
  doc: CanvasDocument,
  selectedIds: readonly string[],
): string[] {
  const selected = selectedIds.filter((id) => doc.nodes.some((node) => node.id === id));
  if (selected.length > 0) return selected;
  return doc.nodes.map((node) => node.id);
}

export function canvasFirstTitleSeed(input: {
  note: string;
  nodes: ReadonlyArray<CanvasSelectionNodeSummary>;
}): string {
  const note = input.note.trim().split("\n", 1)[0]?.trim() ?? "";
  if (note.length > 0) return note;
  const named = input.nodes.find((node) => node.name?.trim());
  const name = named?.name?.trim();
  return name && name.length > 0 ? name : "Canvas";
}
