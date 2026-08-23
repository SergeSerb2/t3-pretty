import type { ModelSelection, ProviderOptionDescriptor } from "@t3tools/contracts";

import type { ModelOption, ProviderGroup } from "../../lib/modelOptions";
import { selectableChoices } from "./thread-settings-options";

export type ThreadSettingsSheetPage = "home" | "catalog";

/** Map the inner picker route to the page we re-present after a live session update. */
export function threadSettingsSheetPageForRoute(routeName: string): ThreadSettingsSheetPage | null {
  if (routeName === "ThreadSettingsCatalog") {
    return "catalog";
  }
  if (routeName === "ThreadSettingsHome") {
    return "home";
  }
  return null;
}

/** Keep the in-sheet page only for a live re-present of the same open owner. */
export function presentedSettingsSheetPage(input: {
  readonly preservePage: boolean;
  readonly currentOwnerId: string | undefined;
  readonly nextOwnerId: string;
  readonly currentPage: ThreadSettingsSheetPage | undefined;
  readonly requestedPage: ThreadSettingsSheetPage | undefined;
}): ThreadSettingsSheetPage | undefined {
  if (input.preservePage && input.currentOwnerId === input.nextOwnerId) {
    return input.currentPage;
  }
  return input.requestedPage;
}

/** Match the terms a user can actually see or recognize in the model picker. */
export function modelMatchesCatalogQuery(input: {
  readonly model: ModelOption;
  readonly providerLabel: string;
  readonly query: string;
}): boolean {
  const query = input.query.trim().toLocaleLowerCase();
  if (query.length === 0) {
    return true;
  }

  return [
    input.model.label,
    input.model.subtitle,
    input.model.selection.model,
    input.providerLabel,
  ].some((value) => value.toLocaleLowerCase().includes(query));
}

/** Preserve staged provider options when the highlighted model is tapped again. */
export function pendingModelAfterPress(input: {
  readonly current: ModelOption | null;
  readonly pressed: ModelOption;
  readonly pressedIsApplied: boolean;
}): ModelOption | null {
  if (input.pressedIsApplied) {
    return null;
  }
  return input.current?.key === input.pressed.key ? input.current : input.pressed;
}
/**
 * Settings the displayed model actually advertises. Unsupported rows stay
 * out of the sheet instead of rendering disabled — switching models should
 * only show controls that can change something.
 */
export function visibleSheetOptionDescriptors(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ProviderOptionDescriptor> {
  return descriptors.filter((descriptor) => {
    if (descriptor.type === "boolean") {
      return true;
    }
    return selectableChoices(descriptor).length > 0;
  });
}

/**
 * Selected provider starts open; all other catalogs start closed. A user's
 * disclosure tap inverts that default until the picker is dismissed. Search
 * and a single-provider filter expand every visible section.
 */
export function providerSectionIsCollapsed(input: {
  readonly defaultExpanded: boolean;
  readonly hasExpansionOverride: boolean;
  readonly isNarrowed: boolean;
}): boolean {
  if (input.isNarrowed) {
    return false;
  }
  return input.defaultExpanded ? input.hasExpansionOverride : !input.hasExpansionOverride;
}

/** Scope a multi-provider catalog to the model already on the thread. */
export function initialProviderFilter(input: {
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly selectedModel: ModelSelection | null;
}): string | null {
  if (input.providerGroups.length <= 1) {
    return null;
  }
  for (const group of input.providerGroups) {
    if (
      group.models.some(
        (option) =>
          option.selection.instanceId === input.selectedModel?.instanceId &&
          option.selection.model === input.selectedModel.model,
      )
    ) {
      return group.providerKey;
    }
  }
  return input.providerGroups[0]?.providerKey ?? null;
}

/** Searching looks across every provider; an idle chip still scopes the list. */
export function effectiveProviderFilter(input: {
  readonly providerFilter: string | null;
  readonly searchQuery: string;
}): string | null {
  return input.searchQuery.trim().length > 0 ? null : input.providerFilter;
}
