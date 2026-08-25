import { useAtomValue } from "@effect/atom-react";
import type { ModelSelection, ScopedThreadRef } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { HammerIcon, Repeat2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getComposerProviderState } from "~/components/chat/composerProviderState";
import { ProviderModelPicker } from "~/components/chat/ProviderModelPicker";
import { TraitsPicker } from "~/components/chat/TraitsPicker";
import { type DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { usePrimarySettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance, resolveAppModelSelectionState } from "~/modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "~/providerInstances";
import { primaryServerProvidersAtom } from "~/state/server";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

function readDialogModelSelection(
  composerTarget: ScopedThreadRef | DraftId | null,
  fallback: ModelSelection,
): ModelSelection {
  const store = useComposerDraftStore.getState();
  if (composerTarget !== null) {
    const draft = store.getComposerDraft(composerTarget);
    const instanceId = draft?.activeProvider;
    const fromComposer = instanceId ? draft.modelSelectionByProvider[instanceId] : undefined;
    if (fromComposer) return fromComposer;
  }
  const stickyId = store.stickyActiveProvider;
  const fromSticky = stickyId ? store.stickyModelSelectionByProvider[stickyId] : undefined;
  return fromSticky ?? fallback;
}

export function FixAllFindingsDialog({
  open,
  onOpenChange,
  findingCount,
  composerTarget,
  pending,
  continuous,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  findingCount: number;
  composerTarget: ScopedThreadRef | DraftId | null;
  pending: boolean;
  continuous: boolean;
  onConfirm: (selection: ModelSelection) => void;
}) {
  const settings = usePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const fallbackSelection = useMemo(
    () => resolveAppModelSelectionState(settings, serverProviders),
    [serverProviders, settings],
  );
  const [selection, setSelection] = useState<ModelSelection>(fallbackSelection);

  useEffect(() => {
    if (!open) return;
    setSelection(readDialogModelSelection(composerTarget, fallbackSelection));
  }, [composerTarget, fallbackSelection, open]);

  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(deriveProviderInstanceEntries(serverProviders), settings),
      ),
    [serverProviders, settings],
  );
  const modelOptionsByInstance = useMemo(
    () =>
      getCustomModelOptionsByInstance(
        settings,
        serverProviders,
        selection.instanceId,
        selection.model,
      ),
    [selection.instanceId, selection.model, serverProviders, settings],
  );
  const activeEntry =
    instanceEntries.find((entry) => entry.instanceId === selection.instanceId) ??
    instanceEntries[0] ??
    null;

  const findingLabel = `${findingCount} ${findingCount === 1 ? "finding" : "findings"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {continuous ? <Repeat2Icon className="size-4" /> : <HammerIcon className="size-4" />}
            {continuous ? "Fix continuously" : "Fix all findings"}
          </DialogTitle>
          <DialogDescription>
            {continuous
              ? `Pick the agent to fix ${findingLabel}, then monitor this pull request and keep fixing new review comments and failures until it is green.`
              : `Pick the agent for this sweep of ${findingLabel}. It will fix the unresolved review comments and resolve the ones it addresses.`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          {activeEntry === null ? (
            <p className="text-sm text-muted-foreground">
              Enable a provider in Settings before running this.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              <ProviderModelPicker
                activeInstanceId={selection.instanceId}
                model={selection.model}
                lockedProvider={null}
                instanceEntries={instanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                triggerAriaLabel="Agent"
                onInstanceModelChange={(instanceId, model) => {
                  const entry =
                    instanceEntries.find((candidate) => candidate.instanceId === instanceId) ??
                    activeEntry;
                  const { modelOptionsForDispatch } = getComposerProviderState({
                    provider: entry.driverKind,
                    model,
                    models: entry.models,
                    modelOptions: undefined,
                    planModeEnabled: settings.planModeEnabled,
                  });
                  setSelection(createModelSelection(instanceId, model, modelOptionsForDispatch));
                }}
              />
              <TraitsPicker
                provider={activeEntry.driverKind}
                models={activeEntry.models}
                model={selection.model}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={selection.options}
                allowPromptInjectedEffort={false}
                planModeEnabled={settings.planModeEnabled}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onModelOptionsChange={(nextOptions) => {
                  setSelection(
                    createModelSelection(selection.instanceId, selection.model, nextOptions),
                  );
                }}
              />
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={pending || activeEntry === null || selection.model.length === 0}
            onClick={() => onConfirm(selection)}
          >
            {pending ? "Starting..." : continuous ? "Fix continuously" : "Fix all"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
