import { Platform } from "react-native";
import type { HeaderBarButtonMailSearchToolbarItem } from "react-native-screens";

import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import { isNativeMailSearchToolbarSupported } from "./native-mail-search-toolbar.logic";

export {
  iosMajorVersion,
  isNativeMailSearchToolbarSupported,
} from "./native-mail-search-toolbar.logic";

/**
 * Group search, filtering, and composition on platforms with Liquid Glass.
 * The v5 header adapter turns this intent into UISearchController and native
 * toolbar items. Earlier iOS versions use separate search and toolbar options.
 *
 * Disabled on every iOS version in T3 Pretty: the native patch can still
 * construct glass chrome on the first Home frame (item groups /
 * sharesBackground after #708). TestFlight 163 still aborted, so JS cannot
 * be the only gate. Screens must fall back to standard search/toolbar
 * primitives when this is false.
 */
export const NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED = isNativeMailSearchToolbarSupported(
  NATIVE_LIQUID_GLASS_SUPPORTED,
  Platform.OS,
  Platform.Version,
);

/** Clearance for scroll content that must come to rest above the floating toolbar. */
export const NATIVE_MAIL_SEARCH_TOOLBAR_CONTENT_INSET = 56;

type NativeMailSearchToolbarInput = Omit<
  HeaderBarButtonMailSearchToolbarItem,
  "type" | "useFallbackSearchField"
>;

/**
 * Describe the thread-list search and actions for the native header adapter.
 */
export function createNativeMailSearchToolbarItem(
  input: NativeMailSearchToolbarInput,
): HeaderBarButtonMailSearchToolbarItem {
  return {
    placeholder: "Search",
    ...input,
    type: "mailSearchToolbar",
    useFallbackSearchField: true,
  };
}
