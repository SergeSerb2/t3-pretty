import type { ProviderOptionDescriptor } from "@t3tools/contracts";

import { providerOptionValueLabels } from "../../lib/providerOptions";

export type ThreadModelIdentityTrait = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
};

export type ThreadModelIdentity = {
  readonly modelLabel: string;
  readonly providerDriver: string | null;
  readonly traits: ReadonlyArray<ThreadModelIdentityTrait>;
  readonly traitSummary: string;
  readonly summary: string;
  readonly compactLabel: string;
  readonly accessibilityLabel: string;
};

/**
 * Glanceable model + provider-option identity for an open thread.
 * Runtime / plan stay on the composer trigger; this is "which model is
 * this thread running", not "how the agent is allowed to act".
 */
export function buildThreadModelIdentity(input: {
  readonly modelLabel: string;
  readonly providerDriver: string | null;
  readonly optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
}): ThreadModelIdentity {
  const traits = input.optionDescriptors.flatMap((descriptor): ThreadModelIdentityTrait[] => {
    if (descriptor.type === "boolean") {
      return descriptor.currentValue === true
        ? [{ id: descriptor.id, name: descriptor.label, label: descriptor.label }]
        : [];
    }
    const label = providerOptionValueLabels([descriptor])[0];
    return label ? [{ id: descriptor.id, name: descriptor.label, label }] : [];
  });
  const traitSummary = traits.map((trait) => trait.label).join(" · ");
  const summary =
    traitSummary.length > 0 ? `${input.modelLabel} · ${traitSummary}` : input.modelLabel;
  const compactLabel = traits[0] ? `${input.modelLabel} · ${traits[0].label}` : input.modelLabel;
  const accessibilityLabel = [
    `Model ${input.modelLabel}`,
    ...traits.map((trait) =>
      trait.name === trait.label ? trait.name : `${trait.name} ${trait.label}`,
    ),
  ].join(", ");

  return {
    modelLabel: input.modelLabel,
    providerDriver: input.providerDriver,
    traits,
    traitSummary,
    summary,
    compactLabel,
    accessibilityLabel,
  };
}

/**
 * Native header subtitle: model identity first so truncation keeps the
 * missing information, then the project / environment location.
 */
export function threadChatHeaderSubtitle(input: {
  readonly identity: ThreadModelIdentity | null;
  readonly location: string;
}): string {
  if (input.identity === null) {
    return input.location;
  }
  if (input.location.length === 0) {
    return input.identity.compactLabel;
  }
  return `${input.identity.compactLabel} · ${input.location}`;
}
