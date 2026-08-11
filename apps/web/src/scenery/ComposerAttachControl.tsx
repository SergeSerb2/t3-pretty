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
 * limits and error toasts are all upstream's. Non-image files become pending
 * path attachments: chips render in the composer chrome, and the absolute
 * filepath is baked into the outgoing prompt at send time (stripped from the
 * bubble), invisible in the editor.
 */
import { FileIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { classifyAttachment, createAttachedFileRef, type AttachedFileRef } from "./attachFiles";
import { addAttachedFiles, removeAttachedFile, useAttachedFiles } from "./attachedFileStore";
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

function deliverFiles(slot: Element, threadKey: string | null, files: ReadonlyArray<File>): void {
  const imageFiles: File[] = [];
  const pathFiles: AttachedFileRef[] = [];
  for (const file of files) {
    if (classifyAttachment(file) === "image") {
      imageFiles.push(file);
    } else {
      pathFiles.push(createAttachedFileRef(file));
    }
  }
  if (threadKey && pathFiles.length > 0) {
    addAttachedFiles(threadKey, pathFiles);
  }
  // One drop for the image batch: the composer validates them together, so the
  // attachment-count limit sees the whole pick at once.
  dropFiles(slot, imageFiles);
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden fill="none">
      <path
        d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AttachedFileChip(props: { file: AttachedFileRef; onRemove: (fileId: string) => void }) {
  const extension = props.file.name.includes(".")
    ? props.file.name.slice(props.file.name.lastIndexOf(".") + 1).toUpperCase()
    : "FILE";
  return (
    <div className="scenery-attach-file-chip" title={props.file.path}>
      <div className="scenery-attach-file-chip__icon" aria-hidden>
        <FileIcon className="size-5" />
        <span className="scenery-attach-file-chip__ext">{extension.slice(0, 4)}</span>
      </div>
      <div className="scenery-attach-file-chip__meta">
        <span className="scenery-attach-file-chip__name">{props.file.name}</span>
      </div>
      <button
        type="button"
        className="scenery-attach-file-chip__remove"
        aria-label={`Remove ${props.file.name}`}
        onClick={() => props.onRemove(props.file.id)}
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
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
    let nextSlotId = 0;

    const sync = () => {
      queued = false;
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

    const observer = new MutationObserver(() => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(sync);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    sync();
    return () => {
      observer.disconnect();
      for (const slot of managedButtons.values()) {
        slot.remove();
      }
      for (const slot of managedStrips.values()) {
        slot.remove();
      }
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
              <button
                type="button"
                className="scenery-attach-button"
                aria-label="Attach files or photos"
                title="Attach files or photos"
                onClick={() => inputRefs.current.get(slot)?.click()}
              >
                <PaperclipIcon />
              </button>
              <input
                ref={(element) => {
                  inputRefs.current.set(slot, element);
                }}
                type="file"
                multiple
                hidden
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  deliverFiles(slot, threadKey, files);
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
