import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isProjectTransferThreadBusy,
  type ProjectTransferStage,
} from "@t3tools/client-runtime/state/project-transfer";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectTransferMode } from "@t3tools/contracts";
import { CONNECT_BRANDING } from "@t3tools/shared/connectBranding";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, CheckIcon, CloudIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useProjectTransferStore } from "../projectTransferStore";
import { useEnvironments } from "../state/environments";
import {
  readThreadShell,
  useServerConfigs,
  useThreadShell,
  useThreadShells,
} from "../state/entities";
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

async function waitForDestinationThread(isPresent: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!isPresent()) {
    if (Date.now() >= deadline) return isPresent();
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

const STAGES: ReadonlyArray<{ id: ProjectTransferStage | "opening"; label: string }> = [
  { id: "inspecting", label: "Checking source" },
  { id: "preparing", label: "Preparing destination" },
  { id: "copying", label: "Copying files" },
  { id: "opening", label: "Opening on destination" },
];

function formatElapsed(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function ProjectTransferDialog() {
  const navigate = useNavigate();
  const threadRef = useProjectTransferStore((state) => state.threadRef);
  const close = useProjectTransferStore((state) => state.close);
  const setInProgress = useProjectTransferStore((state) => state.setInProgress);
  const thread = useThreadShell(threadRef);
  const threadShells = useThreadShells();
  const { environments } = useEnvironments();
  const serverConfigs = useServerConfigs();
  const transfer = useAtomCommand(projectTransfer, { reportFailure: false });
  const [destinationId, setDestinationId] = useState<EnvironmentId | null>(null);
  const [mode, setMode] = useState<ProjectTransferMode>("copy");
  const [isPending, setIsPending] = useState(false);
  const [stage, setStage] = useState<ProjectTransferStage | "opening" | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
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
  const siblingThreads = useMemo(() => {
    if (threadRef === null || thread === null) return [];
    return threadShells.filter(
      (candidate) =>
        candidate.environmentId === threadRef.environmentId &&
        candidate.projectId === thread.projectId &&
        candidate.id !== thread.id,
    );
  }, [thread, threadRef, threadShells]);
  const sourceBusy = thread !== null && isProjectTransferThreadBusy(thread);
  const siblingBusy = siblingThreads.some(isProjectTransferThreadBusy);
  const moveBlocked = sourceBusy || siblingBusy;
  const stageIndex = stage === null ? -1 : STAGES.findIndex((entry) => entry.id === stage);
  const progressPercent = stageIndex < 0 ? 0 : ((stageIndex + 1) / STAGES.length) * 100;

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
    setStage(null);
    setElapsedSec(0);
    setMode("copy");
    setInProgress(false);
  }, [setInProgress, threadRef]);

  useEffect(() => {
    if (!isPending) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPending]);

  const runTransfer = async () => {
    if (threadRef === null || destinationId === null || isPending) return;
    if (mode === "move" && moveBlocked) return;
    setIsPending(true);
    setInProgress(true);
    setError(null);
    setStage("inspecting");
    const result = await transfer({
      sourceEnvironmentId: threadRef.environmentId,
      destinationEnvironmentId: destinationId,
      threadId: threadRef.threadId,
      mode,
      onStage: setStage,
    });
    if (result._tag === "Failure") {
      setIsPending(false);
      setInProgress(false);
      setStage(null);
      if (!isAtomCommandInterrupted(result)) {
        const failure = squashAtomCommandFailure(result);
        setError(failure instanceof Error ? failure.message : "The transfer failed.");
      }
      return;
    }

    setStage("opening");
    const destinationRef = scopeThreadRef(destinationId, result.value.threadId);
    await waitForDestinationThread(() => readThreadShell(destinationRef) !== null);

    const destinationLabel =
      destinations.find((destination) => destination.environmentId === destinationId)?.label ??
      "the selected connection";
    toastManager.add(
      stackedThreadToast({
        type: result.value.sourceRemoved === false ? "warning" : "success",
        title:
          mode === "move"
            ? `Thread moved to ${destinationLabel}`
            : `Thread copied to ${destinationLabel}`,
        description:
          mode === "move"
            ? result.value.sourceRemoved === false
              ? "The copy is on the destination, but the source project could not be removed."
              : "The project now lives on the destination."
            : "The original thread and project are still available on the source.",
      }),
    );
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(destinationRef),
    });
    close();
  };

  const copyingLabel = mode === "move" ? "Moving files" : "Copying files";

  return (
    <Dialog
      open={threadRef !== null}
      onOpenChange={(open) => {
        if (!open && !isPending) close();
      }}
    >
      <DialogPopup className="max-w-lg" showCloseButton={!isPending}>
        <DialogHeader>
          <DialogTitle>Copy or move to another connection</DialogTitle>
          <DialogDescription>
            {isPending
              ? `Working for ${formatElapsed(elapsedSec)}. Keep this dialog open until it finishes.`
              : `Send ${thread ? `“${thread.title}”` : "this thread"} through ${CONNECT_BRANDING.connectName}.`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          {isPending ? (
            <div className="space-y-3">
              <div
                aria-label="Transfer progress"
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={Math.round(progressPercent)}
                className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
                role="progressbar"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <ol className="space-y-2">
                {STAGES.map((entry, index) => {
                  const complete = index < stageIndex;
                  const current = index === stageIndex;
                  return (
                    <li
                      key={entry.id}
                      className="flex items-center gap-2 text-sm"
                      aria-current={current ? "step" : undefined}
                    >
                      {complete ? (
                        <CheckIcon className="size-3.5 text-primary" />
                      ) : current ? (
                        <Spinner className="size-3.5" />
                      ) : (
                        <span className="size-3.5 rounded-full border border-border/80" />
                      )}
                      <span className={current ? "font-medium" : "text-muted-foreground"}>
                        {entry.id === "copying" ? copyingLabel : entry.label}
                        {current && elapsedSec > 0 ? ` · ${formatElapsed(elapsedSec)}` : ""}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : destinations.length === 0 ? (
            <div className="rounded-xl border border-border/70 bg-muted/25 p-4 text-sm">
              <p className="font-medium">No compatible destination is online</p>
              <p className="mt-1 text-muted-foreground">
                Connect another updated environment to this {CONNECT_BRANDING.connectName} account
                and try again.
              </p>
            </div>
          ) : (
            <>
              <fieldset className="space-y-2">
                <legend className="mb-2 font-medium text-sm">Action</legend>
                {(
                  [
                    {
                      id: "copy" as const,
                      title: "Copy",
                      description: "Duplicate this thread and project files. The source stays.",
                    },
                    {
                      id: "move" as const,
                      title: "Move",
                      description:
                        siblingThreads.length > 0
                          ? `Relocate the whole project (${siblingThreads.length + 1} threads) and remove it from this machine.`
                          : "Relocate this project and remove it from this machine.",
                    },
                  ] as const
                ).map((option) => {
                  const selected = mode === option.id;
                  const disabled = option.id === "move" && moveBlocked;
                  return (
                    <label
                      key={option.id}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 p-3 transition-colors has-checked:border-ring has-checked:bg-accent/50 has-focus-visible:ring-2 has-focus-visible:ring-ring/50 has-disabled:cursor-not-allowed has-disabled:opacity-60"
                    >
                      <input
                        type="radio"
                        name="project-transfer-mode"
                        className="sr-only"
                        checked={selected}
                        disabled={disabled}
                        onChange={() => setMode(option.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-sm">{option.title}</span>
                        <span className="mt-0.5 block text-muted-foreground text-xs leading-relaxed">
                          {option.description}
                        </span>
                      </span>
                      {selected ? <ArrowRightIcon className="mt-0.5 size-4 text-primary" /> : null}
                    </label>
                  );
                })}
              </fieldset>
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
            </>
          )}

          {isPending ? null : (
            <div className="rounded-xl bg-muted/35 p-3 text-muted-foreground text-xs leading-relaxed">
              {sourceBusy
                ? "Wait for the current turn to finish before transferring this thread."
                : siblingBusy && mode === "move"
                  ? "Wait for every thread in this project to finish before moving it."
                  : mode === "move"
                    ? "Move copies conversation history and project files, then deletes the T3 project here. Files are removed only if they live in this machine's T3-managed projects folder. Attachments and generated caches are skipped. Archives over 96 MB are rejected."
                    : "Copy leaves the source unchanged. Conversation history, project files, and normal Git metadata are copied; attachments and generated dependency/build caches are skipped. Archives over 96 MB are rejected before import."}
            </div>
          )}
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
            disabled={
              destinationId === null || isPending || sourceBusy || (mode === "move" && siblingBusy)
            }
          >
            {isPending ? (
              <>
                <Spinner className="size-3.5" />
                {mode === "move" ? "Moving…" : "Copying…"}
              </>
            ) : mode === "move" ? (
              "Move and open"
            ) : (
              "Copy and open"
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
