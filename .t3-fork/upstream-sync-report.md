# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261012.3010`
- Previously integrated parent nightly: `v0.0.46-nightly.20261011.2994`
- Conflict resolver: scheduled Buildkite #3413 auto-merged most conflicts, then this hand-merge completed the declined mobile markdown / PR / settings / theme files. `automation/sync-resolution-cache` was inspected but not applied (its keys are for a different merge-base).

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/modules/t3-markdown-text` — Pretty's native markdown module stays on iOS/Android (streaming Shiki `highlightCode`, accessibility, link long-press / context menus). The merge had deleted the module; it was restored from Pretty HEAD and now also accepts parent `resolveImageSource`, `onImagePress`, and `linkCustomization`.
- `apps/mobile/src/native/SelectableMarkdownText.{ios,android}.tsx` — platform wrappers still inject `highlightCodeSnippet` and keep iOS default long-press action sheets. App-level types omit `highlightCode` so Enriched callers typecheck.
- `apps/mobile/src/features/files/FileMarkdownPreview.tsx` — Pretty media preview path kept; parent `resolveImageSource` / `onImagePress` wired through, plus Pretty `onLinkLongPress`.
- `apps/mobile/src/features/pull-requests/PullRequestMarkdown.tsx` — Pretty density/styling and nitro fallback kept; parent `PullRequestMarkdownRepository` still re-exported; long-press added on both native and nitro paths.
- `apps/mobile/src/features/pull-requests/PullRequestsScreen.tsx` — Pretty's prop-driven multi-environment list remains the `PullRequests` stack screen.
- `apps/mobile/src/features/settings/components/Settings{ChoiceRow,Row,Section}.tsx` — Pretty glass chrome (`useGlassChromeActive`, `RowPressable`, `GroupedCard`) stays; parent `List*` re-exports were not substituted.
- `apps/mobile/src/lib/mobileDefaultTheme.ts` — Pretty World Scenery palette stays. Parent `--color-prominent-action` / `--color-prominent-action-foreground` tokens are present and mapped onto Pretty foreground/screen, not parent zinc.
- `.github/workflows` — fork-owned sync, signing, release, and security workflows stay pinned to Pretty main.

## Parent changes integrated at conflict boundaries

- `apps/mobile/package.json` / `pnpm-workspace.yaml` — parent `react-native-enriched-markdown` tarball, pierre file-icon assets/script, and Enriched allowBuilds entry are kept alongside Pretty's `@t3tools/mobile-markdown-text` and nitro patches.
- `apps/mobile/src/native/SelectableMarkdownText.tsx` — Enriched renderer is the default/web fallback (`hasNativeSelectableMarkdownText() === false`).
- `apps/mobile/src/native/useMarkdownImageSource.ts`, `useEnrichedLinkVariants.ts`, `EnrichedMarkdownText.tsx` — parent image/link APIs kept so the Enriched path compiles.
- `apps/mobile/src/features/workspace/WorkspaceTabsContext.tsx` — parent `pullRequestEnvironmentId` / `setPullRequestEnvironmentId` state added.
- `apps/mobile/src/features/pull-requests/WorkspacePullRequestsScreen.tsx` — parent self-contained list kept as the workspace-tab root and receives `sidebar={primaryColumn !== null}`.
- `apps/mobile/src/features/workspace/AndroidWorkspaceSidebar.android.tsx` and `WorkspaceRootScreen.android.tsx` — call `WorkspacePullRequestsScreen` instead of Pretty's prop-driven `PullRequestsScreen`.
- `apps/mobile/src/components/ContextSheetSize.ios.tsx` — restored so `worktree-setup-sheet.tsx` resolves the native iOS sheet size module.

## Parent changes omitted to protect T3 Pretty

- `.github/workflows` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned.
- `apps/mobile/modules/t3-markdown-text` — parent first-party Enriched did not replace the Pretty native module. Reason: streaming Shiki, long-press/context menus, and accessibility live in this module; Enriched is the fallback renderer only.
- `apps/mobile/src/features/pull-requests/PullRequestsScreen.tsx` — parent no-arg list did not replace Pretty's prop-driven list. Reason: Pretty's `PullRequests` route already owns multi-host filters; parent list lives in `WorkspacePullRequestsScreen`.
- `apps/mobile/src/features/settings/components/Settings{ChoiceRow,Row,Section}.tsx` — parent `ListChoiceRow` / `ListRow` / `ListSection` re-exports were omitted. Reason: Pretty settings chrome and accessibility roles stay on these components.
- `apps/mobile/src/lib/mobileDefaultTheme.ts` — parent zinc prominent-action colors were omitted. Reason: default theme prominent actions must stay on Pretty foreground/screen so the existing contrast contract holds.

## Hand-complete notes

- Scheduled sync #3413 failed mobile typecheck after auto-resolve: missing `@t3tools/mobile-markdown-text/{links,renderer,types}`, missing nitro/Enriched mix, required `highlightCode` on app wrappers, missing prominent-action tokens, missing `ContextSheetSize`, missing workspace PR environment fields, and Android workspace passing `sidebar` into Pretty `PullRequestsScreen`. The repair model declined.
- `highlightCode` stays required on the native module and is injected only by the iOS/Android wrappers. App/Enriched types do not declare it.
- `EnvironmentAuth` now uses the parent `DESKTOP_RENDERER_ORIGINS` export from `httpCors.ts` and a local Set for Pretty's ambient-cookie origin check, so the names no longer collide.
