/**
 * The composer attach button, injected from the fork module so no upstream
 * file changes are required for the control itself. A slot element is inserted
 * at the front of the composer's right action group (found by
 * [data-chat-composer-actions="right"], pinned by sceneryDomContract.test.ts)
 * and a React portal renders the button into it; a MutationObserver re-finds
 * the group across thread switches.
 *
 * Picked files reach the composer through its own event surface instead of
 * private APIs: images are dispatched as a synthetic drop carrying Files —
 * the exact path an OS drag takes, so validation, compression, attachment
 * limits and error toasts are all upstream's. Non-image files with a real
 * absolute path (desktop `desktopBridge.getPathForFile`) become pending path
 * attachments: chips in the composer chrome, filepath baked into the outgoing
 * prompt at send time.
 * Browser picks have no absolute path — text is inserted into the prompt via
 * the mention-drop channel; other files fall through the images drop path so
 * the composer refuses them instead of claiming an unreadable basename.
 */
import { FileIcon, PaperclipIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { COMPOSER_MENTION_DRAG_TYPE } from "../components/chat/composerMentionDrag";
import { toastManager } from "../components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import {
  classifyAttachment,
  createAttachedFileRef,
  looksBinary,
  textAttachmentPayload,
  type AttachedFileRef,
} from "./attachFiles";
import {
  addAttachedFiles,
  ATTACHED_FILE_PATH_MAX_COUNT,
  removeAttachedFile,
  useAttachedFiles,
} from "./attachedFileStore";
import { mutationsRequireComposerAttachSync } from "./composerAttachMutations";
import { useActiveThreadKey } from "./useActiveThreadKey";
import "./composerAttach.css";

const HOST_SELECTOR = '[data-chat-composer-actions="right"]';
const STRIP_HOST_SELECTOR = '[data-chat-composer-editor-chrome="true"]';
const SLOT_CLASS = "scenery-attach-slot";
const STRIP_SLOT_CLASS = "scenery-attach-strip-slot";

function dispatchDrop(target: Element, dataTransfer: DataTransfer): void {
  target.dispatchEvent(
    new DragEvent("drop", { bubbles: true, cancelable: true, composed: true, dataTransfer }),
  );
}

function dropFiles(target: Element, files: ReadonlyArray<File>): void {
  if (files.length === 0) {
    return;
  }
  const transfer = new DataTransfer();
  for (const file of files) {
    transfer.items.add(file);
  }
  dispatchDrop(target, transfer);
}

function dropPromptText(target: Element, payload: string): void {
  const transfer = new DataTransfer();
  transfer.setData(COMPOSER_MENTION_DRAG_TYPE, payload);
  dispatchDrop(target, transfer);
}

async function deliverFiles(
  slot: Element,
  threadKey: string | null,
  files: ReadonlyArray<File>,
): Promise<void> {
  const dropPath: File[] = [];
  const pathFiles: AttachedFileRef[] = [];
  for (const file of files) {
    const kind = classifyAttachment(file);
    if (kind === "image") {
      dropPath.push(file);
      continue;
    }

    const pathRef = createAttachedFileRef(file);
    if (pathRef) {
      pathFiles.push(pathRef);
      continue;
    }

    // No absolute path (typical browser pick). Inline readable text; otherwise
    // let the composer's images-only drop path refuse the file.
    if (kind === "text") {
      try {
        const content = await file.text();
        if (looksBinary(content)) {
          dropPath.push(file);
        } else {
          dropPromptText(slot, textAttachmentPayload(file.name, content));
        }
      } catch {
        dropPath.push(file);
      }
      continue;
    }

    dropPath.push(file);
  }
  if (threadKey && pathFiles.length > 0) {
    const update = addAttachedFiles(threadKey, pathFiles);
    if (update.droppedCount > 0) {
      toastManager.add({
        type: "warning",
        title: `You can attach up to ${ATTACHED_FILE_PATH_MAX_COUNT} files per message.`,
      });
    }
  }
  // One drop for the image/binary batch: the composer validates them together,
  // so the attachment-count limit sees the whole pick at once.
  dropFiles(slot, dropPath);
}

function AttachedFileChip(props: { file: AttachedFileRef; onRemove: (fileId: string) => void }) {
  const extension = props.file.name.includes(".")
    ? props.file.name.slice(props.file.name.lastIndexOf(".") + 1).toUpperCase()
    : "FILE";
  return (
    <Tooltip>
      <TooltipTrigger render={<div className="scenery-attach-file-chip" />}>
        <div className="scenery-attach-file-chip__icon" aria-hidden>
          <FileIcon className="size-5" />
          <span className="scenery-attach-file-chip__ext">{extension.slice(0, 4)}</span>
        </div>
        <div className="scenery-attach-file-chip__meta">
          <span className="scenery-attach-file-chip__name">{props.file.name}</span>
        </div>
        <button
          type="button"
          data-animate-ui-icons
          className="scenery-attach-file-chip__remove"
          aria-label={`Remove ${props.file.name}`}
          onClick={() => props.onRemove(props.file.id)}
        >
          <XIcon className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipPopup side="top" className="max-w-sm break-all font-mono">
        {props.file.path}
      </TooltipPopup>
    </Tooltip>
  );
}

