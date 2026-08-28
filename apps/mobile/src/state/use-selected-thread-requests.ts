import { useAtomValue } from "@effect/atom-react";
import { useCallback, useMemo, useState } from "react";

import {
  ApprovalRequestId,
  type ProviderApprovalDecision,
  type UserInputQuestion,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { threadEnvironment } from "../state/threads";
import { scopedRequestKey } from "../lib/scopedEntities";
import {
  buildPendingUserInputAnswers,
  derivePendingApprovals,
  derivePendingUserInputs,
  setPendingUserInputCustomAnswer,
  sortThreadActivities,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../lib/threadActivity";
import { appAtomRegistry } from "./atom-registry";
import { useSelectedThreadDetail } from "./use-thread-detail";
import { useThreadSelection } from "./use-thread-selection";
import { useAtomCommand } from "./use-atom-command";

type UserInputDraftsByRequestKey = Record<string, Record<string, PendingUserInputDraftAnswer>>;

const MAX_USER_INPUT_DRAFT_REQUESTS = 32;
const userInputDraftsByRequestKeyAtom = Atom.make<UserInputDraftsByRequestKey>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:user-input-drafts"),
);

function updateUserInputDraft(
  requestKey: string,
  update: (
    current: Record<string, PendingUserInputDraftAnswer>,
  ) => Record<string, PendingUserInputDraftAnswer>,
): void {
  const current = appAtomRegistry.get(userInputDraftsByRequestKeyAtom);
  const next: UserInputDraftsByRequestKey = { ...current };
  delete next[requestKey];
  next[requestKey] = update(current[requestKey] ?? {});
  while (Object.keys(next).length > MAX_USER_INPUT_DRAFT_REQUESTS) {
    const oldestRequestKey = Object.keys(next)[0];
    if (oldestRequestKey === undefined) {
      break;
    }
    delete next[oldestRequestKey];
  }
  appAtomRegistry.set(userInputDraftsByRequestKeyAtom, next);
}

function clearUserInputDraft(requestKey: string): void {
  const current = appAtomRegistry.get(userInputDraftsByRequestKeyAtom);
  if (current[requestKey] === undefined) {
    return;
  }
  const next = { ...current };
  delete next[requestKey];
  appAtomRegistry.set(userInputDraftsByRequestKeyAtom, next);
}

function setUserInputDraftOption(
  requestKey: string,
  question: UserInputQuestion,
  label: string,
): void {
  updateUserInputDraft(requestKey, (current) => ({
    ...current,
    [question.id]: togglePendingUserInputOptionSelection(question, current[question.id], label),
  }));
}

function setUserInputDraftCustomAnswer(
  requestKey: string,
  questionId: string,
  customAnswer: string,
): void {
  updateUserInputDraft(requestKey, (current) => ({
    ...current,
    [questionId]: setPendingUserInputCustomAnswer(current[questionId], customAnswer),
  }));
}

export function useSelectedThreadRequests() {
  const respondToApproval = useAtomCommand(
    threadEnvironment.respondToApproval,
    "thread approval response",
  );
  const respondToUserInput = useAtomCommand(
    threadEnvironment.respondToUserInput,
    "thread user input response",
  );
  const { selectedThread: selectedThreadShell } = useThreadSelection();
  const selectedThread = useSelectedThreadDetail();
  const userInputDraftsByRequestKey = useAtomValue(userInputDraftsByRequestKeyAtom);
  const [respondingApprovalId, setRespondingApprovalId] = useState<ApprovalRequestId | null>(null);
  const [respondingUserInputId, setRespondingUserInputId] = useState<ApprovalRequestId | null>(
    null,
  );

  // Sort once; both derivations expect the same lifecycle ordering. Key on the
  // activities array itself: stream windows re-mint the thread object even
  // when the reducer left its activities untouched.
  const selectedThreadActivities = selectedThread?.activities;
  const sortedActivities = useMemo(
    () => (selectedThreadActivities ? sortThreadActivities(selectedThreadActivities) : []),
    [selectedThreadActivities],
  );
  const activePendingApprovals = useMemo(
    () => derivePendingApprovals(sortedActivities),
    [sortedActivities],
  );
  const activePendingApproval = activePendingApprovals[0] ?? null;
  const activePendingUserInputs = useMemo(
    () => derivePendingUserInputs(sortedActivities),
    [sortedActivities],
  );
  const activePendingUserInput = activePendingUserInputs[0] ?? null;
  const activePendingUserInputDrafts =
    activePendingUserInput && selectedThreadShell
      ? (userInputDraftsByRequestKey[
          scopedRequestKey(selectedThreadShell.environmentId, activePendingUserInput.requestId)
        ] ?? {})
      : {};
  const activePendingUserInputAnswers = activePendingUserInput
    ? buildPendingUserInputAnswers(activePendingUserInput.questions, activePendingUserInputDrafts)
    : null;

  const onSelectUserInputOption = useCallback(
    (requestId: ApprovalRequestId, question: UserInputQuestion, label: string) => {
      if (!selectedThreadShell) {
        return;
      }

      const requestKey = scopedRequestKey(selectedThreadShell.environmentId, requestId);
      setUserInputDraftOption(requestKey, question, label);
    },
    [selectedThreadShell],
  );

  const onChangeUserInputCustomAnswer = useCallback(
    (requestId: ApprovalRequestId, questionId: string, customAnswer: string) => {
      if (!selectedThreadShell) {
        return;
      }

      const requestKey = scopedRequestKey(selectedThreadShell.environmentId, requestId);
      setUserInputDraftCustomAnswer(requestKey, questionId, customAnswer);
    },
    [selectedThreadShell],
  );

  const onRespondToApproval = useCallback(
    async (requestId: ApprovalRequestId, decision: ProviderApprovalDecision) => {
      if (!selectedThreadShell) {
        return;
      }

      setRespondingApprovalId(requestId);
      const result = await respondToApproval({
        environmentId: selectedThreadShell.environmentId,
        input: {
          threadId: selectedThreadShell.id,
          requestId,
          decision,
        },
      });
      setRespondingApprovalId((current) => (current === requestId ? null : current));
      return result;
    },
    [respondToApproval, selectedThreadShell],
  );

  const onSubmitUserInput = useCallback(async () => {
    if (!selectedThreadShell || !activePendingUserInput || !activePendingUserInputAnswers) {
      return;
    }

    const requestKey = scopedRequestKey(
      selectedThreadShell.environmentId,
      activePendingUserInput.requestId,
    );
    setRespondingUserInputId(activePendingUserInput.requestId);
    const result = await respondToUserInput({
      environmentId: selectedThreadShell.environmentId,
      input: {
        threadId: selectedThreadShell.id,
        requestId: activePendingUserInput.requestId,
        answers: activePendingUserInputAnswers,
      },
    });
    if (AsyncResult.isSuccess(result)) {
      clearUserInputDraft(requestKey);
    }
    setRespondingUserInputId((current) =>
      current === activePendingUserInput.requestId ? null : current,
    );
    return result;
  }, [
    activePendingUserInput,
    activePendingUserInputAnswers,
    respondToUserInput,
    selectedThreadShell,
  ]);

  return {
    activePendingApproval,
    activePendingUserInput,
    activePendingUserInputDrafts,
    activePendingUserInputAnswers,
    respondingApprovalId,
    respondingUserInputId,
    onRespondToApproval,
    onSelectUserInputOption,
    onChangeUserInputCustomAnswer,
    onSubmitUserInput,
  };
}
