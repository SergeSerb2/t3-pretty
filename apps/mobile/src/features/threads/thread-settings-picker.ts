import type { ModelSelection, ProviderOptionDescriptor, RuntimeMode } from "@t3tools/contracts";
import { getProviderOptionCurrentValue } from "@t3tools/shared/model";

import type { ModelOption, ProviderGroup } from "../../lib/modelOptions";
import {
  runtimeModeChoicesForProvider,
  selectableChoices,
  selectedModelProviderDriver,
} from "./thread-settings-options";

/** A phone popover can show this many models as chips; more belong in the sheet. */
export const INLINE_MODEL_LIMIT = 8;

export type ThreadSettingsPickerChoice = {
  readonly id: string;
  readonly label: string;
  readonly selected: boolean;
};

export type ThreadSettingsPickerSelectSection = {
  readonly id: string;
  readonly label: string;
  readonly choices: ReadonlyArray<ThreadSettingsPickerChoice>;
};

export type ThreadSettingsPickerBooleanSection = {
  readonly id: string;
  readonly label: string;
  readonly value: boolean;
};

export type ThreadSettingsPickerRuntimeChoice = {
  readonly mode: RuntimeMode;
  readonly label: string;
  readonly shortLabel: string;
  readonly selected: boolean;
};

export type ThreadSettingsPickerInlineModel = {
  readonly option: ModelOption;
  readonly selected: boolean;
};

export type ThreadSettingsPickerModel = {
  readonly modelLabel: string;
  readonly providerLabel: string | null;
  readonly providerDriver: string | null;
  readonly inlineModels: ReadonlyArray<ThreadSettingsPickerInlineModel> | null;
  readonly selectSections: ReadonlyArray<ThreadSettingsPickerSelectSection>;
  readonly booleanSections: ReadonlyArray<ThreadSettingsPickerBooleanSection>;
  readonly runtimeChoices: ReadonlyArray<ThreadSettingsPickerRuntimeChoice>;
};

function isSelectedModel(option: ModelOption, selectedModel: ModelSelection | null): boolean {
  return (
    option.selection.instanceId === selectedModel?.instanceId &&
    option.selection.model === selectedModel.model
  );
}

/** Non-legacy models, plus a selected legacy so the current pick stays visible. */
export function visiblePickerModels(input: {
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly selectedModel: ModelSelection | null;
}): ReadonlyArray<ModelOption> {
  return input.providerGroups.flatMap((group) =>
    group.models.filter(
      (option) => !option.isLegacy || isSelectedModel(option, input.selectedModel),
    ),
  );
}

/**
 * Small single-provider catalogs stay in the popover. Cursor-sized lists and
 * cross-provider handoff open the searchable sheet instead.
 */
export function shouldInlinePickerModels(input: {
  readonly providerGroupCount: number;
  readonly modelCount: number;
}): boolean {
  return (
    input.providerGroupCount === 1 && input.modelCount > 0 && input.modelCount <= INLINE_MODEL_LIMIT
  );
}

export function selectedPickerModel(input: {
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly selectedModel: ModelSelection | null;
}): ModelOption | null {
  for (const group of input.providerGroups) {
    for (const option of group.models) {
      if (isSelectedModel(option, input.selectedModel)) {
        return option;
      }
    }
  }
  return null;
}

/** Everyday composer panel: current model, then effort/tier/runtime — never the full catalog. */
export function buildThreadSettingsPickerModel(input: {
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly selectedModel: ModelSelection | null;
  readonly optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly runtimeMode: RuntimeMode;
}): ThreadSettingsPickerModel {
  const selected = selectedPickerModel(input);
  const models = visiblePickerModels(input);
  const inline = shouldInlinePickerModels({
    providerGroupCount: input.providerGroups.length,
    modelCount: models.length,
  })
    ? models.map((option) => ({
        option,
        selected: isSelectedModel(option, input.selectedModel),
      }))
    : null;

  const selectSections: ThreadSettingsPickerSelectSection[] = [];
  const booleanSections: ThreadSettingsPickerBooleanSection[] = [];
  for (const descriptor of input.optionDescriptors) {
    if (descriptor.type === "boolean") {
      booleanSections.push({
        id: descriptor.id,
        label: descriptor.label,
        value: descriptor.currentValue ?? false,
      });
      continue;
    }
    const choices = selectableChoices(descriptor);
    if (choices.length === 0) {
      continue;
    }
    const currentValue = getProviderOptionCurrentValue(descriptor);
    selectSections.push({
      id: descriptor.id,
      label: descriptor.label,
      choices: choices.map((choice) => ({
        id: choice.id,
        label: choice.label,
        selected: choice.id === currentValue,
      })),
    });
  }

  const runtimeChoices = runtimeModeChoicesForProvider(
    selected?.providerDriver ??
      selectedModelProviderDriver({
        providerGroups: input.providerGroups,
        selectedModel: input.selectedModel,
      }),
  ).map((choice) => ({
    mode: choice.mode,
    label: choice.label,
    shortLabel: choice.shortLabel,
    selected: choice.mode === input.runtimeMode,
  }));

  return {
    modelLabel: selected?.label ?? input.selectedModel?.model ?? "Choose model",
    providerLabel: selected?.providerLabel ?? null,
    providerDriver: selected?.providerDriver ?? null,
    inlineModels: inline,
    selectSections,
    booleanSections,
    runtimeChoices,
  };
}
