import { EMPTY_ENVIRONMENT_THREAD_STATE } from "@t3tools/client-runtime/state/threads";
import type { OrchestrationMessage, ScopedThreadRef } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { readThreadDetail } from "../state/entities";
import { environmentThreads } from "../state/threads";

export function formatThreadConversation(
  title: string,
  messages: ReadonlyArray<Pick<OrchestrationMessage, "role" | "text">>,
): string {
  const body: string[] = [];
  const trimmedTitle = title.trim();
  if (trimmedTitle.length > 0) {
    body.push(trimmedTitle);
  }
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = message.text.trim();
    if (text.length === 0) continue;
    body.push(`${message.role === "user" ? "User" : "Assistant"}:\n${text}`);
  }
  return body.join("\n\n");
}

function conversationFromMessages(
  title: string,
  messages: ReadonlyArray<Pick<OrchestrationMessage, "role" | "text">>,
): string | null {
  const text = formatThreadConversation(title, messages);
  return text.length > 0 ? text : null;
}

/** Copy waits this long for thread state before giving up. */
const THREAD_CONVERSATION_LOAD_TIMEOUT_MS = 8_000;

/**
 * Conversation text for a thread. Uses an already-loaded detail when one
 * exists; otherwise mounts the thread state atom until thread data arrives or
 * a terminal error lands, or until `timeoutMs`.
 */
export function loadThreadConversationText(
  threadRef: ScopedThreadRef,
  title: string,
  timeoutMs = THREAD_CONVERSATION_LOAD_TIMEOUT_MS,
): Promise<string | null> {
  const loaded = readThreadDetail(threadRef);
  if (loaded !== null) {
    return Promise.resolve(conversationFromMessages(title, loaded.messages));
  }

  return new Promise((resolve, reject) => {
    const atom = environmentThreads.stateAtom(threadRef.environmentId, threadRef.threadId);
    let settled = false;
    let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

    // immediate: true runs the listener during subscribe(), before it returns.
    let unsubscribe = () => {};
    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeoutId !== null) {
        globalThis.clearTimeout(timeoutId);
      }
      unsubscribe();
      callback();
    };
    const finish = (text: string | null) => settle(() => resolve(text));
    const fail = (error: Error) => settle(() => reject(error));

    unsubscribe = appAtomRegistry.subscribe(
      atom,
      (result) => {
        // A failed atom may hold no value at all; without this check the
        // EMPTY fallback below would wait out the full timeout instead.
        if (AsyncResult.isFailure(result)) {
          const error = Cause.squash(result.cause);
          fail(error instanceof Error ? error : new Error("Failed to load conversation"));
          return;
        }
        const state = Option.getOrElse(
          AsyncResult.value(result),
          () => EMPTY_ENVIRONMENT_THREAD_STATE,
        );
        if (Option.isSome(state.error)) {
          fail(new Error(state.error.value));
          return;
        }
        if (Option.isNone(state.data)) {
          // A live/success state can still lack data; keep waiting so an
          // unloaded thread never resolves as an empty conversation.
          return;
        }
        finish(conversationFromMessages(title, state.data.value.messages));
      },
      { immediate: true },
    );

    if (settled) {
      unsubscribe();
      return;
    }
    timeoutId = globalThis.setTimeout(() => {
      fail(new Error("Timed out loading conversation"));
    }, timeoutMs);
  });
}
