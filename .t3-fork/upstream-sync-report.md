# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261011.2955`
- Previously integrated parent nightly: `v0.0.46-nightly.20261010.2948`
- Conflict resolver: hand-merge from Origin `main` (`9a409892d`)
- 0 file(s) remain on an unresolved fork-side fallback

## T3 Pretty changes preserved at conflict boundaries

- `packages/client-runtime/package.json` — Kept Pretty-only export maps (pending requests, preview automation, scenery, dictation, skills, and the other fork state modules) and added the parent's `./diff-count` export. The automated sync dropped that export and broke four web imports.
- `apps/web/src/pierre-icons.ts` — Restored Pretty `inferEntryKindFromPath` (used by `MessagesTimeline` and `FileTagChip`) on top of the parent's mime-type icon fallback. The parent deleted the helper in the same region as the mime-type change; a clean take of the parent file is what failed the blocked sync's web typecheck.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Kept Pretty `SlidingActivity` / `ActivityLabel` / `inferEntryKindFromPath` and took the parent's `WorkspaceEntryIcon` imports, disclosure-aware `handleItemSizeChanged`, and top-fade class.
- `apps/web/src/components/ChatView.tsx` — Kept Pretty draft `attachedPullRequestForSend` and the parked-titlebar containing-block comment; took the parent's `sendQueuesBehindSetup` first-message guard and `FileMetadataThreadProvider` wrapper (`const content =`).
- `apps/desktop/src/window/DesktopWindow.ts` — Kept Pretty in-app edit menus on the host renderer. Guests and sign-in popups use the parent's native `popupTemplate` path (the in-app IPC channel cannot reach those contents). Host copy-image now uses the parent's `copyContextMenuImage`.
- `apps/mobile/src/features/review/ReviewSheet.tsx` — Kept `useIsFocused` and added `formatDiffCount`.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Kept Pretty create/babysit pull-request suffix helpers and took `resolveNewThreadEnvMode`.
- `apps/server/src/workspace/WorkspaceFileSystem.ts` — Kept Pretty symlink-safe write realpath helpers and `PROJECT_FILE_CONTENTS_MAX_BYTES`; took parent `getMetadata` (absolute/`~` paths, 512-byte mime sniff).
- `packages/client-runtime/src/state/projectCommands.ts` — Kept Pretty `PROJECT_LARGE_QUERY_IDLE_TTL_MS` (60s) and took parent `fileMetadata.seedAfterRead` executors.
- `packages/contracts/src/filesystem.ts` — Kept Pretty `PROJECT_PATH_MAX_LENGTH` browse/path caps and took `NonNegativeInt` for metadata byte lengths.
- `packages/contracts/src/usage.ts` — Kept Pretty usage bounds (`USAGE_MODEL_MAX_LENGTH`, summary/source caps, `isUsageProviderKind`) and added parent provider `"pi"`.
- `packages/provider-pi/package.json` — Kept Pretty `mcpExtensionSource` / `mcpInjection` exports and added parent `./server/usage`.

## Parent changes integrated at conflict boundaries

- Shared `formatDiffCount` via `@t3tools/client-runtime/diff-count`.
- File metadata RPC (`getMetadata`) for icon mime types on extensionless files; workspace reads may target absolute host paths.
- New-thread env mode from project settings (`resolveNewThreadEnvMode`).
- First message after setup no longer counts as the thread's first once send is queued behind setup.
- File-metadata thread provider wraps chat content so entry icons can resolve mime types.
- Native context menus for browser guests and sign-in popups; `copyContextMenuImage` for image copy.
- Pi usage provider kind and `@t3tools/provider-pi/server/usage`.
- File-metadata seeding after search/list/read queries.

## Parent changes intentionally omitted

- Replacing Pretty in-app host edit menus with a native Electron menu on the main renderer. Guests and popups take the native path.
- Parent 5-minute idle TTL on list/read file queries. Pretty keeps the 60s `PROJECT_LARGE_QUERY_IDLE_TTL_MS` bound.
- Inlining `UsageProviderKind` as a one-off `Schema.Literals([...])` and dropping Pretty usage caps / `USAGE_PROVIDER_KINDS`.

## Post-merge repairs

- Re-export `inferEntryKindFromPath` from `apps/web/src/pierre-icons.ts` after the parent mime-type icon change auto-merged over it.
- Publish `./diff-count` from `@t3tools/client-runtime` so web and mobile `formatDiffCount` imports resolve.
- Teach the parent's `FilesystemGetMetadataInput` path-length test to use Pretty's `FILESYSTEM_PATH_MAX_LENGTH` (32 KiB), not the parent's 512-byte cap.
- Expect Pretty's host-window `WINDOW_ACTIVE_STATE` seed in the parent's capture-delivery DesktopWindow tests.
