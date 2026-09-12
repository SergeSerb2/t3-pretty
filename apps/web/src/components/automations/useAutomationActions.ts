/**
 * The automation verbs every web entry point shares: sidebar shelf, page,
 * project settings, and the command palette. Commands report failures as
 * toasts; success needs no toast because the shell stream updates the row.
 */
import type { ScopedAutomationRef } from "@t3tools/client-runtime/state/automations";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { automationEnvironment } from "../../state/automations";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { automationSetupPrompt } from "./automations.logic";

function reportFailure(title: string, result: AtomCommandResult<unknown, unknown>): boolean {
  if (result._tag !== "Failure") return true;
  if (isAtomCommandInterrupted(result)) return false;
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
  return false;
}

export function useAutomationActions() {
  const runNowCommand = useAtomCommand(automationEnvironment.runNow, { reportFailure: false });
  const updateCommand = useAtomCommand(automationEnvironment.update, { reportFailure: false });
  const deleteCommand = useAtomCommand(automationEnvironment.delete, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const router = useRouter();

  const runNow = useCallback(
    async (ref: ScopedAutomationRef) =>
      reportFailure(
        "Could not start the run",
        await runNowCommand({
          environmentId: ref.environmentId,
          input: { automationId: ref.automationId },
        }),
      ),
    [runNowCommand],
  );

  const setEnabled = useCallback(
    async (ref: ScopedAutomationRef, enabled: boolean) =>
      reportFailure(
        enabled ? "Could not resume the automation" : "Could not pause the automation",
        await updateCommand({
          environmentId: ref.environmentId,
          input: { automationId: ref.automationId, patch: { enabled } },
        }),
      ),
    [updateCommand],
  );

  const rotateWebhookToken = useCallback(
    async (ref: ScopedAutomationRef) =>
      reportFailure(
        "Could not rotate the webhook token",
        await updateCommand({
          environmentId: ref.environmentId,
          input: { automationId: ref.automationId, patch: {}, rotateWebhookToken: true },
        }),
      ),
    [updateCommand],
  );

  const remove = useCallback(
    async (ref: ScopedAutomationRef) =>
      reportFailure(
        "Could not delete the automation",
        await deleteCommand({
          environmentId: ref.environmentId,
          input: { automationId: ref.automationId },
        }),
      ),
    [deleteCommand],
  );

  const openPage = useCallback(
    (ref: ScopedAutomationRef) =>
      router.navigate({
        to: "/automations/$environmentId/$automationId",
        params: { environmentId: ref.environmentId, automationId: ref.automationId },
      }),
    [router],
  );

  /**
   * "New automation" / "Edit with agent": a fresh draft in the project with a
   * visible prompt pointing the agent at the MCP toolkit.
   */
  const startAgentSetup = useCallback(
    async (
      projectRef: ScopedProjectRef,
      automation: { readonly name: string; readonly id: string } | null = null,
    ) => {
      const opened = await handleNewThread(projectRef);
      if (opened !== null) {
        setPrompt(opened.draftId, automationSetupPrompt(automation));
      }
    },
    [handleNewThread, setPrompt],
  );

  return useMemo(
    () => ({ runNow, setEnabled, rotateWebhookToken, remove, openPage, startAgentSetup }),
    [runNow, setEnabled, rotateWebhookToken, remove, openPage, startAgentSetup],
  );
}
