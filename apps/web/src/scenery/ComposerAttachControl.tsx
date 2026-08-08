/**
 * The composer attach button, injected from the fork module so no upstream
 * file changes. A slot element is inserted at the front of the composer's
 * right action group (found by [data-chat-composer-actions="right"], pinned
 * by sceneryDomContract.test.ts) and a React portal renders the button into
 * it; a MutationObserver re-finds the group across thread switches.
 *
 * Picked files reach the composer through its own event surface instead of
 * private APIs: images are dispatched as a synthetic drop carrying Files —
 * the exact path an OS drag takes, so validation, compression, attachment
 * limits and error toasts are all upstream's — and text files ride the
 * mention-drop channel, which inserts prompt text through the editor's
 * proper insert path.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { COMPOSER_MENTION_DRAG_TYPE } from "../components/chat/composerMentionDrag";
import { classifyAttachment, looksBinary, textAttachmentPayload } from "./attachFiles";
import "./composerAttach.css";

const HOST_SELECTOR = '[data-chat-composer-actions="right"]';
const SLOT_CLASS = "scenery-attach-slot";

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

async function deliverFiles(slot: Element, files: ReadonlyArray<File>): Promise<void> {
  const dropPath: File[] = [];
  for (const file of files) {
    if (classifyAttachment(file) !== "text") {
      dropPath.push(file);
      continue;
    }
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
  }
  // One drop for the batch: the composer validates them together, so the
  // attachment-count limit sees the whole pick at once.
  dropFiles(slot, dropPath);
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

export function ComposerAttachControl() {
  const [slots, setSlots] = useState<ReadonlyArray<HTMLElement>>([]);
  const inputRefs = useRef(new Map<HTMLElement, HTMLInputElement | null>());

  useEffect(() => {
    const managed = new Map<Element, HTMLElement>();
    let queued = false;

    const sync = () => {
      queued = false;
      const hosts = [...document.querySelectorAll(HOST_SELECTOR)];
      let changed = false;
      for (const [host, slot] of managed) {
        if (!host.isConnected || !hosts.includes(host)) {
          slot.remove();
          managed.delete(host);
          changed = true;
        }
      }
      for (const host of hosts) {
        const existing = managed.get(host);
        if (existing?.parentElement === host) {
          continue;
        }
        const slot = existing ?? document.createElement("span");
        slot.className = SLOT_CLASS;
        host.insertBefore(slot, host.firstChild);
        managed.set(host, slot);
        changed = true;
      }
      if (changed) {
        setSlots([...managed.values()]);
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
      for (const slot of managed.values()) {
        slot.remove();
      }
      setSlots([]);
    };
  }, []);

  return (
    <>
      {slots.map((slot, index) => (
        <span key={index}>
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
                  void deliverFiles(slot, files);
                }}
              />
            </>,
            slot,
          )}
        </span>
      ))}
    </>
  );
}
