import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { CONNECT_BRANDING } from "@t3tools/shared/connectBranding";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, CloudIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useProjectTransferStore } from "../projectTransferStore";
import { useEnvironments } from "../state/environments";
import { useServerConfigs, useThreadShell } from "../state/entities";
import { projectTransfer } from "../state/projectTransfer";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Spinner } from "./ui/spinner";
import { stackedThreadToast, toastManager } from "./ui/toast";

export function ProjectTransferDialog() {
  const navigate = useNavigate();
  const threadRef = useProjectTransferStore((state) => state.threadRef);
  const close = useProjectTransferStore((state) => state.close);
  const thread = useThreadShell(threadRef);
  const { environments } = useEnvironments();
  const serverConfigs = useServerConfigs();
  const transfer = useAtomCommand(projectTransfer, { reportFailure: false });
  const [destinationId, setDestinationId] = useState<EnvironmentId | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destinations = useMemo(
    () =>
      environments.filter(
        (environment) =>
          environment.relayManaged &&
          environment.connection.phase === "connected" &&
          environment.environmentId !== threadRef?.environmentId &&
          serverConfigs.get(environment.environmentId)?.environment.capabilities.projectTransfer ===
            true,
      ),
    [environments, serverConfigs, threadRef?.environmentId],
  );
  const sourceBusy =
    thread?.latestTurn?.state === "running" ||
    thread?.session?.status === "starting" ||
    thread?.session?.status === "running";

  useEffect(() => {
    setDestinationId((current) =>
      current && destinations.some((destination) => destination.environmentId === current)
        ? current
        : (destinations[0]?.environmentId ?? null),
    );
  }, [destinations]);

  useEffect(() => {
    setError(null);
    setIsPending(false);
  }, [threadRef]);

  const runTransfer = async () => {
    if (threadRef === null || destinationId === null || isPending) return;
    setIsPending(true);
    setError(null);
    const result = await transfer({
      sourceEnvironmentId: threadRef.environmentId,
      destinationEnvironmentId: destinationId,
      threadId: threadRef.threadId,
    });
    if (result._tag === "Failure") {
      setIsPending(false);
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : "The transfer failed.");
      }
      return;
    }

    close();
    toastManager.add(
      stackedThreadToast({
        type: "success",
        title: "Thread moved to the selected connection",
        description: "The original thread and project are still available on the source.",
      }),
    );
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(destinationId, result.value.threadId)),
    });
  };

  return (
    <Dialog
      open={threadRef !== null}
      onOpenChange={(open) => {
        if (!open && !isPending) close();
      }}
    >
      <DialogPopup className="max-w-lg" showCloseButton={!isPending}>
        <DialogHeader>
          <DialogTitle>Move thread to another connection</DialogTitle>
          <DialogDescription>
            Copy {thread ? `“${thread.title}”` : "this thread"} and its project files through{" "}
            {CONNECT_BRANDING.connectName}, then open the copy on the destination.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {destinations.length === 0 ? (
            <div className="rounded-xl border border-border/70 bg-muted/25 p-4 text-sm">
              <p className="font-medium">No compatible destination is online</p>
              <p className="mt-1 text-muted-foreground">
                Connect another updated environment to this {CONNECT_BRANDING.connectName} account
                and try again.
              </p>
            </div>
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-2 font-medium text-sm">Destination connection</legend>
              {destinations.map((environment) => {
                const selected = destinationId === environment.environmentId;
                return (
                  <label
                    key={environment.environmentId}
                    className="flex cursor-pointer items-center gap-3 rounded-xl border border-border/70 p-3 transition-colors has-checked:border-ring has-checked:bg-accent/50 has-focus-visible:ring-2 has-focus-visible:ring-ring/50"
                  >
                    <input
                      type="radio"
                      name="project-transfer-destination"
                      className="sr-only"
                      checked={selected}
                      onChange={() => setDestinationId(environment.environmentId)}
                      disabled={isPending}
                    />
                    <CloudIcon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium text-sm">
                      {environment.label}
                    </span>
                    {selected ? <ArrowRightIcon className="size-4 text-primary" /> : null}
                  </label>
                );
              })}
            </fieldset>
          )}

          <div className="rounded-xl bg-muted/35 p-3 text-muted-foreground text-xs leading-relaxed">
            {sourceBusy
              ? "Wait for the current turn to finish before moving this thread."
              : "The source stays unchanged. Conversation history, project files, and normal Git metadata are copied; attachments and generated dependency/build caches are skipped. Archives over 96 MB are rejected before import."}
          </div>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={close} disabled={isPending}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void runTransfer()}
            disabled={destinationId === null || isPending || sourceBusy}
          >
            {isPending ? (
              <>
                <Spinner className="size-3.5" /> Moving…
              </>
            ) : (
              "Move and open"
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
