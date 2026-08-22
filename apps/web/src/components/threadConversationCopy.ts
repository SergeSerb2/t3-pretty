import { EMPTY_ENVIRONMENT_THREAD_STATE } from "@t3tools/client-runtime/state/threads";
import type { OrchestrationMessage, ScopedThreadRef } from "@t3tools/contracts";
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

/**
 * Conversation text for a thread. Uses an already-loaded detail when one
 * exists; otherwise mounts the thread state atom until it leaves the initial
 * empty/synchronizing states.
 */
export function loadThreadConversationText(
  threadRef: ScopedThreadRef,
  title: string,
): Promise<string | null> {
  const loaded = readThreadDetail(threadRef);
  if (loaded !== null) {
    return Promise.resolve(conversationFromMessages(title, loaded.messages));
  }

  return new Promise((resolve) => {
    const atom = environmentThreads.stateAtom(threadRef.environmentId, threadRef.threadId);
    const unsub = appAtomRegistry.subscribe(
      atom,
      (result) => {
        const state = Option.getOrElse(
          AsyncResult.value(result),
          () => EMPTY_ENVIRONMENT_THREAD_STATE,
        );
        if (
          state.status === "empty" ||
          (state.status === "synchronizing" && Option.isNone(state.error))
        ) {
          return;
        }
        unsub();
        const thread = Option.getOrNull(state.data);
        resolve(conversationFromMessages(title, thread?.messages ?? []));
      },
      { immediate: true },
    );
  });
}
