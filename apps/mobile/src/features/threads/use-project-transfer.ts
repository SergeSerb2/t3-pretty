import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { CONNECT_BRANDING } from "@t3tools/shared/connectBranding";
import { useCallback, useMemo, useState } from "react";
import { Alert } from "react-native";

import { presentActionListMenu } from "../../components/AppMenuHost";
import { useEnvironments } from "../../state/environments";
import { useServerConfigs } from "../../state/entities";
import { projectTransfer } from "../../state/project-transfer";
import { useAtomCommand } from "../../state/use-atom-command";

export function useProjectTransferAction(
  threadRef: ScopedThreadRef | null,
  onTransferred: (destinationEnvironmentId: EnvironmentId, threadId: ThreadId) => void,
) {
  const { environments } = useEnvironments();
  const serverConfigs = useServerConfigs();
  const transfer = useAtomCommand(projectTransfer, { reportFailure: false });
  const [isPending, setIsPending] = useState(false);
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

  const run = useCallback(
    async (destinationEnvironmentId: EnvironmentId) => {
      if (threadRef === null || isPending) return;
      setIsPending(true);
      const result = await transfer({
        sourceEnvironmentId: threadRef.environmentId,
        destinationEnvironmentId,
        threadId: threadRef.threadId,
      });
      setIsPending(false);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const failure = squashAtomCommandFailure(result);
          Alert.alert(
            "Could not move thread",
            failure instanceof Error ? failure.message : "The transfer failed.",
          );
        }
        return;
      }
      onTransferred(destinationEnvironmentId, result.value.threadId);
    },
    [isPending, onTransferred, threadRef, transfer],
  );

  const present = useCallback(() => {
    if (threadRef === null || isPending) return;
    if (destinations.length === 0) {
      Alert.alert(
        "No destination available",
        `Connect another updated environment to this ${CONNECT_BRANDING.connectName} account and try again.`,
      );
      return;
    }
    presentActionListMenu({
      placement: "bottom-end",
      title: "Move to connection",
      items: destinations.map((environment) => ({
        label: environment.label,
        description: "Copy project and conversation",
        iconName: "arrow.right.circle",
        onPress: () => {
          Alert.alert(
            `Move to ${environment.label}?`,
            "This copies the project files and conversation, then opens the destination copy. The source stays unchanged; attachments and generated caches are skipped.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Move and open",
                onPress: () => void run(environment.environmentId),
              },
            ],
          );
        },
      })),
    });
  }, [destinations, isPending, run, threadRef]);

  return { supported, isPending, present };
}
