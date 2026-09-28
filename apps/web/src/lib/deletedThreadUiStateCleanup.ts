import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { removeThreadFaviconState } from "../browserFaviconStore";
import { removeThreadBrowserHistoryState } from "../browserHistoryStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { useDiffPanelStore } from "../diffPanelStore";
import { usePreviewMiniPlayerStore } from "../previewMiniPlayerStore";
import { useRightPanelStore } from "../rightPanelStore";
import { useSceneryStore } from "../scenery/sceneryStore";
import { useTerminalUiStateStore } from "../terminalUiStateStore";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { useUiStateStore } from "../uiStateStore";

/** Remove every client-owned surface keyed to a permanently deleted thread. */
export function removeDeletedThreadUiState(ref: ScopedThreadRef): void {
  const threadKey = scopedThreadKey(ref);
  useThreadSelectionStore.getState().removeFromSelection([threadKey]);
  removeThreadFaviconState(ref);
  removeThreadBrowserHistoryState(ref);
  useComposerDraftStore.getState().clearDraftThread(ref);
  useTerminalUiStateStore.getState().clearTerminalUiState(ref);
  useRightPanelStore.getState().removeThread(ref);
  useDiffPanelStore.getState().removeThread(ref);
  usePreviewMiniPlayerStore.getState().removeThread(ref);
  useSceneryStore.getState().removeThread(threadKey);
  useUiStateStore.getState().removeThread(threadKey);
}
