import { ENTITY_ID_MAX_LENGTH, type OrchestrationSessionStatus } from "@t3tools/contracts";

import { stripCreatePullRequestSuffix } from "./createPullRequestPrompt.ts";

export const NATIVE_RESUME_THREAD_TITLE = "Resumed native session";

export type NativeResumeCommand =
  | { readonly _tag: "Resume"; readonly sessionId: string }
  | { readonly _tag: "Invalid" };

export function isNativeResumeSessionReady(
  status: OrchestrationSessionStatus | null | undefined,
): boolean {
  return status === "ready";
}

export function restoreFailedNativeResumePrompt(
  currentPrompt: string,
  optimisticMessageTexts: ReadonlyArray<string>,
): string | null {
  const command = optimisticMessageTexts
    .map(parseNativeResumeCommand)
    .findLast((candidate) => candidate?._tag === "Resume");
  if (command?._tag !== "Resume") return null;
  const retryPrompt = `/resume ${command.sessionId}`;
  return currentPrompt.length > 0 ? `${retryPrompt}\n\n${currentPrompt}` : retryPrompt;
}

export function parseNativeResumeCommand(text: string): NativeResumeCommand | null {
  const visibleText = stripCreatePullRequestSuffix(text).trim();
  if (!/^\/resume(?:\s|$)/iu.test(visibleText)) {
    return null;
  }

  const match = /^\/resume\s+(\S+)$/iu.exec(visibleText);
  const sessionId = match?.[1];
  return sessionId && sessionId.length <= ENTITY_ID_MAX_LENGTH
    ? { _tag: "Resume", sessionId }
    : { _tag: "Invalid" };
}
