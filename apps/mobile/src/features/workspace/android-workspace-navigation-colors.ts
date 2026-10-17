import { Contrast, argbFromHex, lstarFromArgb } from "@material/material-color-utilities";

import {
  flattenThemeColor,
  themeColorWithAlpha,
  themeColorWithContrast,
  type MobileThemeVariables,
} from "../../lib/mobileTheme";

/** Both navigation positions keep a visible tonal selection against their actual surface. */
export function androidWorkspaceNavigationColors(colors: MobileThemeVariables, rail: boolean) {
  const header = flattenThemeColor(colors["--color-header"], colors["--color-screen"]);
  const containerColor = rail
    ? header
    : flattenThemeColor(themeColorWithAlpha(colors["--color-header-foreground"], 0.05), header);
  let indicatorColor = themeColorWithContrast(
    flattenThemeColor(colors["--color-secondary"], containerColor),
    containerColor,
    1.5,
  );
  const selectedColorFor = (indicator: string) =>
    themeColorWithContrast(flattenThemeColor(colors["--color-secondary-foreground"], indicator), [
      indicator,
      containerColor,
    ]);
  let selectedColor = selectedColorFor(indicatorColor);
  const selectedTone = lstarFromArgb(argbFromHex(selectedColor));
  if (
    [indicatorColor, containerColor].some(
      (surface) => Contrast.ratioOfTones(selectedTone, lstarFromArgb(argbFromHex(surface))) < 4.5,
    )
  ) {
    // One native tint paints both the icon within the indicator and its label
    // below it. Opposing surfaces have no readable shared tint; keep the fill tonal.
    indicatorColor = themeColorWithContrast(
      flattenThemeColor(themeColorWithAlpha(colors["--color-secondary"], 0.18), containerColor),
      containerColor,
      1.5,
    );
    selectedColor = selectedColorFor(indicatorColor);
  }
  return {
    containerColor,
    indicatorColor,
    selectedColor,
    unselectedColor: themeColorWithContrast(
      flattenThemeColor(colors["--color-header-foreground"], containerColor),
      containerColor,
    ),
  };
}
