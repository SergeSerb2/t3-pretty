import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
  isReasoningEffortDescriptor,
} from "@t3tools/shared/model";

import { selectableChoices } from "./thread-settings-options";

type SelectDescriptor = Extract<ProviderOptionDescriptor, { readonly type: "select" }>;

/** One stop on a segmented control or the effort meter. */
export type ControlChoice = {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
};

export type ReasoningLevel = ControlChoice & { readonly shortLabel: string };

/** Ordered reasoning levels for the effort meter. */
export type ReasoningControl = {
  readonly id: string;
  readonly label: string;
  readonly levels: ReadonlyArray<ReasoningLevel>;
  /** -1 when the current value was set elsewhere and is not offered here. */
  readonly selectedIndex: number;
  readonly valueLabel: string | null;
};

export type SpeedChoice = ControlChoice & { readonly value: string | boolean };

/** A service tier select or a fast-mode switch, shown as one Standard/Fast control. */
export type SpeedControl = {
  readonly id: string;
  readonly choices: ReadonlyArray<SpeedChoice>;
  readonly selectedIndex: number;
  /** A faster-than-standard tier is on. */
  readonly boosted: boolean;
};

export type ThreadSettingsControlLayout = {
  readonly reasoning: ReasoningControl | null;
  readonly speed: SpeedControl | null;
  /** Everything else (context window, thinking, agents), in catalog order. */
  readonly extras: ReadonlyArray<ProviderOptionDescriptor>;
};

const FAST_TIER_PATTERN = /fast|priority/i;
/** Wider than this, or more stops, and a select wraps as chips instead. */
const SEGMENTED_MAX_CHOICES = 4;
const SEGMENTED_MAX_LABEL_LENGTH = 12;

const SHORT_EFFORT_LABELS: Readonly<Record<string, string>> = {
  "extra high": "X-High",
  minimal: "Min",
};

/** "Extra high effort" reads as "X-High" under a narrow meter column. */
export function shortEffortLabel(label: string): string {
  const level = label.replace(/\s+effort$/i, "").trim();
  return SHORT_EFFORT_LABELS[level.toLowerCase()] ?? level;
}

function withDescription(description: string | undefined) {
  return description ? { description } : {};
}

function reasoningControl(descriptor: SelectDescriptor): ReasoningControl {
  const current = getProviderOptionCurrentValue(descriptor);
  const levels = selectableChoices(descriptor).map((choice) => ({
    id: choice.id,
    label: choice.label,
    shortLabel: shortEffortLabel(choice.label),
    ...withDescription(choice.description),
  }));
  return {
    id: descriptor.id,
    label: descriptor.label,
    levels,
    selectedIndex: levels.findIndex((level) => level.id === current),
    valueLabel: getProviderOptionCurrentLabel(descriptor) ?? null,
  };
}

function speedControl(descriptor: ProviderOptionDescriptor): SpeedControl | null {
  if (descriptor.type === "boolean") {
    if (descriptor.id !== "fastMode") return null;
    const on = descriptor.currentValue === true;
    return {
      id: descriptor.id,
      choices: [
        { id: "standard", value: false, label: "Standard" },
        { id: "fast", value: true, label: "Fast", ...withDescription(descriptor.description) },
      ],
      selectedIndex: on ? 1 : 0,
      boosted: on,
    };
  }
  if (descriptor.id !== "serviceTier") return null;
  const choices = selectableChoices(descriptor).map((choice) => ({
    id: choice.id,
    value: choice.id,
    label: choice.label,
    ...withDescription(choice.description),
  }));
  if (choices.length < 2) return null;
  const current = getProviderOptionCurrentValue(descriptor);
  const selectedIndex = choices.findIndex((choice) => choice.id === current);
  const selected = choices[selectedIndex];
  return {
    id: descriptor.id,
    choices,
    selectedIndex,
    boosted: selected !== undefined && FAST_TIER_PATTERN.test(`${selected.id} ${selected.label}`),
  };
}

/**
 * Sorts the model's option descriptors into the picker's dedicated controls:
 * the first reasoning select becomes the effort meter, the service tier or
 * fast-mode switch becomes Speed, and the rest stay generic.
 */
export function buildThreadSettingsControlLayout(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ThreadSettingsControlLayout {
  let reasoning: ReasoningControl | null = null;
  let speed: SpeedControl | null = null;
  const extras: ProviderOptionDescriptor[] = [];
  for (const descriptor of descriptors) {
    if (reasoning === null && isReasoningEffortDescriptor(descriptor)) {
      reasoning = reasoningControl(descriptor);
      continue;
    }
    if (speed === null) {
      speed = speedControl(descriptor);
      if (speed !== null) continue;
    }
    extras.push(descriptor);
  }
  return { reasoning, speed, extras };
}

/** Short, few-choice selects read best as a segmented control. */
export function fitsSegmentedControl(choices: ReadonlyArray<ControlChoice>): boolean {
  return (
    choices.length >= 2 &&
    choices.length <= SEGMENTED_MAX_CHOICES &&
    choices.every((choice) => choice.label.length <= SEGMENTED_MAX_LABEL_LENGTH)
  );
}
