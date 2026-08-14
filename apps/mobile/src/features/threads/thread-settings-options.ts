import type { ModelSelection, ProviderOptionDescriptor, RuntimeMode } from "@t3tools/contracts";

import type { ProviderGroup } from "../../lib/modelOptions";

/**
 * Desktop-oriented effort keywords that don't belong in the phone picker.
 * Prompt-injected values (ultrathink and friends) are filtered from the
 * descriptor metadata; ultracode is a real option but a workflow trigger, not
 * a reasoning level. A value set elsewhere still displays, it just isn't
 * offered.
 */
const HIDDEN_EFFORT_OPTION_IDS: ReadonlySet<string> = new Set(["ultracode"]);

export const RUNTIME_MODE_CHOICES: ReadonlyArray<{
  readonly mode: RuntimeMode;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
}> = [
  {
    mode: "approval-required",
    label: "Supervised",
    shortLabel: "Approve",
    description: "Ask before commands and file changes.",
  },
  {
    mode: "auto-accept-edits",
    label: "Auto-accept edits",
    shortLabel: "Edits",
    description: "Auto-approve edits, ask before other actions.",
  },
  {
    mode: "auto",
    label: "Auto",
    shortLabel: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
  },
  {
    mode: "full-access",
    label: "Full access",
    shortLabel: "Full",
    description: "Allow commands and edits without prompts.",
  },
];

// Kimi names its full-access modes after the CLI: "Auto" never stops to ask,
// "Yolo" runs the same full-access session but can stop to ask questions.
const KIMI_RUNTIME_MODE_CHOICES: typeof RUNTIME_MODE_CHOICES = [
  {
    mode: "approval-required",
    label: "Approve actions",
    shortLabel: "Approve",
    description: "Ask before commands and file changes.",
  },
  {
    mode: "full-access",
    label: "Auto",
    shortLabel: "Auto",
    description: "Allow commands and edits without stopping to ask.",
  },
  {
    mode: "yolo",
    label: "Yolo",
    shortLabel: "Yolo",
    description: "Allow commands and edits, but may stop to ask questions.",
  },
];

export function runtimeModeChoicesForProvider(
  providerDriver: string | null | undefined,
): typeof RUNTIME_MODE_CHOICES {
  return providerDriver === "kimi" ? KIMI_RUNTIME_MODE_CHOICES : RUNTIME_MODE_CHOICES;
}

/** Driver of the provider backing the selected model, when it is in the list. */
export function selectedModelProviderDriver(input: {
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly selectedModel: ModelSelection | null;
}): string | null {
  for (const group of input.providerGroups) {
    for (const option of group.models) {
      if (
        option.selection.instanceId === input.selectedModel?.instanceId &&
        option.selection.model === input.selectedModel.model
      ) {
        return option.providerDriver;
      }
    }
  }
  return null;
}

export function selectableChoices(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
) {
  const injected = new Set(descriptor.promptInjectedValues ?? []);
  return descriptor.options.filter(
    (option) => !injected.has(option.id) && !HIDDEN_EFFORT_OPTION_IDS.has(option.id),
  );
}
