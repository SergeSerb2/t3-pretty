import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isProjectTransferThreadBusy,
  type ProjectTransferStage,
} from "@t3tools/client-runtime/state/project-transfer";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProjectTransferMode,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { CONNECT_BRANDING } from "@t3tools/shared/connectBranding";
import { useCallback, useMemo, useState } from "react";
import { Alert } from "react-native";

import { presentActionListMenu } from "../../components/AppMenuHost";
import { appAtomRegistry } from "../../state/atom-registry";
import { useEnvironments } from "../../state/environments";
import { useServerConfigs, useThreadShells } from "../../state/entities";
import { projectTransfer } from "../../state/project-transfer";
import { environmentThreadShells } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

async function waitForDestinationThread(isPresent: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!isPresent()) {
    if (Date.now() >= deadline) return isPresent();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

const STAGE_LABEL: Record<ProjectTransferStage, string> = {
  inspecting: "Checking source…",
  preparing: "Preparing destination…",
  copying: "Copying files…",
};

export function useProjectTransferAction(
  threadRef: ScopedThreadRef | null,
  onTransferred: (destinationEnvironmentId: EnvironmentId, threadId: ThreadId) => void,
) {
  const { environments } = useEnvironments();
  const serverConfigs = useServerConfigs();
  const threadShells = useThreadShells();
  const transfer = useAtomCommand(projectTransfer, { reportFailure: false });
  const [isPending, setIsPending] = useState(false);
  const [stage, setStage] = useState<ProjectTransferStage | "opening" | null>(null);
  const supported =
    threadRef !== null &&
    serverConfigs.get(threadRef.environmentId)?.environment.capabilities.projectTransfer === true;
  const destinations = useMemo(
    () =>
      threadRef === null
        ? []
        : environments.filter(
            (environment) =>
              environment.relayManaged &&
              environment.connection.phase === "connected" &&
              environment.environmentId !== threadRef.environmentId &&
              serverConfigs.get(environment.environmentId)?.environment.capabilities
                .projectTransfer === true,
          ),
    [environments, serverConfigs, threadRef],
  );
  const sourceThread = useMemo(
    () =>
      threadRef === null
        ? null
        : (threadShells.find(
            (thread) =>
              thread.environmentId === threadRef.environmentId && thread.id === threadRef.threadId,
          ) ?? null),
    [threadRef, threadShells],
  );
  const siblingThreads = useMemo(() => {
    if (threadRef === null || sourceThread === null) return [];
    return threadShells.filter(
      (thread) =>
        thread.environmentId === threadRef.environmentId &&
        thread.projectId === sourceThread.projectId &&
        thread.id !== sourceThread.id,
    );
  }, [sourceThread, threadRef, threadShells]);
  const sourceBusy = sourceThread !== null && isProjectTransferThreadBusy(sourceThread);
  const siblingBusy = siblingThreads.some(isProjectTransferThreadBusy);

  const run = useCallback(
    async (destinationEnvironmentId: EnvironmentId, mode: ProjectTransferMode) => {
      if (threadRef === null || isPending) return;
      if (sourceBusy) {
        Alert.alert(
          "Thread is busy",
          "Wait for the current turn to finish before transferring this thread.",
        );
        return;
      }
      if (mode === "move" && siblingBusy) {
        Alert.alert(
          "Project is busy",
          "Wait for every thread in this project to finish before moving it.",
        );
        return;
      }
      setIsPending(true);
      setStage("inspecting");
      const result = await transfer({
        sourceEnvironmentId: threadRef.environmentId,
        destinationEnvironmentId,
        threadId: threadRef.threadId,
        mode,
        onStage: setStage,
      });
      if (result._tag === "Failure") {
        setIsPending(false);
        setStage(null);
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          Alert.alert(
            "Could not transfer thread",
            failure instanceof Error ? failure.message : "The transfer failed.",
          );
        }
        return;
      }
      setStage("opening");
      const destinationRef = scopeThreadRef(destinationEnvironmentId, result.value.threadId);
      const arrived = await waitForDestinationThread(
        () => appAtomRegistry.get(environmentThreadShells.threadShellAtom(destinationRef)) !== null,
      );
      setIsPending(false);
      setStage(null);
      if (!arrived) {
        Alert.alert(
          "Could not open destination thread",
          "The transfer finished, but the destination thread did not appear in time. Open it from the destination connection.",
        );
        return;
      }
      if (result.value.sourceRemoved === false) {
        Alert.alert(
          "Copied, but source remains",
          "The destination has the project, but it could not be removed from this machine.",
        );
      }
      onTransferred(destinationEnvironmentId, result.value.threadId);
    },
    [isPending, onTransferred, siblingBusy, sourceBusy, threadRef, transfer],
  );

  const present = useCallback(() => {
    if (threadRef === null || isPending) return;
    if (sourceBusy) {
      Alert.alert(
        "Thread is busy",
        "Wait for the current turn to finish before transferring this thread.",
      );
      return;
    }
    if (destinations.length === 0) {
      Alert.alert(
        "No destination available",
        `Connect another updated environment to this ${CONNECT_BRANDING.connectName} account and try again.`,
      );
      return;
    }
    presentActionListMenu({
      placement: "bottom-end",
      title: "Copy or move to connection",
      items: destinations.map((environment) => ({
        label: environment.label,
        description: "Copy this thread, or move the whole project",
        iconName: "arrow.right.circle",
        onPress: () => {
          Alert.alert(
            `Send to ${environment.label}?`,
            siblingThreads.length > 0
              ? "Copy duplicates this thread and keeps the source. Move relocates the whole project and removes it from this machine."
              : "Copy keeps a duplicate here. Move removes this project from this machine after it arrives.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Copy and open",
                onPress: () => void run(environment.environmentId, "copy"),
              },
              {
                text: "Move and open",
                style: "destructive",
                onPress: () => void run(environment.environmentId, "move"),
              },
            ],
          );
        },
      })),
    });
  }, [destinations, isPending, run, siblingThreads.length, sourceBusy, threadRef]);

  const pendingLabel =
    stage === "opening" ? "Opening on destination…" : stage ? STAGE_LABEL[stage] : "Transferring…";

  return { supported, isPending, pendingLabel, present };
}
