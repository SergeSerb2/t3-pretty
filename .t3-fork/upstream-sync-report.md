# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260816.1110`
- Previously integrated parent nightly: `v0.0.34-nightly.20260816.1106`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/global.css` — T3 Pretty's World Scenery light and dark screen, translucent sheet, and corresponding solid-sheet colors.
- `apps/mobile/global.css` — The fork's green primary and secondary action palette, including the light green-tinted shadow and dark primary contrast.
- `apps/mobile/global.css` — World Scenery switch styling across active and inactive tracks and thumbs in both color schemes.
- `apps/mobile/global.css` — The fork's scenery-tinted light input border, sidebar search surface, and higher-contrast placeholder color.
- `apps/mobile/global.css` — T3 Pretty’s dark-theme user bubble remains scenery-aligned green (#24422f) rather than reverting to the parent’s iMessage blue.
- `apps/mobile/global.css` — T3 Pretty’s off-white primary and muted user-bubble foreground colors remain intact for the fork’s visual design.
- `apps/mobile/src/App.tsx` — The SceneryProvider continues to wrap all rendered mobile content, preserving T3 Pretty's World Scenery behavior.
- `apps/mobile/src/App.tsx` — World Scenery's light and dark native-navigation background, card, and accent colors remain authoritative while retaining the other fields supplied by the parent's navigation-theme hook.
- `apps/mobile/src/App.tsx` — LocalLiveActivitySync remains mounted beside navigation, preserving T3 Pretty's iOS Live Activity synchronization and unfreeze fix.
- `apps/mobile/src/App.tsx` — WhatsNewHost and AppMenuHost remain mounted inside the blur target, preserving T3 Pretty's fork UI and app-chrome menu behavior.
- `apps/mobile/src/App.tsx` — Existing incoming-share, blur-target, overlay-portal, keyboard, safe-area, and status-bar structure remains intact.
- `apps/mobile/src/Stack.tsx` — T3 Pretty's World Scenery light/dark native sheet palette remains applied through DynamicColorIOS without replacing the parent's other form-sheet options.
- `apps/mobile/src/Stack.tsx` — T3 Pretty's thread-outbox preload and queued-message state behavior remains wired into the mobile stack.
- `apps/mobile/src/Stack.tsx` — The existing Pretty sheet styling compatibility layer continues to expose the local surface color and content style expected by the rest of Stack.tsx.
- `apps/mobile/src/components/AndroidAnchoredMenu.tsx` — Android continues to delegate to T3 Pretty's shared AnchoredMenu implementation rather than restoring the older duplicated platform implementation.
- `apps/mobile/src/components/AndroidAnchoredMenu.tsx` — The AndroidAnchoredMenu and AndroidAnchoredMenuProps names remain available as aliases, preserving caller compatibility while retaining the fork's unified app-chrome menu styling.
- `apps/mobile/src/components/ComposerToolbar.tsx` — Preserved T3 Pretty's distinction between an ordinary disabled button and an in-flight loading send button by basing disabled border chrome on showDisabledChrome; loading therefore keeps the primary filled presentation and spinner behavior.
- `apps/mobile/src/components/ControlPill.tsx` — ControlPillMenu continues to bypass both AnchoredMenu and native MenuView hosts when disabled, preventing wrapper-owned presses from opening project selectors while images or other locked state prepare.
- `apps/mobile/src/components/ControlPill.tsx` — The fork's cleanup of the unused React Native View import remains intact.
- `apps/mobile/src/components/ProviderIcon.tsx` — Preserved the Circle and Rect SVG imports required by T3 Pretty's Kimi ACP provider icon.
- `apps/mobile/src/features/review/nativeReviewDiffAdapter.ts` — T3 Pretty mobile branding and visual identity remain authoritative because native review colors are resolved from the fork's selected mobile theme, including its fork-owned default and World Scenery presentation.
- `apps/mobile/src/features/review/nativeReviewDiffAdapter.ts` — The native diff continues to blend its background and header into T3 Pretty's sheet/screen surfaces rather than reverting to the parent's old hardcoded default surfaces.
- `apps/mobile/src/features/review/nativeReviewDiffAdapter.ts` — The existing T3 Pretty diff addition/deletion palette remains unchanged.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The composer toolbar fade continues to blend into T3 Pretty’s World Scenery sheet surface rather than reverting to the parent’s former hard-coded gray palette.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Preserved T3 Pretty's scenery-aware reduced-transparency hook used by the mobile composer.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — The shared snoozed/settled shelf header retains T3 Pretty's distinct snooze accent colors, muted and tertiary theme colors, icon and chevron tinting, labels, scenery-aware chrome, and sidebar-specific behavior.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Snoozed and settled shelves continue using T3 Pretty's inbox-card visual language over World Scenery.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Preserved T3 Pretty's useMemo-based work-log row derivation keyed by the activities array, so copy-feedback and expansion repaints do not repeat detail normalization.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Preserved the existing T3 Pretty work-log activity presentation and filtering, including support for fork-added activity types such as skill loads.
- `apps/web/src/components/desktopUpdate.logic.ts` — T3 Pretty branding in the desktop update restart confirmation.
- `apps/web/src/components/desktopUpdate.logic.ts` — The Windows updater safeguard explaining that T3 Pretty may remain closed without an installer window for several minutes and will reopen automatically.
- `apps/web/src/components/desktopUpdate.logic.ts` — The warning that installing an update interrupts running tasks.
- `apps/web/src/themePalette.ts` — The complete T3 Chat-derived light and dark maintainer palettes used by T3 Pretty.
- `apps/web/src/themePalette.ts` — T3 Pretty-specific workspace-header color semantics in both light and dark appearances.
- `apps/web/src/themePalette.ts` — T3 Pretty-specific light diff/code colors and dark full-workspace diff/file-preview continuity.
- `apps/web/src/themePalette.ts` — T3 Pretty branding in palette documentation rather than reverting references to T3 Code.
- `apps/web/src/themePalette.ts` — The fork’s measured sidebar, terminal, accessibility, and composited-surface color choices.

## Parent changes integrated at conflict boundaries

- `apps/mobile/global.css` — Added the parent's new --color-sheet-solid token in both light and dark variants, adapted to T3 Pretty's scenery backgrounds.
- `apps/mobile/global.css` — Integrated the parent's opaque primary-shadow token update while retaining the fork's light-theme shadow hue.
- `apps/mobile/global.css` — Replaced the former single switch-active token with the parent's active/inactive track and thumb token model in both themes.
- `apps/mobile/global.css` — Retained the parent's stronger light placeholder-contrast intent through T3 Pretty's existing, still-darker scenery value.
- `apps/mobile/global.css` — Added the parent’s --color-user-bubble-skill-foreground token to the dark theme, using #f0abfc for consistent inline skill styling.
- `apps/mobile/src/App.tsx` — Adopted the parent's AppContent extraction so appearance-dependent hooks execute beneath AppearancePreferencesProvider.
- `apps/mobile/src/App.tsx` — Integrated the parent's resolved themeAppearance handling for status-bar contrast.
- `apps/mobile/src/App.tsx` — Integrated useThemeColor for the status-bar background.
- `apps/mobile/src/App.tsx` — Integrated useMobileNavigationTheme as the base native-navigation theme, including all parent-provided fields other than the three World Scenery palette overrides.
- `apps/mobile/src/Stack.tsx` — Added the parent's React Native View dependency for its newly integrated stack rendering code.
- `apps/mobile/src/Stack.tsx` — Adopted the parent's canonical FORM_SHEET_PRESENTATION_OPTIONS API instead of relying on the removed standalone sheet-surface color and content-style imports.
- `apps/mobile/src/Stack.tsx` — Preserved any upstream contentStyle and background color by deriving them from the canonical form-sheet options before applying Pretty's iOS presentation overlay.
- `apps/mobile/src/components/AndroidAnchoredMenu.tsx` — The parent's AndroidAnchoredMenu component and props export contract remains available through the fork's aliases.
- `apps/mobile/src/components/ComposerToolbar.tsx` — Integrated the parent change that derives the danger button border from the themed danger foreground color with 14% alpha instead of a hard-coded translucent white.
- `apps/mobile/src/components/ControlPill.tsx` — Native iOS context menus now derive their light/dark theme from AppearancePreferencesProvider's selected themeAppearance rather than the device useColorScheme value, so explicit in-app appearance choices are honored.
- `apps/mobile/src/components/ControlPill.tsx` — The obsolete useColorScheme import is removed consistently with the new appearance-preference implementation.
- `apps/mobile/src/components/ProviderIcon.tsx` — Integrated the parent mobile appearance-preferences provider so provider icon colors follow the app-selected theme instead of the device-only React Native color scheme.
- `apps/mobile/src/components/ProviderIcon.tsx` — Removed the now-unused React Native useColorScheme import from the parent refactor.
- `apps/mobile/src/features/review/nativeReviewDiffAdapter.ts` — Integrated the parent's first-party token-driven native review theming for both dark and light appearances.
- `apps/mobile/src/features/review/nativeReviewDiffAdapter.ts` — Native review text, muted text, borders, hunk backgrounds, and hunk text now follow the selected mobile app theme instead of stale hardcoded or terminal-only colors.
- `apps/mobile/src/features/review/nativeReviewDiffAdapter.ts` — Integrated opaque color flattening at the native boundary so Swift and Android receive unambiguous, compatible color values.
- `apps/mobile/src/features/review/nativeReviewDiffAdapter.ts` — Removed reliance on the obsolete terminalBlue fallback, matching the parent's updated terminal palette destructuring.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Fade colors now derive directly from the active --color-sheet theme token, allowing custom and future themes to work without hard-coded light/dark RGBA values.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The transparent gradient endpoint now uses themeColorWithAlpha(sheetColor, 0), preserving the sheet color channels while applying transparency.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Integrated the parent mobile appearance-preferences provider hook import.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — The shelf header now derives its color scheme from useAppearancePreferences().themeAppearance instead of React Native's useColorScheme(), honoring the parent's appearance-preference refactor.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Adopted the parent mobile implementation's --color-subtle theme token for pressed-row backgrounds instead of hard-coded light/dark RGBA values.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Removed the now-unused useColorScheme import while retaining all imports required by T3 Pretty's memoization optimization.
- `apps/web/src/themePalette.ts` — Retained the parent’s stock default-palette documentation boundary, with the product name adapted to T3 Pretty branding.

## Parent changes intentionally omitted

- `apps/mobile/global.css` — Parent dark-theme user-bubble colors (#0a84ff with white primary and muted foregrounds).. Reason: Those values would overwrite T3 Pretty’s authoritative fork-specific visual theme. The parent’s newly introduced skill foreground token is integrated independently, so only the conflicting palette replacement is omitted.
- `apps/mobile/src/App.tsx` — Direct use of the parent-generated navigation background, card, and primary color values.. Reason: Those three final color fields conflict with T3 Pretty's explicit World Scenery native-navigation palette. The parent theme hook remains the base for every other theme field, so only the smallest conflicting portion is overridden.
- `apps/mobile/src/components/AndroidAnchoredMenu.tsx` — The parent's standalone in-file Android anchored-menu implementation was not restored.. Reason: OURS deliberately replaced that duplicated implementation with T3 Pretty's shared AnchoredMenu. Restoring it would undo the fork's authoritative menu unification and visual-restyling work; this is not a new first-party replacement because the standalone implementation is already present in the merge base.
- `apps/mobile/src/components/AndroidAnchoredMenu.tsx` — The nightly change that derives the legacy menu BlurView tint from useAppearancePreferences().themeAppearance instead of React Native's useColorScheme() was not applied in this file.. Reason: This file no longer renders or owns the blur surface; theme handling belongs to the shared AnchoredMenu implementation. Reintroducing the legacy component solely to apply this hook would regress the fork architecture, and changing the shared component cannot be done safely without its supplied context.
- `apps/web/src/components/desktopUpdate.logic.ts` — Parent simplification removed the Windows-specific delayed/background installation warning from the confirmation message.. Reason: Removing it would regress T3 Pretty's explicit Windows updater lifecycle safeguard and user guidance.
- `apps/web/src/components/desktopUpdate.logic.ts` — Parent confirmation refers to the application as T3 Code.. Reason: T3 Pretty branding is authoritative in the fork and must not be renamed back.
- `apps/web/src/themePalette.ts` — Removal of the T3_CHAT_LIGHT_COLORS and T3_CHAT_DARK_COLORS maintainer palette definitions.. Reason: These palettes are authoritative T3 Pretty visual-design behavior; deleting them would regress the fork’s T3 Chat-derived theme, workspace surfaces, sidebar, diffs, and terminal styling.
- `apps/web/src/themePalette.ts` — Literal T3 Code product naming in the stock default-palette documentation.. Reason: T3 Pretty branding is authoritative, so the documentation keeps the parent’s meaning while using the fork identity.
- `.github/workflows/mobile-showcase-screenshots.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned
