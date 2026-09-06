/**
 * Plain form for creating or editing an automation. The agent-driven path
 * ("New automation" in the composer) covers discovery; this dialog is the
 * exact, no-surprises editor for the fields the schema exposes.
 */
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentAutomation } from "@t3tools/client-runtime/state/automations";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  AUTOMATION_MAX_TRIGGERS,
  AUTOMATION_MIN_INTERVAL_MAX_SECONDS,
  AUTOMATION_TIMEOUT_MAX_MINUTES,
  AutomationId,
  DEFAULT_AUTOMATION_MIN_INTERVAL_SECONDS,
  DEFAULT_AUTOMATION_TIMEOUT_MINUTES,
  DEFAULT_AUTOMATION_WORKSPACE,
  ProviderDriverKind,
  type AutomationEventName,
  type AutomationTrigger,
  type AutomationWorkspace,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type RuntimeMode,
} from "@t3tools/contracts";
import {
  AUTOMATION_EVENT_LABELS,
  automationSchedulePresets,
  nextRunPreview,
  validateAutomationCron,
} from "@t3tools/shared/automationSchedule";
import { createModelSelection } from "@t3tools/shared/model";
import * as Result from "effect/Result";
import { ChevronDownIcon, PlusIcon, XIcon } from "lucide-react";
import { useId, useMemo, useRef, useState, type FormEvent } from "react";

import { useNowMinute } from "../../hooks/useNowMinute";
import { randomUUID } from "../../lib/utils";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveDefaultProviderModelSelection,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { automationEnvironment } from "../../state/automations";
import { useProject } from "../../state/entities";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import {
  resolveRuntimeModeOption,
  runtimeModeOptionsForProvider,
} from "../chat/runtimeModeOptions";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { AutomationTriggerIcon } from "./AutomationTriggerIcon";

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
const WORKSPACE_LABELS: Record<AutomationWorkspace, string> = {
  checkout: "Project checkout",
  worktree: "New worktree per run",
};
const EVENT_NAMES = Object.keys(AUTOMATION_EVENT_LABELS) as ReadonlyArray<AutomationEventName>;

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function timeZoneOptions(current: string): ReadonlyArray<string> {
  const zones =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  return zones.includes(current) ? zones : [current, ...zones];
}

interface EditorDraft {
  name: string;
  prompt: string;
  triggers: ReadonlyArray<AutomationTrigger>;
  /** null = project default model. */
  modelSelection: ModelSelection | null;
  runtimeMode: RuntimeMode;
  workspace: AutomationWorkspace;
  createPullRequest: boolean;
  /** Once the user flips the PR switch, workspace changes stop moving it. */
  createPullRequestTouched: boolean;
  timeoutMinutes: string;
  includeLastRunSummary: boolean;
  catchUpMissedRuns: boolean;
  minIntervalSeconds: string;
}

function draftFromAutomation(automation: EnvironmentAutomation | null): EditorDraft {
  if (automation === null) {
    return {
      name: "",
      prompt: "",
      triggers: [],
      modelSelection: null,
      runtimeMode: "full-access",
      workspace: DEFAULT_AUTOMATION_WORKSPACE,
      createPullRequest: false,
      createPullRequestTouched: false,
      timeoutMinutes: String(DEFAULT_AUTOMATION_TIMEOUT_MINUTES),
      includeLastRunSummary: false,
      catchUpMissedRuns: true,
      minIntervalSeconds: String(DEFAULT_AUTOMATION_MIN_INTERVAL_SECONDS),
    };
  }
  return {
    name: automation.name,
    prompt: automation.prompt,
    triggers: automation.triggers,
    modelSelection: automation.modelSelection,
    runtimeMode: automation.runtimeMode,
    workspace: automation.workspace,
    createPullRequest: automation.createPullRequest,
    createPullRequestTouched: true,
    timeoutMinutes: String(automation.timeoutMinutes),
    includeLastRunSummary: automation.includeLastRunSummary,
    catchUpMissedRuns: automation.catchUpMissedRuns,
    minIntervalSeconds: String(automation.minIntervalSeconds),
  };
}

interface EditorErrors {
  name?: string;
  prompt?: string;
  triggers: Record<number, string>;
  timeoutMinutes?: string;
  minIntervalSeconds?: string;
}

