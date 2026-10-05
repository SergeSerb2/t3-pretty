import type { RuntimeRequestId } from "@t3tools/contracts";
import type { ThreadPendingUserInput, ThreadPendingApproval } from "./state/threadRequests.ts";
export type PendingUserInput = ThreadPendingUserInput;
export type PendingApproval = ThreadPendingApproval;

/** An agent's `request_api_key` prompt: one masked question answered outside the event log. */
export interface PendingSecretRequest {
  readonly requestId: RuntimeRequestId;
  readonly createdAt: string;
  /** Environment variable the value is stored under. */
  readonly name: string;
  readonly header: string;
  readonly purpose: string;
}

/** The secret prompt a user-input request carries, if it is one. */
export function pendingSecretRequestOf(input: PendingUserInput): PendingSecretRequest | null {
  const question = input.questions[0];
  if (!question?.secret || input.questions.length !== 1) return null;
  return {
    requestId: input.requestId,
    createdAt: input.createdAt,
    name: question.secret.name,
    header: question.header,
    purpose: question.question,
  };
}

/** Splits secret prompts (own UI, own reply path) from regular questions. */
export function splitPendingUserInputs(inputs: ReadonlyArray<PendingUserInput>): {
  readonly userInputs: PendingUserInput[];
  readonly secretRequests: PendingSecretRequest[];
} {
  const userInputs: PendingUserInput[] = [];
  const secretRequests: PendingSecretRequest[] = [];
  for (const input of inputs) {
    const secret = pendingSecretRequestOf(input);
    if (secret) secretRequests.push(secret);
    else userInputs.push(input);
  }
  return { userInputs, secretRequests };
}