function AttachedFileStrip(props: {
  files: ReadonlyArray<AttachedFileRef>;
  onRemove: (fileId: string) => void;
}) {
  if (props.files.length === 0) {
    return null;
  }
  return (
    <div className="scenery-attach-file-strip" data-scenery-attach-file-strip="true">
      {props.files.map((file) => (
        <AttachedFileChip key={file.id} file={file} onRemove={props.onRemove} />
      ))}
    </div>
  );
}

export function ComposerAttachControl() {
  const threadKey = useActiveThreadKey();
  const attachedFiles = useAttachedFiles(threadKey);
  const [buttonSlots, setButtonSlots] = useState<ReadonlyArray<HTMLElement>>([]);
  const [stripSlots, setStripSlots] = useState<ReadonlyArray<HTMLElement>>([]);
  const inputRefs = useRef(new Map<HTMLElement, HTMLInputElement | null>());

  useEffect(() => {
    const managedButtons = new Map<Element, HTMLElement>();
    const managedStrips = new Map<Element, HTMLElement>();
    let queued = false;
    let syncFrame: number | null = null;
    let nextSlotId = 0;

    const sync = () => {
      queued = false;
      syncFrame = null;
      const buttonHosts = [...document.querySelectorAll(HOST_SELECTOR)];
      const stripHosts = [...document.querySelectorAll(STRIP_HOST_SELECTOR)];
      let buttonsChanged = false;
      let stripsChanged = false;

      for (const [host, slot] of managedButtons) {
        if (!host.isConnected || !buttonHosts.includes(host)) {
          slot.remove();
          managedButtons.delete(host);
          buttonsChanged = true;
        }
      }
      for (const host of buttonHosts) {
        const existing = managedButtons.get(host);
        if (existing?.parentElement === host) {
          continue;
        }
        const slot = existing ?? document.createElement("span");
        slot.dataset.scenerySlotId ??= String(nextSlotId++);
        slot.className = SLOT_CLASS;
        host.insertBefore(slot, host.firstChild);
        managedButtons.set(host, slot);
        buttonsChanged = true;
      }

      for (const [host, slot] of managedStrips) {
        if (!host.isConnected || !stripHosts.includes(host)) {
          slot.remove();
          managedStrips.delete(host);
          stripsChanged = true;
        }
      }
      for (const host of stripHosts) {
        const existing = managedStrips.get(host);
        if (existing?.parentElement === host && existing === host.firstElementChild) {
          continue;
        }
        const slot = existing ?? document.createElement("div");
        slot.dataset.scenerySlotId ??= String(nextSlotId++);
        slot.className = STRIP_SLOT_CLASS;
        host.insertBefore(slot, host.firstChild);
        managedStrips.set(host, slot);
        stripsChanged = true;
      }

      if (buttonsChanged) {
        setButtonSlots([...managedButtons.values()]);
      }
      if (stripsChanged) {
        setStripSlots([...managedStrips.values()]);
      }
    };

    const observer = new MutationObserver((mutations) => {
      if (!mutationsRequireComposerAttachSync(mutations)) {
        return;
      }
      if (!queued) {
        queued = true;
        syncFrame = requestAnimationFrame(sync);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => {
      observer.disconnect();
      if (syncFrame !== null) {
        cancelAnimationFrame(syncFrame);
      }
      for (const slot of managedButtons.values()) {
        slot.remove();
      }
      for (const slot of managedStrips.values()) {
        slot.remove();
      }
      inputRefs.current.clear();
      setButtonSlots([]);
      setStripSlots([]);
    };
  }, []);

  return (
    <>
      {buttonSlots.map((slot) => (
        <span key={slot.dataset.scenerySlotId}>
          {createPortal(
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      data-animate-ui-icons
                      className="scenery-attach-button"
                      aria-label="Attach files or photos"
                      onClick={() => inputRefs.current.get(slot)?.click()}
                    />
                  }
                >
                  <PaperclipIcon className="size-4" aria-hidden />
                </TooltipTrigger>
                <TooltipPopup side="top">Attach files or photos</TooltipPopup>
              </Tooltip>
              <input
                ref={(element) => {
                  if (element === null) {
                    inputRefs.current.delete(slot);
                  } else {
                    inputRefs.current.set(slot, element);
                  }
                }}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  void deliverFiles(slot, threadKey, files);
                }}
              />
            </>,
            slot,
          )}
        </span>
      ))}
      {stripSlots.map((slot) => (
        <div key={slot.dataset.scenerySlotId}>
          {createPortal(
            <AttachedFileStrip
              files={attachedFiles}
              onRemove={(fileId) => {
                if (threadKey) {
                  removeAttachedFile(threadKey, fileId);
                }
              }}
            />,
            slot,
          )}
        </div>
      ))}
    </>
  );
}