function integerInRange(text: string, min: number, max: number): number | null {
  const parsed = Number(text.trim());
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function validateDraft(draft: EditorDraft): EditorErrors {
  const errors: EditorErrors = { triggers: {} };
  if (draft.name.trim().length === 0) errors.name = "Give the automation a name.";
  if (draft.prompt.trim().length === 0) errors.prompt = "Write the prompt the agent will run.";
  draft.triggers.forEach((trigger, index) => {
    if (trigger.type !== "schedule") return;
    const checked = validateAutomationCron(trigger.cron, trigger.timezone);
    if (Result.isFailure(checked)) errors.triggers[index] = checked.failure;
  });
  if (integerInRange(draft.timeoutMinutes, 1, AUTOMATION_TIMEOUT_MAX_MINUTES) === null) {
    errors.timeoutMinutes = `Whole minutes between 1 and ${AUTOMATION_TIMEOUT_MAX_MINUTES}.`;
  }
  if (integerInRange(draft.minIntervalSeconds, 0, AUTOMATION_MIN_INTERVAL_MAX_SECONDS) === null) {
    errors.minIntervalSeconds = `Whole seconds between 0 and ${AUTOMATION_MIN_INTERVAL_MAX_SECONDS}.`;
  }
  return errors;
}

function hasErrors(errors: EditorErrors): boolean {
  return (
    errors.name !== undefined ||
    errors.prompt !== undefined ||
    errors.timeoutMinutes !== undefined ||
    errors.minIntervalSeconds !== undefined ||
    Object.keys(errors.triggers).length > 0
  );
}

const needsMinInterval = (triggers: ReadonlyArray<AutomationTrigger>) =>
  triggers.some((trigger) => trigger.type !== "schedule");

export function AutomationEditorDialog({
  open,
  environmentId,
  projectId,
  automation,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  environmentId: EnvironmentId;
  projectId: ProjectId;
  /** null creates a new automation in the project. */
  automation: EnvironmentAutomation | null;
  onOpenChange: (open: boolean) => void;
  onCreated?: (automationId: AutomationId) => void;
}) {
  const formId = useId();
  const [draft, setDraft] = useState(() => draftFromAutomation(automation));
  const [errors, setErrors] = useState<EditorErrors | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const create = useAtomCommand(automationEnvironment.create, { reportFailure: false });
  const update = useAtomCommand(automationEnvironment.update, { reportFailure: false });
  const nowMinute = useNowMinute();
  const nowIso = `${nowMinute}:00.000Z`;

  const patch = (changes: Partial<EditorDraft>) =>
    setDraft((current) => ({ ...current, ...changes }));
  // Functional updates: two trigger edits in one tick must not drop each other.
  const patchTriggers = (
    update: (triggers: ReadonlyArray<AutomationTrigger>) => ReadonlyArray<AutomationTrigger>,
  ) => setDraft((current) => ({ ...current, triggers: update(current.triggers) }));
  const setTrigger = (index: number, trigger: AutomationTrigger) =>
    patchTriggers((triggers) => triggers.map((current, i) => (i === index ? trigger : current)));
  const removeTrigger = (index: number) =>
    patchTriggers((triggers) => triggers.filter((_, i) => i !== index));
  const addTrigger = (trigger: AutomationTrigger) =>
    patchTriggers((triggers) => [...triggers, trigger]);

  // Provider instances of the environment that will run the automation.
  const environmentSettings = useEnvironmentSettings(environmentId);
  const serverProviders =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const project = useProject(scopeProjectRef(environmentId, projectId));
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(
          deriveProviderInstanceEntries(serverProviders),
          environmentSettings,
        ),
      ),
    [environmentSettings, serverProviders],
  );
  const projectDefaultSelection = resolveDefaultProviderModelSelection(
    serverProviders,
    project?.defaultModelSelection ?? null,
  );
  const pickerSelection =
    draft.modelSelection === null
      ? projectDefaultSelection
      : resolveDefaultProviderModelSelection(serverProviders, draft.modelSelection);
  const modelOptionsByInstance = useMemo(
    () =>
      getCustomModelOptionsByInstance(
        environmentSettings,
        serverProviders,
        pickerSelection?.instanceId ?? null,
        pickerSelection?.model ?? null,
      ),
    [environmentSettings, pickerSelection?.instanceId, pickerSelection?.model, serverProviders],
  );
  const driverKind =
    instanceEntries.find((entry) => entry.instanceId === pickerSelection?.instanceId)?.driverKind ??
    DEFAULT_DRIVER_KIND;
  const runtimeModes = runtimeModeOptionsForProvider(driverKind);
  const runtimeMode = runtimeModes.includes(draft.runtimeMode) ? draft.runtimeMode : "full-access";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = validateDraft(draft);
    setErrors(nextErrors);
    const minIntervalSeconds = integerInRange(
      draft.minIntervalSeconds,
      0,
      AUTOMATION_MIN_INTERVAL_MAX_SECONDS,
    );
    const timeoutMinutes = integerInRange(draft.timeoutMinutes, 1, AUTOMATION_TIMEOUT_MAX_MINUTES);
    if (
      hasErrors(nextErrors) ||
      isSaving ||
      minIntervalSeconds === null ||
      timeoutMinutes === null
    ) {
      return;
    }
    const fields = {
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      triggers: draft.triggers.map((trigger) =>
        trigger.type === "git"
          ? { ...trigger, branch: trigger.branch?.trim() ? trigger.branch.trim() : null }
          : trigger,
      ),
      modelSelection: draft.modelSelection,
      runtimeMode,
      workspace: draft.workspace,
      createPullRequest: draft.createPullRequest,
      includeLastRunSummary: draft.includeLastRunSummary,
      catchUpMissedRuns: draft.catchUpMissedRuns,
      minIntervalSeconds,
      timeoutMinutes,
    };
    setIsSaving(true);
    try {
      let result: AtomCommandResult<unknown, unknown>;
      let createdId: AutomationId | null = null;
      if (automation === null) {
        createdId = AutomationId.make(randomUUID());
        result = await create({
          environmentId,
          input: { automationId: createdId, projectId, enabled: true, ...fields },
        });
      } else {
        result = await update({
          environmentId,
          input: { automationId: automation.id, patch: fields },
        });
      }
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title:
              automation === null ? "Could not create automation" : "Could not save automation",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
        return;
      }
      onOpenChange(false);
      if (createdId !== null) onCreated?.(createdId);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{automation === null ? "New automation" : "Edit automation"}</DialogTitle>
          <DialogDescription>
            An automation runs its prompt unattended in this project whenever one of its triggers
            fires.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form id={formId} className="space-y-5" onSubmit={(event) => void submit(event)}>
            <Field label="Name" htmlFor={`${formId}-name`} error={errors?.name}>
              <Input
                id={`${formId}-name`}
                value={draft.name}
                autoFocus
                placeholder="Nightly dependency review"
                onChange={(event) => patch({ name: event.target.value })}
              />
            </Field>
            <Field label="Prompt" htmlFor={`${formId}-prompt`} error={errors?.prompt}>
              <Textarea
                id={`${formId}-prompt`}
                value={draft.prompt}
                rows={6}
                placeholder="What should the agent do each run? Nobody is watching, so say what to assume and what to report."
                onChange={(event) => patch({ prompt: event.target.value })}
              />
            </Field>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label>Triggers</Label>
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        size="xs"
                        variant="outline"
                        type="button"
                        disabled={draft.triggers.length >= AUTOMATION_MAX_TRIGGERS}
                      />
                    }
                  >
                    <PlusIcon className="size-3.5" />
                    Add trigger
                    <ChevronDownIcon className="size-3.5" />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    <MenuItem
                      onClick={() =>
                        addTrigger({
                          type: "schedule",
                          cron: "0 9 * * *",
                          timezone: browserTimeZone(),
                        })
                      }
                    >
                      <AutomationTriggerIcon type="schedule" className="size-4" />
                      Schedule
                    </MenuItem>
                    <MenuItem
                      onClick={() => addTrigger({ type: "event", event: "turn.completed" })}
                    >
                      <AutomationTriggerIcon type="event" className="size-4" />
                      In-app event
                    </MenuItem>
                    <MenuItem onClick={() => addTrigger({ type: "webhook" })}>
                      <AutomationTriggerIcon type="webhook" className="size-4" />
                      Webhook
                    </MenuItem>
                    <MenuItem onClick={() => addTrigger({ type: "git", branch: null })}>
                      <AutomationTriggerIcon type="git" className="size-4" />
                      Git push
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              </div>
              {draft.triggers.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No triggers yet. You can still start runs with Run now.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {draft.triggers.map((trigger, index) => (
                    <li
                      key={index}
                      className="rounded-lg border border-border/60 bg-card/40 p-3 dark:border-transparent dark:bg-white/[0.035]"
                    >
                      <TriggerEditor
                        trigger={trigger}
                        nowIso={nowIso}
                        error={errors?.triggers[index]}
                        onChange={(next) => setTrigger(index, next)}
                        onRemove={() => removeTrigger(index)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>Model</Label>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    Project default
                    <Switch
                      size="sm"
                      checked={draft.modelSelection === null}
                      onCheckedChange={(checked) =>
                        patch({ modelSelection: checked ? null : projectDefaultSelection })
                      }
                    />
                  </label>
                </div>
                {pickerSelection ? (
                  <ProviderModelPicker
                    activeInstanceId={pickerSelection.instanceId}
                    model={pickerSelection.model}
                    lockedProvider={null}
                    instanceEntries={instanceEntries}
                    modelOptionsByInstance={modelOptionsByInstance}
                    disabled={draft.modelSelection === null}
                    triggerVariant="outline"
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    onInstanceModelChange={(instanceId, model) =>
                      patch({ modelSelection: createModelSelection(instanceId, model) })
                    }
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No providers available.</p>
                )}
              </div>
              <Field label="Permission mode">
                <Select
                  value={runtimeMode}
                  onValueChange={(value) => patch({ runtimeMode: value as RuntimeMode })}
                >
                  <SelectTrigger size="sm" className="w-full" aria-label="Permission mode">
                    <SelectValue>
                      {resolveRuntimeModeOption(driverKind, runtimeMode).label}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    {runtimeModes.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {resolveRuntimeModeOption(driverKind, mode).label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>
              <Field label="Workspace">
                <Select
                  value={draft.workspace}
                  onValueChange={(value) => {
                    const workspace = value as AutomationWorkspace;
                    patch({
                      workspace,
                      ...(draft.createPullRequestTouched
                        ? {}
                        : { createPullRequest: workspace === "worktree" }),
                    });
                  }}
                >
                  <SelectTrigger size="sm" className="w-full" aria-label="Workspace">
                    <SelectValue>{WORKSPACE_LABELS[draft.workspace]}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false}>
                    <SelectItem value="checkout">{WORKSPACE_LABELS.checkout}</SelectItem>
                    <SelectItem value="worktree">{WORKSPACE_LABELS.worktree}</SelectItem>
                  </SelectPopup>
                </Select>
              </Field>
              <SwitchField
                label="Create a pull request"
                description="Ask the agent to open a PR when the run finishes."
                checked={draft.createPullRequest}
                onCheckedChange={(checked) =>
                  patch({ createPullRequest: checked, createPullRequestTouched: true })
                }
              />
              <Field
                label="Timeout (minutes)"
                htmlFor={`${formId}-timeout`}
                error={errors?.timeoutMinutes}
              >
                <Input
                  id={`${formId}-timeout`}
                  size="sm"
                  type="number"
                  min={1}
                  max={AUTOMATION_TIMEOUT_MAX_MINUTES}
                  value={draft.timeoutMinutes}
                  onChange={(event) => patch({ timeoutMinutes: event.target.value })}
                />
              </Field>
            </div>

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
                <ChevronDownIcon
                  className={`size-3.5 transition-transform ${advancedOpen ? "" : "-rotate-90"}`}
                />
                Advanced
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <div className="grid gap-4 pt-3 sm:grid-cols-2">
                  <SwitchField
                    label="Include last run summary"
                    description="Append the previous run's closing message to the prompt."
                    checked={draft.includeLastRunSummary}
                    onCheckedChange={(checked) => patch({ includeLastRunSummary: checked })}
                  />
                  <SwitchField
                    label="Catch up missed runs"
                    description="Run once for a schedule window missed while the server was down."
                    checked={draft.catchUpMissedRuns}
                    onCheckedChange={(checked) => patch({ catchUpMissedRuns: checked })}
                  />
                  {needsMinInterval(draft.triggers) ? (
                    <Field
                      label="Minimum interval (seconds)"
                      htmlFor={`${formId}-min-interval`}
                      error={errors?.minIntervalSeconds}
                      description="Event, webhook, and git triggers that fire sooner than this are ignored."
                    >
                      <Input
                        id={`${formId}-min-interval`}
                        size="sm"
                        type="number"
                        min={0}
                        max={AUTOMATION_MIN_INTERVAL_MAX_SECONDS}
                        value={draft.minIntervalSeconds}
                        onChange={(event) => patch({ minIntervalSeconds: event.target.value })}
                      />
                    </Field>
                  ) : null}
                </div>
              </CollapsiblePanel>
            </Collapsible>
          </form>
        </DialogPanel>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={isSaving}>
            {automation === null ? "Create automation" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  error,
  description,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string | undefined;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : description ? (
        <p className="text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}

function SwitchField({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-lg border border-border/60 px-3 py-2 dark:border-transparent dark:bg-white/[0.035]">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch size="sm" className="mt-0.5" checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  );
}

function TriggerEditor({
  trigger,
  nowIso,
  error,
  onChange,
  onRemove,
}: {
  trigger: AutomationTrigger;
  nowIso: string;
  error: string | undefined;
  onChange: (trigger: AutomationTrigger) => void;
  onRemove: () => void;
}) {
  const heading = (title: string) => (
    <div className="mb-2 flex items-center gap-2">
      <AutomationTriggerIcon type={trigger.type} className="size-4 text-muted-foreground" />
      <span className="flex-1 text-sm font-medium">{title}</span>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost-muted"
        aria-label="Remove trigger"
        onClick={onRemove}
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
  switch (trigger.type) {
    case "schedule":
      return (
        <>
          {heading("Schedule")}
          <ScheduleTriggerFields
            trigger={trigger}
            nowIso={nowIso}
            error={error}
            onChange={onChange}
          />
        </>
      );
    case "event":
      return (
        <>
          {heading("In-app event")}
          <Select
            value={trigger.event}
            onValueChange={(value) =>
              onChange({ type: "event", event: value as AutomationEventName })
            }
          >
            <SelectTrigger size="sm" className="w-full sm:w-72" aria-label="Event">
              <SelectValue>{AUTOMATION_EVENT_LABELS[trigger.event]}</SelectValue>
            </SelectTrigger>
            <SelectPopup alignItemWithTrigger={false}>
              {EVENT_NAMES.map((event) => (
                <SelectItem key={event} value={event}>
                  {AUTOMATION_EVENT_LABELS[event]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </>
      );
    case "webhook":
      return (
        <>
          {heading("Webhook")}
          <p className="text-xs text-muted-foreground">
            The URL to call appears on the automation page after saving.
          </p>
        </>
      );
    case "git":
      return (
        <>
          {heading("Git push")}
          <Input
            size="sm"
            className="w-full sm:w-72"
            placeholder="Default branch"
            aria-label="Branch"
            value={trigger.branch ?? ""}
            onChange={(event) =>
              onChange({
                type: "git",
                branch: event.target.value.length > 0 ? event.target.value : null,
              })
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Fetches the remote in the project checkout and runs when the branch moves.
          </p>
        </>
      );
  }
}

function ScheduleTriggerFields({
  trigger,
  nowIso,
  error,
  onChange,
}: {
  trigger: Extract<AutomationTrigger, { type: "schedule" }>;
  nowIso: string;
  error: string | undefined;
  onChange: (trigger: AutomationTrigger) => void;
}) {
  const matchedPresetId = automationSchedulePresets.find(
    (preset) => preset.cron === trigger.cron,
  )?.id;
  // Choosing Custom changes no field, so it is remembered locally as the cron
  // it was chosen for; any edit (or a shifted index key) drops it. The cron
  // input takes focus as the cue.
  const [customFor, setCustomFor] = useState<string | null>(null);
  const presetId =
    matchedPresetId === undefined || customFor === trigger.cron ? "custom" : matchedPresetId;
  const cronInputRef = useRef<HTMLInputElement>(null);
  const zones = useMemo(() => timeZoneOptions(trigger.timezone), [trigger.timezone]);
  const liveCheck = validateAutomationCron(trigger.cron, trigger.timezone);
  const liveError = error ?? (Result.isFailure(liveCheck) ? liveCheck.failure : undefined);
  const preview = liveError === undefined ? nextRunPreview([trigger], nowIso, 3) : [];
  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone: trigger.timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
    [trigger.timezone],
  );
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Select
        value={presetId}
        onValueChange={(value) => {
          const preset = automationSchedulePresets.find((candidate) => candidate.id === value);
          if (preset?.cron) {
            setCustomFor(null);
            onChange({ ...trigger, cron: preset.cron });
            return;
          }
          setCustomFor(trigger.cron);
          cronInputRef.current?.focus();
        }}
      >
        <SelectTrigger size="sm" aria-label="Schedule preset">
          <SelectValue>
            {automationSchedulePresets.find((preset) => preset.id === presetId)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {automationSchedulePresets.map((preset) => (
            <SelectItem key={preset.id} value={preset.id}>
              {preset.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <Select
        value={trigger.timezone}
        onValueChange={(value) => onChange({ ...trigger, timezone: String(value) })}
      >
        <SelectTrigger size="sm" aria-label="Time zone">
          <SelectValue>{trigger.timezone}</SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false} className="max-h-72">
          {zones.map((zone) => (
            <SelectItem key={zone} value={zone} hideIndicator>
              {zone}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <div className="sm:col-span-2">
        <Input
          size="sm"
          className="font-mono"
          ref={cronInputRef}
          aria-label="Cron expression"
          placeholder="minute hour day month weekday"
          value={trigger.cron}
          onChange={(event) => onChange({ ...trigger, cron: event.target.value })}
        />
        {liveError !== undefined ? (
          <p className="mt-1 text-xs text-destructive">{liveError}</p>
        ) : preview.length > 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Next: {preview.map((instant) => formatter.format(Date.parse(instant))).join(" · ")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
