# T3 Pretty upstream integration report

- Parent nightly: `v0.0.43-nightly.20260927.2331`
- Previously integrated parent nightly: `v0.0.43-nightly.20260926.2318`
- Conflict resolver: not invoked; Git reported no text conflicts

## T3 Pretty changes preserved at conflict boundaries

- No text conflicts required a fork-preservation decision.

## Parent changes integrated at conflict boundaries

- No text conflicts required an AI-composed parent integration.

## Parent changes intentionally omitted

- None. The resolver did not omit any parent change to protect T3 Pretty.

## Post-merge repairs

- `desktop-typecheck` failed after merging `v0.0.43-nightly.20260927.2331` because Pretty's `DesktopPreviewRecordingFrame.data` is `Uint8Array` and recording listeners take `(frame, host)`, while the auto-merged Manager still built base64 strings and called one-argument listeners. Restored Pretty's byte encoding and host-targeted delivery so IPC consumers and the Uint8Array contract stay aligned.
  - edited `apps/desktop/src/preview/Manager.ts`
  - edited `apps/desktop/src/preview/Manager.test.ts`

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.43-nightly.20260929.2416`
- Previously integrated parent nightly: `v0.0.43-nightly.20260928.2402`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/desktop/src/app/DesktopLinuxUrlHandler.ts` — Preserved the 10-second registration timeout used to prevent Linux desktop URL-handler setup commands from hanging indefinitely.
- `apps/mobile/src/state/use-remote-environment-registry.ts` — Preserved T3 Pretty's pairing-cancellation callback, including the existing `onCancelConnectPress` behavior.
- `apps/mobile/src/state/use-remote-environment-registry.ts` — Preserved the T3 Connect-aware removal flow that navigates relay-managed users to T3 Account settings.
- `apps/web/src/components/clerk/T3ConnectSidebarSignIn.tsx` — The sidebar sign-in action continues to use the T3 Pretty account identity through SURGE_CODE_ACCOUNT_NAME.
- `apps/web/src/components/clerk/T3ConnectSidebarSignIn.tsx` — The connect profile page remains branded with SURGE_CONNECT_NAME rather than being renamed back to the parent T3 Connect label.

## Parent changes integrated at conflict boundaries

- `apps/desktop/src/app/DesktopLinuxUrlHandler.ts` — Integrated the parent documentation clarifying that registration refreshes the desktop MIME cache before xdg-mime records the handler as the scheme default.
- `apps/mobile/src/state/use-remote-environment-registry.ts` — Integrated the parent initialization of `useNavigation()` needed by the removal dialog's Settings navigation action.
- `apps/web/src/components/clerk/T3ConnectSidebarSignIn.tsx` — Account profile pages are now rendered from T3_CONNECT_ACCOUNT_PAGES, centralizing their URLs, icons, content, and ordering and allowing newly added parent pages to appear automatically.
- `apps/web/src/components/clerk/T3ConnectSidebarSignIn.tsx` — Direct ServerIcon and SmartphoneIcon imports are removed because page icons now come from the centralized account-page definitions.

## Parent changes intentionally omitted

- `apps/web/src/components/clerk/T3ConnectSidebarSignIn.tsx` — Display the centralized page.label verbatim for the t3-connect account page.. Reason: That label would rename T3 Pretty's Surge Connect presentation back to the parent branding. Only this presentation value is overridden; the parent's page definition, icon, URL, content, ordering, and data-driven rendering are retained.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.43-nightly.20260929.2428`
- Previously integrated parent nightly: `v0.0.43-nightly.20260929.2416`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/server/src/serverSettings.test.ts` — Preserved T3 Pretty's test proving sensitive global environment values remain available in memory but are excluded from settings.json and redacted for clients.
- `apps/server/src/serverSettings.test.ts` — Preserved global environment injection into provider terminal processes, including provider-instance environment precedence over a global value with the same name.
- `apps/server/src/serverSettings.ts` — The exported `globalEnvironmentSecretName` helper and its stable `global-env-&lt;base64url&gt;` naming remain intact for T3 Pretty's shared global environment secrets and Surge Connect behavior.
- `apps/server/src/serverSettings.ts` — Sensitive entries in `settings.globalEnvironment` continue to be redacted before settings are returned to clients.
- `apps/server/src/serverSettings.ts` — Preserved T3 Pretty's secure materialization of sensitive global environment variables from the secret store, including missing-secret fallback and error context used by shared global environment secrets across Surge Connect.
- `apps/server/src/serverSettings.ts` — Preserved inclusion of the materialized globalEnvironment in the returned server settings.
- `apps/server/src/serverSettings.ts` — Preserved T3 Pretty's shared global environment handling, including secure secret-store writes, redaction, inline-value recovery, explicit secret removal, and cleanup of stale global environment secrets.
- `apps/server/src/serverSettings.ts` — Preserved inclusion of the sanitized globalEnvironment value in the returned server settings.
- `apps/server/src/sourceControl/BitbucketApi.test.ts` — Preserved T3 Pretty's hardened authenticated-request diagnostics test, including a transport cause containing a token-like secret and assertions that neither that secret nor the configured account email appears in exposed diagnostics.
- `apps/server/src/sourceControl/BitbucketApi.test.ts` — Preserved the fork's explicit test intent that authenticated HTTP request failures stay out of diagnostics rather than weakening the fixture to a non-sensitive transport message.
- `apps/server/src/sourceControl/BitbucketApi.ts` — Credentials continue to be resolved from server settings on every request, so newly saved Bitbucket credentials apply without restarting the server.
- `apps/server/src/sourceControl/BitbucketApi.ts` — Low-level authentication and HTTP execution failures are sanitized before being retained in BitbucketRequestError, preserving T3 Pretty's safeguard against leaking credentials or request details through diagnostics.
- `apps/server/src/sourceControl/BitbucketApi.ts` — The existing timeout handling, response-size limits, body-read sanitization, and JSON-decode sanitization remain unchanged.
- `packages/contracts/src/settings.ts` — Preserved T3 Pretty's server-side `apps` settings schema and empty-object decoding default.
- `packages/contracts/src/settings.ts` — Preserved T3 Pretty's server-side `automations` settings schema and empty-object decoding default.
- `packages/contracts/src/settings.ts` — Preserved skills settings.
- `packages/contracts/src/settings.ts` — Preserved subagent policy controls, including enablement and child-policy configuration.
- `packages/contracts/src/settings.ts` — Preserved computer-use enablement.
- `packages/contracts/src/settings.ts` — Preserved automatic project icon generation.
- `packages/contracts/src/settings.ts` — Preserved generated activity headlines.
- `packages/contracts/src/settings.ts` — Preserved home suggestion enablement, model selection, scheduling, and whole-value model replacement semantics.

## Parent changes integrated at conflict boundaries

- `apps/server/src/serverSettings.test.ts` — Added coverage that Bitbucket access and API tokens are stored outside settings.json, represented to clients by non-empty redaction markers, and retained when markers are echoed or token fields are omitted.
- `apps/server/src/serverSettings.test.ts` — Added coverage for independently clearing a Bitbucket access token and removing its secret-store entry while retaining the API token.
- `apps/server/src/serverSettings.test.ts` — Added coverage that manually removing a Bitbucket token from settings.json clears a stale secret-store value.
- `apps/server/src/serverSettings.test.ts` — Added coverage that hand-edited Bitbucket tokens are migrated from settings.json into the secret store during settings loading.
- `apps/server/src/serverSettings.test.ts` — Added coverage that hand-edited Bitbucket tokens remain materialized and are migrated when a client echoes the redaction marker while updating other Bitbucket fields.
- `apps/server/src/serverSettings.ts` — Added the parent's canonical Bitbucket access-token and API-token secret names and field list.
- `apps/server/src/serverSettings.ts` — Added the parent's reusable secret redaction helper.
- `apps/server/src/serverSettings.ts` — Bitbucket access and API tokens are now redacted in client-facing server settings while preserving the rest of the Bitbucket configuration.
- `apps/server/src/serverSettings.ts` — Integrated parent materialization of redacted Bitbucket secret fields from the secret store using BITBUCKET_SECRET_FIELDS and BITBUCKET_SECRET_NAMES.
- `apps/server/src/serverSettings.ts` — Integrated inclusion of the materialized bitbucket configuration in the returned server settings.
- `apps/server/src/serverSettings.ts` — Integrated parent Bitbucket secret-field processing using BITBUCKET_SECRET_FIELDS and BITBUCKET_SECRET_NAMES.
- `apps/server/src/serverSettings.ts` — Integrated migration of plaintext Bitbucket secrets hand-edited into settings.json into the secret store while retaining existing secrets represented by SECRET_REDACTED.
- `apps/server/src/serverSettings.ts` — Integrated removal of empty Bitbucket secrets, redaction of newly stored values, and inclusion of sanitized Bitbucket settings in the returned server settings.
- `apps/server/src/sourceControl/BitbucketApi.test.ts` — Integrated coverage proving saved Bitbucket basic credentials and access tokens take effect immediately and take precedence over environment credentials, while clearing them restores environment fallback.
- `apps/server/src/sourceControl/BitbucketApi.test.ts` — Integrated coverage preventing newline-containing saved tokens from being placed in an HTTP Authorization header and verifying fallback to safe environment credentials.
- `apps/server/src/sourceControl/BitbucketApi.test.ts` — Integrated coverage reporting configured saved credentials as unknown, with a non-secret detail, when Bitbucket returns 401 and cannot validate them.
- `apps/server/src/sourceControl/BitbucketApi.test.ts` — Integrated the parent HTTP-client failure behavior: the domain error retains a sanitized message and does not expose the original HTTP client failure object.
- `apps/server/src/sourceControl/BitbucketApi.ts` — Adopted upstream's effectful request flow: resolve the authenticated request with withAuth, then execute it through Effect.flatMap(httpClient.execute).
- `apps/server/src/sourceControl/BitbucketApi.ts` — Preserved upstream's operation-specific BitbucketRequestError mapping at the authentication/HTTP execution boundary, adapted to use the fork's sanitized cause.
- `packages/contracts/src/settings.ts` — Added the parent `bitbucket` settings schema with its empty-object decoding default.
- `packages/contracts/src/settings.ts` — Added the parent Bitbucket settings patch with optional email, access token, and API token fields.
- `packages/contracts/src/settings.ts` — Preserved the parent credential update semantics: empty tokens clear stored values, while omitted tokens retain server state.

## Parent changes intentionally omitted

- `apps/server/src/sourceControl/BitbucketApi.ts` — Store the raw authentication or HTTP client failure as the cause of the inner BitbucketRequestError.. Reason: The raw cause can contain credential-bearing request details and would become exempt from the later sanitizer because it is already a BitbucketApiError. The cause is therefore sanitized at the same boundary while retaining upstream's typed error behavior.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.43-nightly.20260929.2450`
- Previously integrated parent nightly: `v0.0.43-nightly.20260929.2428`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/desktop/src/app/DesktopClerk.ts` — Electron callback work continues to run through the configure scope's context-aware `runFork`, preserving T3 Pretty's desktop lifecycle and Effect runtime hardening.
- `apps/desktop/src/app/DesktopClerk.ts` — Ordinary second-instance window reveal failures retain T3 Pretty's explicit cause-aware warning instead of becoming unobserved failures.
- `apps/desktop/src/app/DesktopClerk.ts` — Provider return URL validation continues to derive the expected origin from T3 Pretty's environment-aware desktop protocol configuration.
- `apps/desktop/src/preload.ts` — Preserved T3 Pretty's edit-context-menu event subscription, payload validation, listener cleanup, and menu-selection resolution IPC, maintaining its in-app context-menu behavior.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — T3 Pretty's redesigned single-card, instant-apply thread settings presentation remains intact instead of restoring the legacy outer wrapper and redundant Options heading.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — T3 Pretty's current descriptor rendering and unified animated layout/enter/exit transitions are preserved, including the existing onOpenSubmenu-only component API.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — The fork's established visual styling for the mobile model/options panel—rounded card, spacing, and layout—is retained while accommodating the new status UI.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — The new-task picker continues to use buildNewTaskThreadSettingsSession output for normalized environment, provider groups, selected model, option descriptors, and runtime mode, preserving the fork's crash-resistant new-thread model-picker behavior.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — The memoized handleSelectModel callback remains in use, preserving the fork's current model-selection flow and selected option forwarding.
- `apps/server/src/provider/Layers/CodexAdapter.ts` — Preserved T3 Pretty’s ability to resume a native Codex session in a new thread by translating input.nativeSessionId into the Codex resume cursor, with priority over the generic resumeCursor fallback.
- `apps/web/src/main.tsx` — Preserved Electron-only lazy loading of the Clerk root so desktop renderers do not eagerly pay for the full clerk-js bundle.
- `apps/web/src/main.tsx` — Preserved the stable provider tree and null Suspense fallback used while the Electron Clerk chunk resolves.
- `apps/web/src/routes/__root.tsx` — Preserved T3 Pretty's World Scenery rendering while the welcome/onboarding workspace is displayed.
- `docs/internals/providers.md` — T3 Pretty's documented Antigravity sign-out ordering remains intact: stop admission and existing processes before clearing account metadata.
- `docs/internals/providers.md` — The safeguard that cached models do not prove current access and that an authoritative empty catalog clears stale models remains intact.
- `docs/user/install.md` — T3 Pretty's supported-provider surface remains authoritative: the removed OpenCode integration is not reintroduced into installation documentation.
- `docs/user/install.md` — The detailed provider matrix retains fork guidance for default binaries, authentication commands, default enablement, Cursor's `cursor-agent` naming, Grok Build, and the official managed Antigravity ACP runtime.
- `docs/user/install.md` — T3 Pretty's Grok reasoning-control documentation and environment-specific provider login guidance remain intact.
- `docs/user/install.md` — The expanded binary discovery, explicit binary-path, Antigravity override, and provider CLI update guidance are preserved; the update paragraph remains once in its existing location below the conflict.
- `packages/client-runtime/src/state/runtime.ts` — Preserved restartOnReconnect behavior by retaining the generation atom and suspending subscriptions with Stream.never until a connected generation is available.
- `packages/client-runtime/src/state/runtime.ts` — Preserved subscription recreation when the environment reconnects, along with the existing configurable idle TTL and normal per-key labels for non-sensitive inputs.
- `packages/contracts/src/ipc.ts` — Kept the optional desktop edit-context-menu request listener and resolver used to render Electron-authored spellcheck, link/image, and clipboard menus in the renderer, including compatibility with older desktop shells.
- `packages/contracts/src/server.ts` — Preserved T3 Pretty's SERVER_PROVIDER_LABEL_MAX_LENGTH validation for provider authentication type, label, and email fields.
- `packages/contracts/src/server.ts` — Applied the fork's bounded provider-auth string policy to the newly introduced profileId field.

## Parent changes integrated at conflict boundaries

- `apps/desktop/src/app/DesktopClerk.ts` — Added hosted ChatGPT/Codex authentication handoff processing, including authorization callback receipt, external-browser launch, callback delivery, and failure logging.
- `apps/desktop/src/app/DesktopClerk.ts` — Added provider-auth return handling that validates the desktop app origin, loads the destination in the main window, and reveals it.
- `apps/desktop/src/app/DesktopClerk.ts` — Added authentication handoff detection from initial host process arguments, macOS-style `open-url` events, and secondary-instance arguments.
- `apps/desktop/src/app/DesktopClerk.ts` — Preserved normal second-instance window reveal behavior when no provider-auth argument was handled.
- `apps/desktop/src/preload.ts` — Added the parent preload API methods for receiving and canceling provider authentication callbacks through their new IPC channels.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — The active environment's server configuration is read from environmentServerConfigsAtom and matched by providerInstanceId.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — ChatGptSharingStatus is rendered for the selected provider, bringing the parent's ChatGPT sharing-state visibility into T3 Pretty's settings panel.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — The selected model's provider instance is supplied to ThreadSettingsSessionProvider when available, using the fork's normalized settings.providerInstanceId as the source.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Provider-instance omission when no provider instance is available is retained through a conditional prop spread.
- `apps/server/src/provider/Layers/CodexAdapter.ts` — Integrated the parent’s per-session effectiveConfig and effectiveEnvironment values supplied by resolveRuntime.
- `apps/server/src/provider/Layers/CodexAdapter.ts` — Integrated propagation of effectiveConfig.binaryPath into CodexSessionRuntimeOptions.
- `apps/server/src/provider/Layers/CodexAdapter.ts` — Applied resolved launch arguments and home path from effectiveConfig while retaining schema-validated resumeCursor support.
- `apps/web/src/main.tsx` — Added startup initialization via prepareProviderAuthDelivery(), enabling the parent provider-auth delivery behavior.
- `apps/web/src/routes/__root.tsx` — Integrated the parent ProviderAuthCallbackCoordinator into the welcome route so provider authentication callbacks remain coordinated during onboarding.
- `docs/internals/providers.md` — Documented the Managed ChatGPT primary-handoff flow for remote environments, including ephemeral credential storage, environment-bound verification, destination-only token persistence and refresh, and fallback to remote callback completion.
- `docs/user/install.md` — Codex can now be connected through ChatGPT using the parent-provided setup flow and documentation link, while the standalone Codex CLI remains supported.
- `docs/user/install.md` — The documentation now identifies ChatGPT-connected Codex as a T3 Code-managed runtime that does not require a server `PATH` entry.
- `docs/user/install.md` — Managed authentication guidance now distinguishes Codex's in-app ChatGPT connection from CLI login commands.
- `packages/client-runtime/src/state/runtime.ts` — Integrated sensitiveInput-aware subscription atom labels, omitting serialized input from labels and using only the environment ID when input is sensitive.
- `packages/contracts/src/ipc.ts` — Added optional receiveProviderAuthCallback and cancelProviderAuthCallback bridge methods for local OAuth callbacks belonging to sign-ins initiated by remote environments.
- `packages/contracts/src/server.ts` — Added the optional subscriptionSharing boolean to ServerProviderAuth.
- `packages/contracts/src/server.ts` — Added the optional profileId field to ServerProviderAuth.

## Parent changes intentionally omitted

- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Restore the parent's legacy outer View with bottom safe-area/native mail-toolbar padding and the separate Options heading.. Reason: T3 Pretty intentionally replaced that structure with its custom single-card instant-apply panel; restoring it would regress fork-authoritative mobile visual design and spacing.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Use the parent's animationsReady-gated enter and exit transitions for select descriptors.. Reason: T3 Pretty's current component API no longer exposes animationsReady and intentionally uses its unified transition behavior for all displayed descriptors.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Place ChatGptSharingStatus outside the options card above the legacy Options heading.. Reason: That parent placement depends on the legacy wrapper and heading removed by T3 Pretty; the status is instead integrated at the top of the fork's existing card without changing its functional provider behavior.
- `docs/user/install.md` — The parent provider table's OpenCode installation and `opencode auth login` row.. Reason: T3 Pretty intentionally removed its unused OpenCode provider integration; documenting OpenCode as available would regress the fork's authoritative provider surface and direct users to unsupported setup.
- `desktop-typecheck` failed after merging `v0.0.43-nightly.20260929.2450`; repaired with `gpt-5.6-sol`: Define both context-bound Effect runners so hosted auth can await shell operations without regressing T3 Pretty’s hardened fire-and-forget handlers.
  - edited `apps/desktop/src/app/DesktopClerk.ts`

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.45-nightly.20260930.2468`
- Previously integrated parent nightly: `v0.0.44-nightly.20260929.2456`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/server/src/provider/Layers/OpenCodeProvider.test.ts` — kept T3 Pretty's intentional deletion of this file
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Active work rows continue to prioritize T3 Pretty's live activity headline when one is available.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The route-thread-keyed SlidingActivity wrapper, collapsed-row handoff key, and live headline plumbing remain intact, preserving T3 Pretty's animated activity handoffs.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — LiveActivityRow continues to receive the active state and existing failure/tool-icon presentation.

## Parent changes integrated at conflict boundaries

- `apps/web/src/components/chat/MessagesTimeline.tsx` — Question work entries now use getQuestionTextPreview as their descriptive fallback instead of always using the generic work-entry label.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The heading-and-answer split is rendered only when the question actually has an answer.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Both question heading and answer can truncate within the flex row, and answered text uses the upstream foreground styling.

## Parent changes intentionally omitted

- `apps/server/src/provider/Layers/OpenCodeProvider.test.ts` — the parent nightly's changes to this fork-deleted file. Reason: resurrecting it would undo a deletion T3 Pretty made deliberately on main
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Upstream always gives the question-text preview precedence as the row label, including while the row has an active live headline.. Reason: That narrow precedence cannot coexist in the single primary-label slot with T3 Pretty's active live-headline behavior. The live headline is retained while active; the upstream question preview is used as the fallback otherwise.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.45-nightly.20260930.2493`
- Previously integrated parent nightly: `v0.0.45-nightly.20260930.2481`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/clerk/MobileClientsUserProfilePage.tsx` — The empty-state copy continues to use T3 Pretty’s SURGE_CODE_ACCOUNT_NAME identity instead of the parent’s T3 Code name.
- `apps/web/src/components/clerk/MobileClientsUserProfilePage.tsx` — Surge Connect branding remains sourced from SURGE_CONNECT_NAME in both the empty-state guidance and page description.
- `apps/web/src/components/clerk/MobileClientsUserProfilePage.tsx` — The empty state continues to identify both push notifications and Live Activities as supported mobile capabilities.

## Parent changes integrated at conflict boundaries

- `apps/web/src/components/clerk/MobileClientsUserProfilePage.tsx` — The empty state now tells users to install the mobile app before signing in.
- `apps/web/src/components/clerk/MobileClientsUserProfilePage.tsx` — The iPhone-only wording is broadened to the parent’s platform-neutral “phone” wording.
- `apps/web/src/components/clerk/MobileClientsUserProfilePage.tsx` — The page description adopts the parent’s clearer focus on mobile devices receiving notifications from environments.

## Parent changes intentionally omitted

- None. The resolver did not omit any parent change to protect T3 Pretty.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.45-nightly.20260930.2510`
- Previously integrated parent nightly: `v0.0.45-nightly.20260930.2493`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The World Scenery daily-photo place remains visible above the composer when scenery chrome is active and the keyboard is hidden.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Workspace controls retain T3 Pretty's NewTaskGlassChip presentation and scenery-aware active styling.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Preserved T3 Pretty's useCallback dependency for its existing callback-based mobile new-task behavior.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Preserved the LegendList-based virtualized and recycled project list, including estimated item sizing, stable scope keys, and extraData updates for environment and reserved-destination state.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Preserved T3 Pretty's distinct filtered-empty state and its existing mobile styling, project/environment navigation, loading presentation, and platform-specific controls.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — T3 Pretty's recycled/virtualized project-scope list remains intact instead of reverting to the parent's older ScrollView-based rendering.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — The fork's Android MaterialListRow project rendering, rounded scope grouping, reserved-destination disabling, and project favicon presentation are preserved.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — The fork's existing non-Android renderProjectScope path and platform-specific project-selection behavior are preserved.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Preserved T3 Pretty's per-workspace-mode auto-create-PR and auto-babysit preferences.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Preserved draft-scoped PR overrides while editing queued pending tasks.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Preserved preference-hydration gating so submission cannot race persisted create-PR or babysit choices.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Preserved coupled toggle behavior: disabling create-PR disables babysitting, while enabling babysitting enables create-PR.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Preserved reactive updates for T3 Pretty's per-environment automatic pull-request creation preference.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Preserved reactive updates for T3 Pretty's per-environment pull-request babysitting preference, ensuring Merge/PR+ behavior remains effective for queued and edited tasks.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Kept the fork's resolved `runtimeMode` dependency already present later in the dependency list rather than restoring the obsolete `defaultRuntimeMode` dependency.
- `apps/server/src/auth/RpcAuthorization.ts` — Preserved authorization for T3 Pretty project favicon imports.
- `apps/server/src/auth/RpcAuthorization.ts` — Preserved read/operate authorization distinctions for project transfer inspection, preparation, sending, and cancellation.
- `apps/server/src/auth/RpcAuthorization.ts` — Preserved T3 Pretty agent-instruction list, read, and write authorization.
- `apps/server/src/auth/RpcAuthorization.ts` — Preserved T3 Pretty skills state, marketplace, installation, removal, and location-setting authorization.
- `apps/server/src/auth/RpcAuthorization.ts` — Preserved read-only access to marketplace refresh so read-only clients can explicitly refresh marketplace data.
- `apps/web/src/components/CommandPalette.tsx` — Preserved the HouseIcon import used by T3 Pretty's fork-specific home screen and navigation behavior.
- `apps/web/src/components/NoProjectsHero.tsx` — T3 Pretty's custom no-project hero description presentation, including the explicit top margin and softened muted-foreground color.
- `apps/web/src/components/chat/DraftHeroHeadline.tsx` — Preserved T3 Pretty's `collectOpenProjectPullRequests` import, which supports pull-request-aware thread nesting and stable PR nest behavior.
- `apps/web/src/components/chat/DraftHeroHeadline.tsx` — Preserved the `useEffect` and `useRef` hooks required by draft attachment state handling, including branch restoration/reset behavior.
- `apps/web/src/components/chat/DraftHeroHeadline.tsx` — Preserved T3 Pretty's inline pull-request attachment selector below the draft headline.
- `apps/web/src/components/chat/DraftHeroHeadline.tsx` — Preserved use of the fork-compatible PullRequestGlyph through the existing pullRequestSelector implementation.
- `apps/web/src/components/chat/DraftHeroHeadline.tsx` — Preserved visual separation for the pull-request selector with the prior 0.75rem spacing.
- `apps/web/src/routes/_chat.tsx` — Preserved T3 Pretty's `useIsMobile` integration and the responsive/mobile behavior that consumes it in the chat route.
- `apps/web/src/routes/_chat.tsx` — Preserved `scopedProjectRef` in the keyboard shortcut effect dependencies, maintaining T3 Pretty's behavior for creating new threads within the filtered sidebar project.
- `packages/contracts/src/rpc.ts` — Preserved T3 Pretty's ProjectImportFaviconError, ProjectImportFaviconInput, and ProjectImportFaviconResult RPC contract imports.
- `packages/contracts/src/rpc.ts` — Preserved the T3 Pretty project favicon import RPC.
- `packages/contracts/src/rpc.ts` — Preserved T3 Pretty project-transfer inspect, prepare, send, and cancel RPCs.
- `packages/contracts/src/rpc.ts` — Preserved fork-specific agent-instruction and automation-run RPCs.
- `packages/contracts/src/rpc.ts` — Preserved managed storage inventory, streaming inventory, and orphan-removal RPCs.
- `packages/contracts/src/rpc.ts` — Preserved the T3 Pretty skills marketplace and app integration RPC surface, including authorization, token, OAuth client, disconnect, and test operations.
- `packages/contracts/src/rpc.ts` — Preserved the project favicon-import RPC and its authorization/error contract.
- `packages/contracts/src/rpc.ts` — Preserved project transfer inspect, prepare, send, and cancel RPCs used by T3 Pretty's cross-environment/T3 Connect transfer behavior.
- `packages/contracts/src/rpc.ts` — Preserved agent-instruction list, read, and write RPCs.
- `packages/contracts/src/rpc.ts` — Preserved automation run-listing and run-detail RPCs.
- `packages/contracts/src/rpc.ts` — Preserved the complete skills state, installation, marketplace, refresh, and per-location enablement RPC surface.
- `packages/contracts/src/rpc.ts` — Preserved app integration management RPCs for configuration, authorization, credentials, disconnection, and connection testing.

## Parent changes integrated at conflict boundaries

- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Workspace controls are now rendered only when flow.canChooseWorkspace is true, preventing unsupported workspace selection UI from appearing.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Integrated the parent imports for Effect Cause inspection and AsyncResult handling.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Added the parent's conditional start-without-a-project action through canStartScratch, startScratchLabel, and startScratch().
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Used a secondary MaterialButton for the Android scratch action and the parent's subtle Pressable presentation on iOS, while retaining the primary add-project action first.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Added the upstream conditional “No project” scratch-task entry when scratch tasks are available, no scratch project exists, and projects are present.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Integrated the upstream Android MaterialListRow version of the scratch entry with its subtitle and text-bubble icon.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Integrated the upstream accessible non-Android scratch entry, including its button role and label, subtitle, icons, and platform-specific styling.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Adapted the upstream entry to the fork's list architecture as ListFooterComponent rather than restoring the obsolete ScrollView/project-map implementation.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Integrated the parent guard that forces scratch/non-worktree-capable projects to use local workspace mode even if a stale draft contains another mode; PR preferences consequently resolve and persist against the effective local mode.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Added `canChooseWorkspace` to the callback dependency list so changes to whether workspace selection is allowed correctly rebuild pending-task messages and clear stale workspace choices for no-project tasks.
- `apps/server/src/auth/RpcAuthorization.ts` — Added authorization for WS_METHODS.projectsEnsureScratch using AuthOrchestrationOperateScope, matching the parent implementation's mutating behavior.
- `apps/web/src/components/CommandPalette.tsx` — Integrated the parent nightly's MessageSquareDashedIcon import for its new command-palette behavior.
- `apps/web/src/components/NoProjectsHero.tsx` — The empty-state description now advertises starting without a project when a scratch environment is available.
- `apps/web/src/components/NoProjectsHero.tsx` — The hero action row uses a gap between the Add project and Start without a project buttons.
- `apps/web/src/components/chat/DraftHeroHeadline.tsx` — Integrated upstream `isScratchProject` support for recognizing scratch projects.
- `apps/web/src/components/chat/DraftHeroHeadline.tsx` — Integrated upstream `MessageSquareDashedIcon` alongside the existing add-project icon.
- `apps/web/src/components/chat/DraftHeroHeadline.tsx` — Integrated upstream `useAtomValue` access for server keybindings.
- `apps/web/src/components/chat/DraftHeroHeadline.tsx` — Retained the expanded React hook imports shared by both sides.
- `apps/web/src/components/chat/DraftHeroHeadline.tsx` — Integrated the scratch-draft-specific “What should we work on?” headline.
- `apps/web/src/components/chat/DraftHeroHeadline.tsx` — Integrated the full-width heading layout inside the centered hero container.
- `apps/web/src/components/chat/DraftHeroHeadline.tsx` — Integrated the reserved fixed-height secondary row that prevents headline movement when projectless threads are available.
- `apps/web/src/components/chat/DraftHeroHeadline.tsx` — Integrated movement of the project selector into the secondary row for scratch drafts and the “start without a project” shortcut for project drafts.
- `apps/web/src/routes/_chat.tsx` — Integrated the parent `useScratchProject` hook import, supporting the upstream scratch-environment and scratch-thread behavior already used by `ChatRouteGlobalShortcuts`.
- `apps/web/src/routes/_chat.tsx` — Added `scratchEnvironmentId` to the keyboard shortcut effect dependencies so upstream scratch-thread creation uses the current environment resolver and satisfies hook dependency correctness.
- `packages/contracts/src/rpc.ts` — Integrated the parent ProjectEnsureScratchResult contract import.
- `packages/contracts/src/rpc.ts` — Added the parent `projects.ensureScratch` RPC method alongside the existing T3 Pretty project registry methods.
- `packages/contracts/src/rpc.ts` — Added the parent WsProjectsEnsureScratchRpc contract, including its empty payload, ProjectEnsureScratchResult response, and orchestration/authorization error union.
- `packages/contracts/src/rpc.ts` — Retained the upstream documentation that the RPC finds or creates the Scratch project under ServerConfig.scratchWorkspaceRoot.

## Parent changes intentionally omitted

- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Retain `defaultRuntimeMode` in the callback dependency list.. Reason: The composed callback uses T3 Pretty's resolved `runtimeMode`, which is already included later in the dependency list, and no longer references `defaultRuntimeMode`; retaining it would be a stale dependency from the parent's older runtime-mode implementation.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.45-nightly.20261001.2525`
- Previously integrated parent nightly: `v0.0.45-nightly.20260930.2510`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/server/src/auth/RpcAuthorization.ts` — Preserved favicon import as an orchestration operate-scope action.
- `apps/server/src/auth/RpcAuthorization.ts` — Preserved project-transfer authorization: inspection remains readable, while prepare, send, and cancel require operate scope.
- `apps/server/src/auth/RpcAuthorization.ts` — Preserved agent-instruction list/read access under read scope and writes under operate scope.
- `apps/server/src/auth/RpcAuthorization.ts` — Preserved skill state and marketplace reads, skill mutations under operate scope, and the fork's intentional read-scope treatment of marketplace refresh for read-only clients.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Preserved T3 Pretty's grouped command-menu rendering, including Built-in, Provider, Skills, Files, and Apps sections and conditional section labels.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Preserved the fork's richer slash-command and @-mention menu organization rather than reverting to one ungrouped command list.
- `apps/web/src/components/sidebar/SidebarThreadHeader.tsx` — The project-rail architecture remains authoritative: obsolete inline project-scope and project-creation controls are not restored in the thread header.
- `apps/web/src/components/sidebar/SidebarThreadHeader.tsx` — The full-width, bordered, theme-aware “Search threads” control and its Pretty-specific icon, placeholder, focus, hover, and clear-button styling are preserved.
- `apps/web/src/components/sidebar/SidebarThreadHeader.tsx` — The compact two-row scoped layout is preserved, including placing the new-thread control beside search for the all-project view and beside the scope title for a selected project.
- `apps/web/src/components/sidebar/SidebarThreadHeader.tsx` — The existing new-thread shortcut and Shift+click current-project behavior remain intact through the shared newThreadButton.
- `packages/contracts/src/rpc.ts` — Project favicon import and project-transfer RPC methods remain available.
- `packages/contracts/src/rpc.ts` — Agent instruction file list/read/write RPC methods remain available.
- `packages/contracts/src/rpc.ts` — Automation run listing and lookup RPC methods remain available.
- `packages/contracts/src/rpc.ts` — Managed storage inventory streaming and orphan-removal RPC methods remain available.
- `packages/contracts/src/rpc.ts` — T3 Pretty skills marketplace, skill-location, and app integration RPC methods remain available.

## Parent changes integrated at conflict boundaries

- `apps/server/src/auth/RpcAuthorization.ts` — Added projectsCreateNew to the authorization map with AuthOrchestrationOperateScope, ensuring project creation is treated as a mutating operation.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Added the upstream list ID and trigger-specific accessible label to CommandList.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Added upstream-generated stable option IDs to every ComposerCommandMenuItem, supporting the item's existing rendered DOM ID and accessible active-option relationships.
- `packages/contracts/src/rpc.ts` — Added the parent projects.createNew RPC method mapping alongside the existing project registry methods.

## Parent changes intentionally omitted

- `apps/web/src/components/sidebar/SidebarThreadHeader.tsx` — Rename the inline project-creation button from “New project” to “Add project”.. Reason: T3 Pretty replaced sidebar project-folder controls with a project rail, so this component no longer has an inline project-creation button or the associated hasProjects, projectScope, onNewProject, FolderPlusIcon, and searchFieldRef APIs. Restoring that control solely to apply the label change would regress the fork architecture and would not compile against the current component interface.
- `.github/workflows/ci.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned
- `.github/workflows/desktop-macos-preview-publish.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned
- `.github/workflows/release-desktop.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned
- `.github/workflows/release.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned
- `desktop-typecheck` failed after merging `v0.0.45-nightly.20261001.2539`; repaired with `gpt-5.6-sol`: Adapted the new download test to T3 Pretty’s preview-WebContents mock architecture while preserving the parent test behavior, eliminating both `never` property-access errors.
  - edited `apps/desktop/src/preview/Manager.test.ts`

---

# Orchestrator V2 integration, 2026-10-02

The latest published installable parent nightly at inspection was `v0.0.45-nightly.20261002.2595`. Integration includes later upstream source through `cc1e634bfa62edd56ff792eea666e436fdef788f`, including orchestrator PR #2829 (`de343914273eceb852a1d1d739cd1d38df7796ee`) and its merged dependencies. The post-nightly source is recorded separately in `upstream-commit`; no unpublished preview is labeled an installable nightly.

This integration replaces V1 runtime, event transport and provider adapters with the upstream V2 orchestrator. Pretty ports preserve automation scheduling/webhooks/MCP, stored and settled/snoozed thread controls, skills/subagent policy, scenery, rich Agents activity, generated image cards, secrets request privacy, ranked thread search, project transfer and managed icons, mobile durable outboxes/native activity, preview/recording and branding. Shipped fork migration numbers remain stable; new migrations append rather than overwrite applied ledger entries.

The authoritative destination is `serbinenko/t3-pretty` on Origin. The user t3code fork integration is https://github.com/SergeSerb2/t3code/pull/1 at `d9fc790335abf45793f3cd6bdc304da9246cfaa0`; its exact main hosted verification and server artifact are https://github.com/SergeSerb2/t3code/actions/runs/37066641611.

Selective builds may opt out of the physical Windows job with per-run `T3CODE_SKIP_WINDOWS=1`; default routing and the existing Windows target/queue remain unchanged. No physical Windows or unrelated media processing operations are part of this integration.

Preserved baseline limitation: selected skills and subagent policy are persisted and exposed through V2 metadata/RPC/UI. The original shipped fork `d50b36971c` had no live `renderSkillsPrelude` or `resolveSubagentPolicy` consumer in provider command/runtime adapters; this integration does not claim new turn-time injection or fleet policy enforcement. Provider-native skill invocation remains supported independently. Existing pure helper tests and new V2 metadata/control tests cover the behavior that was implemented.

Validation is scoped and serialized to avoid contention with unrelated workers. Server/web/mobile/desktop typechecks pass. Focused validation covers V2 event/SQL controls, MCP and secret privacy, native/history imports and replay, transfer/search/home/storage, web shelves and generated images, mobile outboxes/activity, desktop profiles/branding, provider routing, quota cooldowns and release guards. The server bundle builds successfully and its `--help` entry point runs. Release artifacts still require an authenticated selective Buildkite run; a local server bundle is not an installer or a mobile submission.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.46-nightly.20261003.2610`
- Previously integrated parent nightly: `v0.0.45-nightly.20261002.2595`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/desktop/src/app/DesktopLifecycle.test.ts` — Retained the test ensuring Electron child-process exits are mapped into stable crash-log annotation fields, including process type, reason, exit code, service name, and process name.
- `apps/desktop/src/app/DesktopLifecycle.test.ts` — Retained the concurrent development relaunch test that enforces a single shutdown request, one main-window bounds flush, and one direct Electron exit while rejecting use of Electron relaunch.
- `apps/desktop/src/app/DesktopLifecycle.test.ts` — Preserved the T3 Pretty application identity in the Electron app test service via the "T3 Pretty" app name.
- `apps/desktop/src/app/DesktopPreReadyPlatform.test.ts` — Regression coverage for an explicitly present but empty Linux password-store switch, including the safeguard against appending a replacement switch.
- `apps/desktop/src/app/DesktopPreReadyPlatform.test.ts` — Regression coverage ensuring Electron's getSwitchValue is not called when the password-store switch is absent.
- `apps/desktop/src/app/DesktopPreReadyPlatform.test.ts` — T3 Pretty's Linux desktop-entry identity and branding: com.t3tools.T3Pretty.desktop and Name=T3 Pretty.
- `apps/desktop/src/app/DesktopPreReadyPlatform.test.ts` — Compatibility behavior for the t3code URL scheme and existing com.t3tools.T3Code.desktop.png icon path.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — The migration compatibility test continues to reject conflicting upstream preview migration IDs 53 and 54.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — The test continues to verify that a rejected preview migration leaves both the migration ledger and orchestration legacy-import progress unchanged.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — Preserved T3 Pretty's immutable shipped migration ledger and its explicit rejection of conflicting upstream OrchestrationV2 preview IDs 53 and 54 without changing migration history or import progress.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — Preserved the fork's remapped OrchestrationV2 migration identity and migration-manifest validation instead of restoring tests that assume the parent's ID 53 preview ledger can be upgraded in place.
- `apps/server/src/telemetry/Identify.ts` — Preserved the 1 MiB maximum for provider telemetry identity reads.
- `apps/server/src/telemetry/Identify.ts` — Preserved the 1 KiB maximum for anonymous telemetry identity reads.
- `apps/server/src/vcs/GitVcsDriverCore.test.ts` — Preserved the T3 Pretty regression test for fastForwardBranch, including safeguards for dirty checked-out branches, clean working-tree fast-forwards, idempotent updates, non-checked-out branch ref updates, and refusal to move diverged branches.
- `infra/relay/src/agentActivity/ApnsClient.test.ts` — APNs timeout coverage continues to exercise both Live Activity and ordinary push-notification delivery, including send and response-read stalls.
- `infra/relay/src/agentActivity/ApnsClient.test.ts` — The response-read case stalls the Effect HTTP response stream, matching the fork's current response-consumption implementation rather than overriding the legacy text accessor.
- `infra/relay/src/agentActivity/ApnsClient.test.ts` — The test derives timing from APNS_REQUEST_TIMEOUT_MS and verifies that cancellation occurs exactly at the configured deadline, not one millisecond early.
- `infra/relay/src/agentActivity/ApnsClient.test.ts` — Deadline failures remain normalized as ApnsHttpRequestError with stage "deadline", null status, the expected token suffix, and the configured deadline message.
- `packages/client-runtime/src/state/threads-sync.test.ts` — Preserved T3 Pretty's regression coverage ensuring streamed Claude assistant transcript rows survive both full and bounded cursor resumes.
- `packages/client-runtime/src/state/threads-sync.test.ts` — Preserved validation that reconnecting resumes after the cached sequence, ignores a stale replay, applies the newer completed row, avoids duplicate visible rows, and retains bounded-history state.

## Parent changes integrated at conflict boundaries

- `apps/desktop/src/app/DesktopLifecycle.test.ts` — Adopted the parent's `it.effect.each` parameterized form for the updater quit-event test while continuing to cover macOS, Windows, and Linux.
- `apps/desktop/src/app/DesktopPreReadyPlatform.test.ts` — Refactored the duplicate stale/missing Linux desktop-entry cases to upstream's it.effect.each table-driven test.
- `apps/desktop/src/app/DesktopPreReadyPlatform.test.ts` — Integrated upstream's simplified callback structure and explicit missing/stale labels without changing test coverage or cleanup behavior.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — Adopted the parent refactor from a manual loop to `it.effect.each` parameterization.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — Used the parent's syntactically correct closure for the parameterized test, removing the malformed extra brace from the OURS conflict side.
- `apps/server/src/telemetry/Identify.ts` — Integrated upstream's explanation that Codex legitimately omits `tokens` for API-key, agent-identity, and personal-access-token authentication, documenting why the schema keeps that key optional.
- `apps/server/src/vcs/GitVcsDriverCore.test.ts` — Adopted the parent test refactor from a manual for-loop to it.effect.each for offline, authentication, and timeout scoped-fetch failure cases, including the parameterized test title.
- `infra/relay/src/agentActivity/ApnsClient.test.ts` — Replaced the nested request-kind and stage loops with the parent's it.effect.each table-driven test over all four combinations.
- `infra/relay/src/agentActivity/ApnsClient.test.ts` — Retained the parent's shared setup and parameterized test naming while adapting it to the fork's current timeout behavior.
- `packages/client-runtime/src/state/threads-sync.test.ts` — Adopted the parent nightly's `it.effect.each` parameterization for the disk/HTTP unchanged-snapshot test, including its `%s` test title and inferred `source` argument.

## Parent changes intentionally omitted

- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — The parent test parameters and expectation for successfully upgrading preview migration 54 with index cleanup both disabled and enabled.. Reason: T3 Pretty's shipped migration ledger treats upstream preview IDs 53 and 54 as conflicts that must be rejected without mutation; expecting preview 54 to upgrade would directly regress that fork migration-safety behavior.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — The rollback-and-retry test that seeds the parent's ID 53 OrchestrationV2 preview and expects IDs 53, 54, and 56 to be replaced or populated with parent migrations.. Reason: That scenario conflicts with T3 Pretty's authoritative shipped migration IDs and its intentional policy of rejecting conflicting parent preview ledgers. It also depends on `seedPreview`, which is not defined in the resolved fork test file.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — The unexpected-later-migration test based on the parent's `seedPreview` ledger and an `UnknownFork` migration at ID 54.. Reason: ID 54 belongs to the fork's protected migration history, and the parent fixture is incompatible with the fork's explicit rejection model. Keeping this test would assert the obsolete parent ledger layout and reference the absent `seedPreview` fixture.
- `infra/relay/src/agentActivity/ApnsClient.test.ts` — The parent test's fixed ten-second clock adjustment and assertion only after the timeout.. Reason: T3 Pretty's APNs client exposes APNS_REQUEST_TIMEOUT_MS and its regression test deliberately verifies both sides of the exact deadline boundary; reverting to a hard-coded duration would weaken that protection.
- `infra/relay/src/agentActivity/ApnsClient.test.ts` — The parent read-response stall implemented by overriding response.text.. Reason: The fork's current Effect HTTP integration consumes response.stream, so the legacy text override would no longer exercise a stalled response body.
- `infra/relay/src/agentActivity/ApnsClient.test.ts` — The parent's stage-specific status and nested TimeoutError expectations for timed-out requests.. Reason: T3 Pretty's current request-level deadline contract intentionally normalizes both send and response-read timeouts to stage "deadline" with null status and a descriptive configured-deadline cause.
- `.github/workflows/ci.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned
- `.github/workflows/mobile-eas-production.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned
- `web-scenery-unit` failed after merging `v0.0.46-nightly.20261003.2610`; repaired with `gpt-5.6-sol`: Adapt the scenery composer contract to the parent's context-sensitive labels and dispatch-aware primary action without dropping the fork's accessibility, placement, or send-arrow checks.
  - edited `apps/web/src/scenery/sceneryMotionContract.test.ts`

## Completed content-hash overlays

- `apps/web/src/scenery/sceneryMotionContract.test.ts` — applied a completed cache entry keyed by the current file contents

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.46-nightly.20261004.2657`
- Previously integrated parent nightly: `v0.0.46-nightly.20261003.2610`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `pnpm-lock.yaml` — fork-only dependency entries are re-derived by lockfile regeneration against the merged package manifests
- `AGENTS.md` — T3 Pretty's one-concern-per-PR rule, including splitting requests or descriptions that introduce an additional concern with “also.”
- `AGENTS.md` — The Cursor Origin-specific babysitting commands: `origin pr view`, `origin pr checks`, and `origin pr comment`.
- `AGENTS.md` — T3 Pretty's requirement to wait for required review and applicable CI on the latest commit, then enable auto-merge or merge once the PR is mergeable.
- `AGENTS.md` — T3 Pretty's explicit exclusion of Buildkite and PR deployment status from babysitting and remediation.
- `apps/desktop/src/main.ts` — Preserved build-time and runtime T3CODE relay URL propagation to remote SSH runners.
- `apps/desktop/src/main.ts` — Preserved Clerk publishable-key and CLI OAuth client-ID propagation required by the fork's remote/T3 Connect authentication behavior.
- `apps/desktop/src/main.ts` — Preserved filtering of empty public-environment values before passing them to remote runners.
- `apps/desktop/src/settings/DesktopAppSettings.ts` — Preserved T3 Pretty's ensuring-based cleanup of the temporary settings file after either a successful write/rename or any failure, maintaining desktop settings persistence safeguards.
- `apps/desktop/src/settings/DesktopClientSettings.ts` — Preserved T3 Pretty's cleanup safeguard that forcibly removes the temporary settings file after either a successful replacement or a write/rename failure.
- `apps/desktop/src/settings/DesktopClientSettings.ts` — Preserved use of the already serialized and size-checked settings payload for the temporary-file write.
- `apps/desktop/src/settings/DesktopClientSettings.ts` — Preserved atomic temporary-file replacement and existing structured write/replace error reporting.
- `apps/mobile/app.config.ts` — Retained T3 Pretty's withIosPodMinDeploymentTarget.cjs plugin, preserving its iOS native dependency deployment-target compatibility behavior.
- `apps/mobile/src/App.tsx` — Preserved `useMemo`, which is used by T3 Pretty's appearance-aware World Scenery navigation theme composition.
- `apps/mobile/src/App.tsx` — Preserved `View`, required by the retained T3 Pretty native layout rather than applying the parent's import removal.
- `apps/mobile/src/App.tsx` — Preserved LocalLiveActivitySync inside IncomingShareProvider, maintaining T3 Pretty's iOS Live Activity synchronization behavior.
- `apps/mobile/src/App.tsx` — Preserved WhatsNewHost and AppMenuHost alongside the existing confirmation and thread-arrangement hosts.
- `apps/mobile/src/App.tsx` — Preserved the fork's navigation linking and World Scenery-aware navigation theme unchanged.
- `apps/mobile/src/features/home/HomeScreen.tsx` — Preserved T3 Pretty's fork-specific Stored thread shelf and its `ThreadListV2StoredShelfHeader` integration.
- `apps/mobile/src/features/home/HomeScreen.tsx` — Preserved T3 Pretty's Stored shelf expansion preference and toggle behavior through storedShelfExpanded and toggleStoredShelf.
- `apps/mobile/src/features/home/HomeScreen.tsx` — Preserved the Stored shelf toggle dependency so T3 Pretty's long-term thread shelf continues to render and update correctly.
- `apps/mobile/src/features/home/HomeScreen.tsx` — Preserved collapsed pull-request nest state in list extraData so T3 Pretty's nested thread presentation updates visible rows correctly.
- `apps/mobile/src/features/threads/NewTaskContextPickerScreens.tsx` — T3 Pretty's frosted/glass presentation remains active through useGlassChromeActive, GLASS_CARD_CLASS_NAME, and glassCardStyle.
- `apps/mobile/src/features/threads/NewTaskContextPickerScreens.tsx` — LegendList invalidation still accounts for Pretty's glass-mode changes so recycled environment rows update their presentation correctly.
- `apps/mobile/src/features/threads/NewTaskContextPickerScreens.tsx` — Existing selection haptics, machine-specific environment icons, Android header behavior, and Pretty sheet/card styling remain unchanged.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Preserved the T3 Pretty new-task flow's useCallback React dependency.
- `apps/mobile/src/features/threads/ThreadAgentsSheet.tsx` — The frosted iOS thread-agents sheet remains wrapped by SheetSurface.
- `apps/mobile/src/features/threads/ThreadAgentsSheet.tsx` — Glass-aware agent rendering remains controlled by useGlassChromeActive and uses GroupedCard and GlassRowPressable for Pretty's grouped scenery presentation.
- `apps/mobile/src/features/threads/ThreadAgentsSheet.tsx` — The locally enhanced AgentRow keeps its Pretty presentation resolver, symbols, status indicator, styling helper, dividers, and custom sheet-to-thread navigation behavior.
- `apps/mobile/src/features/threads/ThreadAgentsSheet.tsx` — The iOS frosted GroupedCard layout keeps its horizontal padding, compact vertical spacing, and subtle separators only between rows.
- `apps/mobile/src/features/threads/ThreadAgentsSheet.tsx` — Glass rows retain T3 Pretty's compact text-2xs elapsed-time presentation; standard non-glass rows use the upstream text size.
- `apps/mobile/src/features/threads/ThreadAgentsSheet.tsx` — Existing T3 Pretty child-thread navigation, haptics, GlassRowPressable interaction, and provider-managed-agent accessibility behavior remain intact.
- `apps/mobile/src/features/threads/ThreadArrangementSheet.tsx` — Stored-shelf support remains available through the effectiveStored thread-settled helper.
- `apps/mobile/src/features/threads/ThreadArrangementSheet.tsx` — T3 Pretty's frosted-glass thread-sheet presentation remains wired through useGlassChromeActive, GLASS_CARD_CLASS_NAME, and glassCardStyle.
- `apps/mobile/src/features/threads/ThreadArrangementSheet.tsx` — Preserved T3 Pretty's Stored shelf in the arrangement sheet.
- `apps/mobile/src/features/threads/ThreadArrangementSheet.tsx` — Preserved classification through `unstored`, ensuring stored threads do not also appear in Snoozed or Settled.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Preserved the environmentId passed to the voice input controller, which supports T3 Pretty's host-routed and cross-host dictation behavior.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Preserved composerOwnerKey as the stable owner for dictation and settings, while draft content continues to be read from and written to composerDraftKey for queued-message edits.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — Preserved T3 Pretty's Stored shelf header and long-term thread storage UI.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — T3 Pretty's long-term Stored shelf remains represented by storedShelfExpanded and toggleStoredShelf.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — Existing Stored shelf preference behavior remains available alongside the new upstream shelf behavior.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — Preserved T3 Pretty's collapsedPrNests recycler invalidation, ensuring nested pull-request rows update when their collapsed state changes.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — The mobile Stored shelf remains wired through `toggleStoredShelf` and `unstoreThread`.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — T3 Pretty's nested pull-request sidebar behavior remains reactive to `collapsedPrNests` and `togglePrNest`.
- `apps/mobile/src/features/threads/ThreadQueueControl.tsx` — T3 Pretty's QueueRemoveAction abstraction and motion behavior remain intact.
- `apps/mobile/src/features/threads/ThreadQueueControl.tsx` — The remove tray still optionally follows the swiped row via the translation SharedValue when slideActions is enabled.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Preserved T3 Pretty's `displayedModel: ModelOption | null`, which carries full model metadata used by the redesigned mobile model picker and runtime-mode compatibility UI.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Preserved T3 Pretty's runtime-mode choices used by the reasoning, speed, and access-card model picker.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Preserved filtering through visibleDescriptors rather than exposing all provider option descriptors.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Preserved the concrete displayedModel required by T3 Pretty's rebuilt model-picker presentation.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Kept T3 Pretty's instant-apply selection architecture rather than reintroducing a separate pending-model lifecycle.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — T3 Pretty's one-screen ThreadSettingsControlStack for the rebuilt model picker, including its reasoning, speed, access, and runtime controls.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Conditional ChatGPT sharing status placement in the model footer only for providers that support ChatGPT sharing.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — The fork's direct instant-apply option and runtime callbacks.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — The ThreadSettingsProjectTransfer contract used by the fork's copy-or-move-to-connection section.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — The model catalog remains wrapped in T3 Pretty's `SheetSurface` when glass styling is active, including its World Scenery thread key.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — T3 Pretty's rebuilt one-screen model picker remains authoritative; the removed legacy pushed choice page is not reintroduced.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Preserved T3 Pretty's fork-only Stored shelf, including its "Stored" label and valid shelf-header kind.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Preserved the existing T3 Pretty shelf label-map naming and shared rendering path, including snoozed tone and disclosure accessibility behavior.
- `apps/mobile/src/features/threads/thread-subagent-group.tsx` — Retained T3 Pretty’s glass-chrome awareness for the frosted mobile thread-card presentation.
- `apps/mobile/src/features/threads/thread-subagent-group.tsx` — Retained T3 Pretty’s custom ThreadDisclosureChevron used by the animated subagent-group disclosure UI.
- `apps/mobile/src/features/threads/thread-subagent-group.tsx` — Preserved the surrounding fork-owned member entrance animation and system reduced-motion behavior by integrating the upstream row component without replacing the group implementation.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Preserved T3 Pretty mobile image-generation viewing behavior: generated images resolve through `savedPath`, then the first generated path, before falling back to the work-entry image path for other row types.
- `apps/mobile/src/features/threads/threadListV2.ts` — Preserved T3 Pretty's Stored shelf and its position between the snoozed and settled shelves.
- `apps/mobile/src/features/threads/threadListV2.ts` — Preserved the fork's intent that parked work remains accessible without competing with the inbox or settled history.
- `apps/mobile/src/features/threads/threadListV2.ts` — Preserved T3 Pretty's Stored shelf between Snoozed and Settled, including correct `snoozedEnd` and `storedEnd` boundaries.
- `apps/mobile/src/features/threads/threadListV2.ts` — Preserved the fork's mobile list order: active/pending → Working → Snoozed → Stored → Settled.
- `apps/mobile/src/features/threads/threadListV2.ts` — Preserved T3 Pretty's pull-request nesting metadata and collapse behavior through flattenNestedSection.
- `apps/mobile/src/features/threads/threadListV2.ts` — Preserved nesting across pinned, active, working, snoozed, stored, and settled sections, including selected-thread and search-aware expansion behavior.
- `apps/mobile/src/features/threads/threadListV2.ts` — Preserved fork-specific stored and settled item flags required by the Stored and settled shelves.
- `apps/mobile/src/features/threads/use-thread-list-v2-shelf-preferences.ts` — Preserved T3 Pretty's persisted Stored shelf expansion state and its public toggle callback for long-term threads.
- `apps/mobile/src/features/voice-input/useVoiceInputController.ts` — Preserved the EnvironmentId-typed controller input supporting T3 Pretty's environment-aware and connected-host dictation routing.
- `apps/mobile/src/features/voice-input/useVoiceInputController.ts` — The mobile composer retains shared/global dictation behavior and owner-scoped draft and selection updates through the parent-native provider replacement.
- `apps/mobile/src/features/voice-input/useVoiceInputController.ts` — No T3 Pretty branding, identity, theming, delivery, or presentation code is altered by this conflict resolution.
- `apps/mobile/src/lib/storage.test.ts` — Preserved test coverage for the T3 Pretty Stored shelf's `threadListStoredShelfExpanded` preference through save, load, and persisted JSON paths.
- `apps/mobile/src/persistence/mobile-preferences.ts` — The mobile Stored shelf retains its independent `threadListStoredShelfExpanded` preference.
- `apps/mobile/src/persistence/mobile-preferences.ts` — The T3 Pretty World Scenery preference and per-thread photo-assignment models remain intact, including photo-set provenance, blur, translucency, and assignment metadata.
- `apps/mobile/src/persistence/mobile-preferences.ts` — Mobile persistence continues to validate and restore T3 Pretty's fork-specific threadListStoredShelfExpanded preference for the long-term Stored shelf.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts` — Claude V2 can rebind and resume a retained strong native session identity on the first V2 provider turn.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts` — Claude V2 retains the helper control for rebinding a freshly allocated native session.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts` — The retained-session test continues to exercise T3 Pretty's fallback behavior without relying on the upstream nativeThreadHasTurns hint.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — Claude V2 resume support imports transcripts when a provider thread's recorded Claude config directory differs from the active config directory.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — Provider-thread metadata retains the usable transcript config directory, including falling back to the source directory when import fails, and the updated thread is remembered and emitted.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — Claude query processes receive the T3 Pretty MCP provider session's agent-device environment layered over the adapter environment.
- `apps/server/src/provider/RuntimeInstructions.ts` — Preserved T3 Pretty's request_api_key runtime guidance, including masked secret collection, environment-variable loading, and prohibitions against printing, logging, or committing secrets.
- `apps/server/src/provider/RuntimeInstructions.ts` — Preserved the existing pull-request linking requirements, including stack-wide registration and final verification with list_thread_pull_requests.
- `apps/server/src/telemetry/AnalyticsService.ts` — The 10-second analytics request timeout and separate 2-second shutdown flush timeout remain intact.
- `apps/server/src/telemetry/AnalyticsService.ts` — The one-second flush interval remains the canonical fork setting and is reused by the parent's constant name.
- `apps/server/src/telemetry/AnalyticsService.ts` — T3 Pretty's one-minute maximum retry delay remains authoritative and now caps the parent's jittered exponential backoff.
- `apps/server/src/telemetry/AnalyticsService.ts` — The maximum batch size of 100, maximum buffered event count of 10,000, and bounded-integer configuration hardening are preserved.
- `apps/server/src/telemetry/AnalyticsService.ts` — Semaphore-based flush coordination remains available.
- `apps/server/src/telemetry/AnalyticsService.ts` — Preserved explicit release of the HTTP client response body, preventing telemetry responses from retaining transport resources.
- `apps/server/src/telemetry/AnalyticsService.ts` — Preserved protection against hung telemetry sends; the timeout now uses the parent's SEND_TIMEOUT alias backed by ANALYTICS_REQUEST_TIMEOUT.
- `apps/server/src/telemetry/AnalyticsService.ts` — Preserved the fork's retry accounting and mutual-exclusion intent through the parent's more capable delivery state and flush lock.
- `apps/server/src/telemetry/AnalyticsService.ts` — Telemetry batches continue to use T3 Pretty's validated and bounded flushBatchSize rather than reading the raw configured value directly.
- `apps/server/src/telemetry/AnalyticsService.ts` — Concurrent background and shutdown flushes remain serialized.
- `apps/server/src/telemetry/AnalyticsService.ts` — Failure diagnostics remain payload-free: HTTP failure causes that may retain telemetry properties or the PostHog API key are not logged.
- `apps/server/src/telemetry/AnalyticsService.ts` — Failure-aware telemetry retry behavior remains intact: failed sends are retained, exponentially delayed through retryAt/retryDelayMs, and eventually dropped only after the configured maximum batch attempts.
- `apps/server/src/telemetry/AnalyticsService.ts` — The periodic telemetry worker remains scoped to the service lifecycle and continues running with disableYield enabled.
- `apps/server/src/telemetry/AnalyticsService.ts` — The adjacent bounded shutdown flush behavior remains unchanged.
- `apps/server/src/usage/UsageService.ts` — Preserved T3 Pretty's `isValidUsageTimeZone` integration for validating usage-summary time zones.
- `apps/server/src/usage/UsageService.ts` — Preserved use of the richer transcript listing result and its `listing.files` collection.
- `apps/server/src/usage/UsageService.ts` — Preserved partial source status and specific user-facing messages when transcript scanning is truncated, directories are unreadable, or both conditions occur.
- `apps/server/src/usage/usageAggregation.test.ts` — Preserved the AggregateOptions type import used by the fork's configurable aggregation safety limits.
- `apps/server/src/usage/usageAggregation.test.ts` — Preserved isValidUsageTimeZone for the fork's reporting time-zone validation coverage.
- `apps/server/src/usage/usageAggregation.test.ts` — Preserved UsageAggregator and the existing fork aggregation test structure.
- `apps/server/src/usage/usageAggregation.ts` — The shared per-provider usage-summary bucket ceiling remains imported for fork-specific aggregation safeguards.
- `apps/server/src/usage/usageAggregation.ts` — Provider-kind typing remains available for provider-aware aggregation behavior.
- `apps/server/src/usage/usageAggregation.ts` — The exported isValidUsageTimeZone helper remains intact, including graceful rejection of invalid IANA time zones.
- `apps/server/src/usage/usageAggregation.ts` — Configurable per-provider ceilings for buckets, deduplication keys, and session memberships remain declared and continue to support T3 Pretty's aggregation reliability and capacity safeguards.
- `apps/server/src/usage/usageAggregation.ts` — Existing duplicate-record accounting and early-return behavior remain intact.
- `apps/server/src/usage/usageAggregation.ts` — Out-of-window records are rejected before dedupe state is consumed, so an out-of-window transcript copy cannot suppress a later in-window copy.
- `apps/server/src/usage/usageAggregation.ts` — Dedupe identities remain provider-scoped and subject to the per-provider dedupe-key limit.
- `apps/server/src/usage/usageAggregation.ts` — New buckets remain subject to T3 Pretty's per-provider bucket cap, with rejected helper-created buckets rolled back from both the bucket map and last-bucket cache.
- `apps/server/src/usage/usageAggregation.ts` — Capacity drops continue to be counted per provider.
- `apps/server/src/usage/usageAggregation.ts` — Preserved per-provider capacity diagnostics through capacityForProvider, including dropped-record and omitted-session-membership counts.
- `apps/server/src/usage/usageAggregation.ts` — Preserved the fork's centralized #recordCapacityDrop helper used by usage-aggregation safeguards.
- `apps/server/src/usage/usageScanCache.test.ts` — Preserved T3 Pretty’s existing Claude round-trip coverage, including record-level speed values.
- `apps/server/src/usage/usageScanCache.test.ts` — Preserved T3 Pretty’s Grok 4.6 provider fixture and its current explicit ScanCache position representation.
- `apps/server/src/usage/usageScanCache.test.ts` — Kept the fork’s current speed-aware cache schema and surrounding corruption/version compatibility tests unchanged.
- `apps/server/src/usage/usageScanCache.ts` — Preserved T3 Pretty's hard persisted-cache hydration limits for file count, record count, path length, session IDs, dedupe keys, token fields, and reported cost.
- `apps/server/src/usage/usageScanCache.ts` — Preserved the public export of USAGE_SCAN_CACHE_VERSION while updating its value to the upstream v5 format.
- `apps/server/src/usage/usageScanCache.ts` — Strictly rejects records with missing or invalid interned session identifiers.
- `apps/server/src/usage/usageScanCache.ts` — Requires token counts to be safe, nonnegative integers within USAGE_TOKEN_FIELD_MAX rather than accepting arbitrary finite numbers.
- `apps/server/src/usage/usageScanCache.ts` — Rejects overlong or malformed deduplication keys instead of silently coercing them to null.
- `apps/server/src/usage/usageScanCache.ts` — Rejects non-finite, negative, or excessively large reported costs instead of silently coercing malformed values.
- `apps/server/src/usage/usageScanCache.ts` — Keeps the all-or-nothing record validation needed to prevent corrupt warm-cache entries from silently losing usage data.
- `apps/server/src/usage/usageTranscriptReader.ts` — Preserved T3 Pretty's `TranscriptListing` return shape, including `truncated` and `unreadableDirectories` diagnostics.
- `apps/server/src/usage/usageTranscriptReader.ts` — Preserved configurable `maxFiles` and `maxEntries` safeguards and the fork's non-recursive pending-directory traversal.
- `apps/server/src/usage/usageTranscriptReader.ts` — Preserved backward compatibility for callers passing the filename filter as either an options object or a string.
- `apps/server/src/usage/usageTranscriptReader.ts` — Preserved deterministic transcript ordering and enforcement of the maximum returned-file count.
- `apps/server/src/usage/usageTranscripts.ts` — Claude costUSD values continue to be parsed through T3 Pretty's existing reportedCost helper rather than reverting to the older direct cost check.
- `apps/web/src/components/AppSidebarLayout.tsx` — T3 Pretty's custom resizable sidebar behavior continues to use its explicit default and minimum thread-sidebar widths.
- `apps/web/src/components/AppSidebarLayout.tsx` — The sidebar continues to resolve its viewport-dependent maximum at drag time, avoiding a viewport-wide React subscription and stale resize caps.
- `apps/web/src/components/AppSidebarLayout.tsx` — The standard sidebar retains T3 Pretty's responsive CSS width calculation, including correct behavior when the window changes without a resize-driven component render.
- `apps/web/src/components/AppSidebarLayout.tsx` — The Tesla browser touch console keeps its dedicated responsive sidebar width and expanded icon-rail width.
- `apps/web/src/components/AppSidebarLayout.tsx` — The existing minimum-main-content acceptance safeguard, persisted width storage, and resize state updates remain intact.
- `apps/web/src/components/AppSidebarLayout.tsx` — Tesla touch-console mode keeps sidebar resizing disabled.
- `apps/web/src/components/AppSidebarLayout.tsx` — T3 Pretty's existing sidebarResizable configuration remains authoritative, preserving its resize constraints, persistence, callbacks, and fork-specific lifecycle behavior.
- `apps/web/src/components/ChatView.tsx` — T3 Pretty's load-balancing eligibility utilities and LoadBalancingHost type remain available for its provider/model auto-balancing workflow.
- `apps/web/src/components/ChatView.tsx` — T3 Pretty's removal of the legacy useThreadActions dependency is preserved rather than reintroducing an unused or superseded hook into its current thread workflow architecture.
- `apps/web/src/components/ChatView.tsx` — Preserved T3 Pretty's refactored ChatView project-script integration, avoiding restoration of obsolete in-component script construction and keybinding-decoding dependencies.
- `apps/web/src/components/ChatView.tsx` — Preserved T3 Pretty's removal of duplicate updateProjectScriptSettings and upsertKeybinding declarations; their canonical declarations remain later in the command-hook setup.
- `apps/web/src/components/ChatView.tsx` — Model-aware automatic routing falls back to an eligible environment when the scored assignment is stale or the current environment can no longer run the selected model.
- `apps/web/src/components/ChatView.tsx` — A saturated but eligible machine remains usable rather than being treated like a machine whose provider catalog dropped the model.
- `apps/web/src/components/ChatView.tsx` — Redundant draft-context writes are avoided when the draft is already automatically assigned to the selected environment.
- `apps/web/src/components/ChatView.tsx` — A stale load-balanced assignment is cleared when no eligible target can be found.
- `apps/web/src/components/ChatView.tsx` — Preserved `teslaTouch` in the keyboard-handler effect dependency list, maintaining T3 Pretty's Tesla browser touch-layout behavior and correct effect refreshes when that mode changes.
- `apps/web/src/components/ChatView.tsx` — Preserved T3 Pretty's WorkspacePageHeader API and its centralized Electron/non-Electron header layout behavior.
- `apps/web/src/components/ChatView.tsx` — Preserved Electron detection and conditional native window-control inset reservation, including the inline right-panel title-bar exception.
- `apps/web/src/components/ChatView.tsx` — Preserved reduced-motion behavior by keeping the padding transition disabled by default and enabling it only through the parent's motion-safe variant.
- `apps/web/src/components/ChatView.tsx` — Preserved draftHeroHeadlineRef for T3 Pretty's draft-headline transition behavior.
- `apps/web/src/components/ChatView.tsx` — Preserved the data-scenery-hero-chrome="headline" hook used by World Scenery presentation.
- `apps/web/src/components/ChatView.tsx` — Preserved T3 Pretty's zero-padding headline wrapper so its compact, tabbed suggestion shelf layout is not spaced back apart.
- `apps/web/src/components/CommandPalette.tsx` — Preserved the `commandPaletteNewThreadInValue` import used by T3 Pretty's command-palette new-thread-in-project behavior.
- `apps/web/src/components/CommandPalette.tsx` — Preserved T3 Pretty's composer handle access in the open command palette, retaining its fork-specific composer focus integration.
- `apps/web/src/components/CommandPaletteResults.tsx` — The command-palette empty state retains `role="status"` so assistive technology can announce the result state.
- `apps/web/src/components/CommandPaletteResults.tsx` — The same accessibility behavior is now consistently applied to the virtualized empty state through the shared component.
- `apps/web/src/components/ServerUpdateAction.tsx` — The compact CircleArrowUpIcon-based update action and its React state/ref support remain available.
- `apps/web/src/components/ServerUpdateAction.tsx` — T3 Pretty's StatusPulseDot integration remains intact for update-status presentation.
- `apps/web/src/components/Sidebar.logic.test.ts` — Preserved test coverage dependencies for T3 Pretty's project-scope navigation behavior.
- `apps/web/src/components/Sidebar.logic.test.ts` — Preserved project-rail attention, activity aggregation, formatting, and activity-mark test helpers.
- `apps/web/src/components/Sidebar.logic.test.ts` — Preserved T3 Pretty sidebar top-status resolution and Stored shelf sorting test helpers.
- `apps/web/src/components/Sidebar.tsx` — Preserved T3 Pretty's Stored shelf behavior by retaining "unstore" as a valid sidebar row action.
- `apps/web/src/components/Sidebar.tsx` — Preserved T3 Pretty's two-line sidebar-row layout, where status and action states occupy the same grid cell so hover and keyboard actions do not re-wrap thread titles.
- `apps/web/src/components/Sidebar.tsx` — Sidebar project expansion state remains connected through projectExpandedById and setProjectExpanded.
- `apps/web/src/components/Sidebar.tsx` — T3 Pretty's per-thread last-visited state remains available through threadLastVisitedAtById.
- `apps/web/src/components/Sidebar.tsx` — Preserved the fork-only Stored thread section in sectionByThreadKey and retained storedThreads in the memo dependency list, ensuring action and drag section data updates when Stored shelf membership changes.
- `apps/web/src/components/Sidebar.tsx` — Kept the surrounding T3 Pretty pointer-following thread drag and cross-context drag infrastructure unchanged.
- `apps/web/src/components/Sidebar.tsx` — Preserved the attemptStore dependency required by T3 Pretty's multi-selected-thread Stored shelf action and its co-storage navigation behavior.
- `apps/web/src/components/Sidebar.tsx` — Preserved T3 Pretty's always-mounted sidebar tree with its separate project rail, scoped folder/project navigation, and animated pane architecture.
- `apps/web/src/components/Sidebar.tsx` — Preserved the Pretty fixed thread header, scoped folder/project title presentation, environment badge, search keyboard navigation, and search-result layout.
- `apps/web/src/components/Sidebar.tsx` — Preserved the fork's project-folder filtering and project-rail behavior instead of restoring the legacy header project combobox duplicated by the diff alignment.
- `apps/web/src/components/Sidebar.tsx` — The fork's dedicated SidebarSearchResultRow architecture, including search-result highlighting, route-active state, stable result IDs, and matched-text metadata.
- `apps/web/src/components/Sidebar.tsx` — Search-result keyboard navigation and accessibility semantics driven by activeSearchResultIndex and resultId.
- `apps/web/src/components/Sidebar.tsx` — The fork's project-scoped sidebar search presentation and its existing project, environment, provider, selection, and file-drop data flow.
- `apps/web/src/components/Sidebar.tsx` — Regular thread-row action and drag behavior remains distinct from search-result rendering, avoiding duplicate environment props and unsupported regular-row callbacks.
- `apps/web/src/components/Sidebar.tsx` — T3 Pretty's item-aware thread-row rendering, including stored-thread behavior, nested pull-request metadata, row variants, and fork-specific thread actions.
- `apps/web/src/components/Sidebar.tsx` — T3 Pretty's sidebar thread-search result completion and empty-search status UI.
- `apps/web/src/components/Sidebar.tsx` — T3 Pretty's drag-and-drop lifecycle, pointer-following sortable behavior, motion attachment, and section-aware list architecture.
- `apps/web/src/components/Sidebar.tsx` — The VoiceOver-compatible presentational list semantics used by the Pretty sidebar.
- `apps/web/src/components/Sidebar.tsx` — T3 Pretty's current SidebarListItem-driven renderer rather than reverting to the parent's older section-only render signature.
- `apps/web/src/components/chat/MessagesTimeline.logic.ts` — The worktree setup card remains attached directly beneath the initiating user send instead of being led by a synthetic or pre-existing working indicator.
- `apps/web/src/components/chat/MessagesTimeline.logic.ts` — Before timeline-confirmed handoff, the setup card continues to replace the working and thinking placeholders via the early return.
- `apps/web/src/components/chat/MessagesTimeline.logic.ts` — Normal live-turn rows resume only after the agent has started and the latest run has a timeline-visible start, preserving T3 Pretty's eased first-turn transition.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Preserved T3 Pretty's observeLiveActivityMotion integration for live-activity animation timing and motion behavior.
- `apps/web/src/components/pullRequest/PullRequestReviewAnnotation.tsx` — Origin Grok review-finding detection remains enabled through `parseGrokReviewFinding`.
- `apps/web/src/components/pullRequest/PullRequestReviewAnnotation.tsx` — T3 Pretty's `FixFindingButton` flow remains in place, preserving its fork-specific fix-destination behavior.
- `apps/web/src/components/pullRequest/PullRequestReviewAnnotation.tsx` — The fork's `useEffect` dependency remains available for its added review-finding lifecycle behavior.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — The explicit `auto minmax(0,1fr) auto` page-row grid remains on the element containing the glyph, metadata, and diff stat, preserving T3 Pretty's narrow-list overlap fix.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — T3 Pretty's page-row spacing and shared row presentation remain on the selectable inner button.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — The row's hover/selection color transition is retained on the new outer element that owns those background states.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Preserved `overflow-hidden` on the pull-request row metadata container, preventing metadata from overlapping the diff stat in narrow lists.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — Preserved T3 Pretty's removal of the legacy free-form per-instance environment-variable editor, leaving the adjacent field-definition-based provider environment controls authoritative.
- `apps/web/src/components/settings/settingsSearch.ts` — Preserved the T3 Pretty settings-search entry for Auto-generate project icons under General settings.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — The live sidebar continues to display the T3 Pretty image and “Pretty” wordmark rather than the parent T3 Code identity.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — The sage Pretty mark remains visible on plain chrome and is inverted over World Scenery/stage artwork for contrast.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — The collapsed project rail retains its `data-sidebar-brand` and `data-sidebar-brand-word` hooks, allowing only the wordmark to fold away while the Pretty mark remains on the resting rail.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — The environment pill retains Pretty's rounded, muted presentation and the `sidebar-brand-stage`/`data-sidebar-peek="label"` hooks that control its visibility during sidebar collapse and peek transitions.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Backdrop-aware wordmark coloring, cap-edge trimming, focus treatment, and the existing threads navigation link are preserved.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — The visible sidebar link continues to render SidebarPrettyBrandMark, preserving T3 Pretty branding and backdrop treatment.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — The horizontal/vertical SidebarUtilityMenuOrientation type is retained, preserving the fork's stable vertical project-rail utility layout and horizontal footer layout.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — The existing width probe continues to size against both the parent T3 Code mark and the wider rendered T3 Pretty mark.
- `apps/web/src/components/threadSidebarWidth.test.ts` — Preserved T3 Pretty’s 256px minimum sidebar width and branded desktop wordmark coverage.
- `apps/web/src/components/threadSidebarWidth.test.ts` — Preserved stored sidebar widths above the current viewport maximum as preferences, with the rendered width constrained by the live CSS viewport clamp.
- `apps/web/src/components/threadSidebarWidth.test.ts` — Preserved sidebar resize-rail pointer handling after tooltip preventDefault behavior.
- `apps/web/src/components/threadSidebarWidth.test.ts` — Preserved the 3rem collapsed rail and macOS titlebar inset geometry.
- `apps/web/src/components/threadSidebarWidth.test.ts` — Preserved the fork’s width-based animated sidebar peek, overflow clipping, opening state, shadow, hover bridge, drag hole, pane/copy/label fading, and reduced-motion-compatible transition contracts.
- `apps/web/src/components/threadSidebarWidth.test.ts` — Preserved the single-column project rail and vertical utility-menu behavior.
- `apps/web/src/components/threadSidebarWidth.test.ts` — Preserved the environment-identification pill’s container-query wrapper behavior.
- `apps/web/src/components/usage/UsagePage.tsx` — Preserved T3 Pretty's source warning reporting through `merged.sourceWarnings`.
- `apps/web/src/components/usage/UsagePage.tsx` — Preserved T3 Pretty's omitted-environment count in the usage environment filter.
- `apps/web/src/components/usage/UsagePage.tsx` — Preserved T3 Pretty's indication that additional coverage warnings were omitted.
- `apps/web/src/components/usage/UsagePage.tsx` — Preserved source-level usage warnings in the environment filter.
- `apps/web/src/components/usage/UsagePage.tsx` — Preserved reporting of environments omitted by the usage merge limit.
- `apps/web/src/components/usage/UsagePage.tsx` — Preserved reporting when additional coverage notices are omitted.
- `apps/web/src/components/usage/UsagePage.tsx` — The pending-environment indicator retains the T3 Pretty `status-pulse` animation hook used with `useStatusPulse`, preserving the fork's scan-progress presentation and motion handling.
- `apps/web/src/components/usage/UsagePage.tsx` — Usage coverage notices continue receiving and displaying source warnings, the count of environments omitted by the merge limit, and the count of omitted coverage warnings.
- `apps/web/src/components/usage/UsagePage.tsx` — Existing multi-environment selection, partial-scan status, contract mismatch reporting, duplicate-source reporting, and model-price navigation remain intact.
- `apps/web/src/diffPanelStore.test.ts` — Coverage that the selected diff render mode is retained in live state, persisted state, and after rehydration.
- `apps/web/src/diffPanelStore.test.ts` — Coverage that malformed persisted thread selections, branch base refs, reveal request IDs, paths, and render modes are sanitized during migration.
- `apps/web/src/diffPanelStore.ts` — Preserved the T3 Pretty `DiffRenderMode` type supporting both stacked and split diff presentation.
- `apps/web/src/hooks/showThreadUndoNotice.ts` — Preserved T3 Pretty's Stored-thread undo notice action used by the fork's long-term thread shelf.
- `apps/web/src/hooks/useThreadActions.ts` — Preserved lifecycle mutation retargeting through readWritableThreadRef so writes reach the connected writable thread reference.
- `apps/web/src/hooks/useThreadActions.ts` — Preserved mirroring of successful lifecycle writes onto the original catalog row when retargeting crosses environments, keeping its optimistic overlay consistent without mirroring failed writes.
- `apps/web/src/index.css` — Preserved the parked titlebar control-count and calculated cluster-width tokens used for T3 Pretty’s two- or three-control desktop titlebar layout.
- `apps/web/src/index.css` — Preserved the 2.5rem titlebar scroll-fade height that keeps resting messages below the header.
- `apps/web/src/index.css` — Preserved T3 Pretty’s removal of the root chat-content maximum width and fixed thread-details panel width, avoiding a regression of the fork’s visual layout.
- `apps/web/src/routes/__root.tsx` — Preserved SceneryHost in the main application shell so T3 Pretty World Scenery backgrounds and theming remain active across workspace navigation.
- `apps/web/src/state/query.ts` — Query data, formatted errors, and pending state continue to come from readAtomQueryResult, preserving T3 Pretty's centralized handling of interrupted and retained query results.
- `apps/web/src/state/query.ts` — dataUpdatedAt remains nullable and is populated only for a current successful result, rather than using zero or stale previous-success timestamps.
- `apps/web/src/state/query.ts` — A null query atom remains non-pending, and the existing one-retry handling for settled query interruptions remains intact.
- `apps/web/src/versionSkew.ts` — Manual server updates continue to use `forkCliCommand`, preserving the T3 Pretty CLI package, version construction, and branded default npx invocation instead of reverting to the parent `t3` package.
- `docs/internals/connection-runtime.md` — T3 Pretty's single shared runtime architecture, platform-specific composition, environment-scoped supervisors, and prohibition on competing legacy connection owners remain documented.
- `docs/internals/connection-runtime.md` — The relay-conscious retry policy remains intact: a five-minute long-tail cap, reset only after 30 seconds of stability, and an immediate first reconnect after a stable lease drops.
- `docs/internals/connection-runtime.md` — T3 Pretty's mobile make-before-break resume behavior is preserved: a replacement starts in parallel with a shortened probe, a healthy lease can cancel it, and a dead lease swaps without waiting for the probe timeout or a backoff sleep.
- `docs/internals/connection-runtime.md` — T3 Pretty's explicit connection-state and synchronization-state separation, cache retention, and honest reconnect publication behavior remain documented.
- `docs/internals/connection-runtime.md` — Fork cleanup guarantees remain represented, including shell and thread cache removal plus platform-owned data cleanup.
- `docs/internals/glossary.md` — The maintainer-facing glossary, user-documentation link, table of contents, and detailed concept hierarchy remain intact.
- `docs/internals/glossary.md` — Detailed project/workspace behavior is retained, including managed-worktree inventory capability gating, unsafe dirty-state handling, and T3 Connect project transfer semantics.
- `docs/internals/glossary.md` — Fork-specific turn behavior remains documented, including queue/steer delivery, generated activity headlines, and the BM25 thread search index.
- `docs/internals/glossary.md` — Existing decider, projector, reactor, runtime-receipt, and quiescence terminology remains available for fork services and automation-related orchestration behavior.
- `docs/internals/providers.md` — Preserved T3 Pretty's removal of the OpenCode provider and the explicit warning that the following OpenCode constraints are parent-only synchronization context, not active fork behavior.
- `docs/internals/providers.md` — Preserved T3 Pretty naming for the thread-scoped `t3-code` MCP connection.
- `docs/user/keybindings.md` — Running-thread messages steer by default.
- `docs/user/keybindings.md` — Automatic queuing remains available through Settings → General → Legacy features → Queue messages.
- `docs/user/keybindings.md` — `mod+Enter` still performs the opposite queue-or-steer action for one message, including when the normal send shortcut requires a modifier.
- `docs/user/keybindings.md` — The send button continues to use T3 Pretty's default action rather than referring to the parent's Follow-up behavior setting.
- `docs/user/keybindings.md` — Preserved documentation that `thread.undo` can reverse storing a thread from the sidebar notice.
- `packages/client-runtime/src/connection/model.ts` — ConnectionBlockedError continues to enforce maximum lengths for detail and traceId through the bounded schemas and constructor normalization, preventing oversized connection error payloads.
- `packages/client-runtime/src/connection/supervisor.test.ts` — Pretty's reconnect schedule remains 3s, 4s, 8s, 16s, 32s, 60s, 120s, then a five-minute cap, including a repeated capped retry.
- `packages/client-runtime/src/connection/supervisor.test.ts` — The fork-specific test proving ±20% jitter around the 3-second first retry remains intact.
- `packages/client-runtime/src/connection/supervisor.ts` — T3 Pretty's relay-chatter hardening keeps retries from starting sooner than three seconds and retains a five-minute maximum backoff.
- `packages/client-runtime/src/connection/supervisor.ts` — The 500-millisecond replacement head start remains, allowing a healthy existing transport to answer before paying for a replacement ticket, handshake, and configuration fetch.
- `packages/client-runtime/src/connection/supervisor.ts` — The existing three-second fast mobile probe behavior is retained under the parent's generalized quick-probe name.
- `packages/client-runtime/src/connection/supervisor.ts` — Preserved T3 Pretty’s long, five-minute retry ceiling for persistently failing connections, maintaining the fork’s reconnect-chatter hardening intent.
- `packages/client-runtime/src/connection/supervisor.ts` — Kept the surrounding fork supervisor architecture and its existing retry-jitter helper unchanged.
- `packages/client-runtime/src/connection/supervisor.ts` — Preserved T3 Pretty's foreground wake recovery semantics: the first reconnect backoff rung is skipped only after a dead-transport probe and failure to establish a replacement lease.
- `packages/client-runtime/src/connection/supervisor.ts` — Preserved the fork's reconnect-chatter safeguard by retaining the wakeRecoveryFailed state rather than treating every in-flight or unanswered probe as grounds for immediate retry.
- `packages/client-runtime/src/connection/supervisor.ts` — Managed relay/T3 Connect credential changes remain relay-target-gated, retain account-change logging, and terminate the affected published lease.
- `packages/client-runtime/src/connection/supervisor.ts` — No T3 Pretty branding, identity, theming, or presentation code is present in this conflict, so no presentation reapplication is required.
- `packages/client-runtime/src/connection/supervisor.ts` — The ActiveLease-based monitor API, including attempt-span propagation for traced connection failures.
- `packages/client-runtime/src/connection/supervisor.ts` — T3 Pretty's mobile wake recovery behavior, including reason-specific probe timeouts and parallel replacement connection establishment.
- `packages/client-runtime/src/connection/supervisor.ts` — Scope-managed replacement leases and complete interruption/cleanup of probes, replacement timers, replacement fibers, and authorization retry timers.
- `packages/client-runtime/src/connection/supervisor.ts` — Authorization-refresh replacement tracking and retry accounting for managed connections.
- `packages/client-runtime/src/connection/supervisor.ts` — Immediate unpublishing of a known-dead lease, honest reconnecting state publication, and wake-recovery fast retry behavior when replacement fails.
- `packages/client-runtime/src/connection/supervisor.ts` — The concurrent monitor continues racing transport closure, wake probes, replacement head-start timers, replacement establishment, DPoP refresh/expiry, authorization retry timers, and lifecycle signals instead of reverting to the parent's sequential nested probe loop.
- `packages/client-runtime/src/connection/supervisor.ts` — DPoP connections retain proactive replacement before token expiry, retry-with-backoff while a healthy lease remains active, and immediate release once the token expires.
- `packages/client-runtime/src/connection/supervisor.ts` — Mobile and foreground wake recovery retains the probe-plus-delayed-replacement strategy, including the shorter mobile probe timeout configured by startProbe and replacement without a backoff rung after a dead wake lease.
- `packages/client-runtime/src/connection/supervisor.ts` — The active lease is unpublished and connection state is reported honestly when the old transport dies while a replacement is still being established.
- `packages/client-runtime/src/connection/supervisor.ts` — Disconnect, retry, offline, relay credential-change, session-close, and authoritative intent checks continue to interrupt all relevant probe/replacement work safely.
- `packages/client-runtime/src/connection/supervisor.ts` — The resolution preserves the single-inflight-probe and replacement safeguards that avoid redundant relay/Worker connection chatter.
- `packages/client-runtime/src/connection/supervisor.ts` — Stable established connections that drop still bypass the first backoff delay, clear the retry ladder and latest failure, and immediately return to connecting state.
- `packages/client-runtime/src/connection/supervisor.ts` — Foreground dead-transport recovery remains immediate and is covered by the parent's generalized probe-failure mechanism without weakening T3 Pretty's stable-session recovery behavior.
- `packages/client-runtime/src/state/projectCommands.test.ts` — Preserved the T3 Pretty regression test requiring searchEntries, listEntries, and readFile payload atoms to use PROJECT_LARGE_QUERY_IDLE_TTL_MS rather than the generic query TTL.
- `packages/client-runtime/src/state/projectCommands.test.ts` — Preserved coverage protecting early release of idle tree and file payloads for cross-surface reliability.
- `packages/contracts/src/environment.ts` — Preserved the optional `threadStorage` capability used to negotiate T3 Pretty's `thread.store` / `thread.unstore` lifecycle commands under version skew.
- `packages/contracts/src/orchestrationV2.ts` — Preserved `nativeMetadata.configDir`, which supports T3 Pretty provider configuration and restored provider workflows.
- `packages/contracts/src/usage.ts` — Kept `cacheSavingsUsd` validated by `UsageFiniteNonNegativeNumber`, preserving T3 Pretty's stricter protection against negative, infinite, and NaN cache-savings values.
- `scripts/notify-discord-release.test.ts` — Preserved T3 Pretty's `redactDiscordWebhookCause` import and the associated release-notification redaction coverage.
- `scripts/notify-discord-release.test.ts` — Webhook failures retain safe diagnostic request context, including whether role-mention syntax was present.
- `scripts/notify-discord-release.test.ts` — The original secret-bearing HTTP client error is represented by a sanitized stable cause message instead of exposing its nested request and encoder cause.
- `scripts/notify-discord-release.test.ts` — The webhook URL and secret token are explicitly prohibited from the public error message and retained cause.
- `scripts/notify-discord-release.test.ts` — Detailed T3 Pretty webhook failure metadata checks remain enforced: release target, tag, webhook origin, pathname segment count, and HTTP response status.
- `scripts/notify-discord-release.test.ts` — T3 Pretty's hardened webhook-error redaction remains covered, including its sanitized cause message and guarantees that neither the public error message, sanitized cause, nor rendered Effect cause exposes the webhook secret.
- `scripts/notify-discord-release.ts` — Preserved T3 Pretty's 60-second Discord webhook timeout used to harden release notification reliability.
- `scripts/notify-discord-release.ts` — Preserved T3 Pretty's exported redactDiscordWebhookCause helper, which reports safe Effect error tags without exposing raw webhook failure causes or potentially sensitive details.
- `scripts/notify-discord-release.ts` — Preserved T3 Pretty product branding in the prerelease announcement shown to nightly testers.
- `scripts/notify-discord-release.ts` — T3 Pretty release-announcement branding, prerelease messaging, payload formatting, role mentions, and surrounding release infrastructure remain unchanged.
- `scripts/notify-discord-release.ts` — The fork's webhook-token secrecy safeguard remains effective; the parent implementation replaces fork-local cause redaction with stricter safe metadata and cause omission.

## Parent changes integrated at conflict boundaries

- `pnpm-lock.yaml` — took the parent nightly's generated lockfile wholesale instead of AI-splicing it
- `AGENTS.md` — Adopted the parent's one-request-per-PR framing as the default while retaining the fork's stricter concern boundary.
- `AGENTS.md` — Added the parent's explicit link to the external-contribution one-problem-per-PR rule.
- `AGENTS.md` — Made the parent's requirement that relevant bots be green on the latest commit explicit alongside T3 Pretty's review and CI requirements.
- `apps/desktop/src/main.ts` — Integrated the parent desktop `--version` fast path, which writes the Electron app version synchronously so output flushes before exit.
- `apps/desktop/src/main.ts` — Integrated the parent's EPIPE-tolerant version output and immediate Electron process exit behavior.
- `apps/desktop/src/settings/DesktopAppSettings.ts` — Integrated the parent change to rename the temporary file onto the resolved `targetPath`, so settings writes correctly follow an existing symlink instead of replacing the symlink path itself.
- `apps/desktop/src/settings/DesktopClientSettings.ts` — Integrated the parent fix that renames the temporary file to the resolved symlink target (`targetPath`) rather than replacing the configured symlink path itself.
- `apps/mobile/app.config.ts` — Added the parent expo-sensors configuration with motionPermission disabled, compiling out unused pedometer support while retaining accelerometer-based device-viewer shake behavior and avoiding an iOS motion purpose string.
- `apps/mobile/src/App.tsx` — Retained the parent's compatible `useEffect` and `StatusBar` imports without altering their behavior.
- `apps/mobile/src/App.tsx` — Integrated GlobalVoiceInputControl as the top-level content wrapper under VoiceInputProvider, enabling the parent's global voice-input UX.
- `apps/mobile/src/App.tsx` — Retained the upstream host and navigation composition within the new voice-input control.
- `apps/mobile/src/features/home/HomeScreen.tsx` — Integrated the parent nightly's new `ThreadListV2WorkingShelfHeader` import for the Working shelf behavior.
- `apps/mobile/src/features/home/HomeScreen.tsx` — Integrated the parent Working shelf beta preferences: workingShelfEnabled, workingShelfExpanded, and toggleWorkingShelf.
- `apps/mobile/src/features/home/HomeScreen.tsx` — Preserved the shared Settled and Snoozed shelf toggles alongside both shelf implementations.
- `apps/mobile/src/features/home/HomeScreen.tsx` — Integrated the parent Working shelf toggle dependency into the V2 row renderer callback.
- `apps/mobile/src/features/home/HomeScreen.tsx` — Integrated workingShelfEnabled into list extraData, ensuring rows refresh when upstream reorder menu availability changes.
- `apps/mobile/src/features/threads/NewTaskContextPickerScreens.tsx` — Replaced the screen-local ensureScratch/waitForProject migration path with the parent flow's first-party switchEnvironment implementation.
- `apps/mobile/src/features/threads/NewTaskContextPickerScreens.tsx` — Adopted the parent's success-aware navigation behavior, so the picker closes only when switchEnvironment reports a successful switch.
- `apps/mobile/src/features/threads/NewTaskContextPickerScreens.tsx` — Connected LegendList invalidation to flow.switchingToEnvironmentId, matching the parent's centralized switching state and existing disabled-row behavior.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Integrated upstream's cleanup removing the obsolete effect/Cause and effect/unstable/reactivity AsyncResult imports.
- `apps/mobile/src/features/threads/ThreadAgentsSheet.tsx` — Agent rows now use the parent's shared SubagentRow implementation instead of the duplicated local status/title/detail rendering.
- `apps/mobile/src/features/threads/ThreadAgentsSheet.tsx` — EnvironmentId is supplied to SubagentRow in both glass and non-glass branches.
- `apps/mobile/src/features/threads/ThreadAgentsSheet.tsx` — Elapsed-time updates remain isolated in AgentElapsed so ticking live agents do not repaint the rest of the row metadata.
- `apps/mobile/src/features/threads/ThreadAgentsSheet.tsx` — Non-glass rows adopt the parent's border and py-3.5 wrapper styling.
- `apps/mobile/src/features/threads/ThreadArrangementSheet.tsx` — Added the parent sortInboxThreadsByReturn helper for return-aware inbox ordering.
- `apps/mobile/src/features/threads/ThreadArrangementSheet.tsx` — Added threadListInboxReturns and useThreadListV2ShelfPreferences for the parent's updated Thread List V2 shelf behavior.
- `apps/mobile/src/features/threads/ThreadArrangementSheet.tsx` — Integrated parent Working-beta behavior that orders Active threads by inbox return time when `workingShelfEnabled` is enabled.
- `apps/mobile/src/features/threads/ThreadArrangementSheet.tsx` — Preserved the existing Active arrangement order when the Working shelf is disabled.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Integrated the thread-title label supplied to the voice input controller.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Replaced the captured draftMessage input with the upstream live draft snapshot reader.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Integrated subscription to composer draft atom changes so dictation observes current draft content.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — Integrated the parent nightly's Working shelf header alongside the fork-specific Stored shelf.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — Integrated the parent Working beta shelf preferences: workingShelfEnabled, workingShelfExpanded, and toggleWorkingShelf.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — The upstream Working shelf state remains available to the adjacent list ordering, move-availability, observation, and layout logic.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — Integrated workingShelfEnabled into listExtraData and its memo dependencies so thread rows refresh their upstream reorder-menu items when the Working shelf setting changes.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — Added `toggleWorkingShelf` to the render callback dependency list for the upstream Working shelf header.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — Added `workingShelfEnabled` to the callback dependency list so upstream Working shelf state changes are reflected correctly.
- `apps/mobile/src/features/threads/ThreadQueueControl.tsx` — The remove action is now an explicit accessible button with the queued-message removal label.
- `apps/mobile/src/features/threads/ThreadQueueControl.tsx` — The action respects the swipeable enabled state and exposes disabled styling.
- `apps/mobile/src/features/threads/ThreadQueueControl.tsx` — Tapping the revealed remove action closes the swipeable before removing the queued message.
- `apps/mobile/src/features/threads/ThreadQueueControl.tsx` — The parent's active-press opacity feedback is retained.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Integrated the parent's distinct `displayedModelSelection` and `reportedModelSelection` context fields, retaining its selected-versus-reported model state handling.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Added displayedModelSelection to the thread-settings session, adapted to T3 Pretty's immediately applied selected model.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Added reportedModelSelection so consumers can distinguish the configured selection from the model reported by the runtime.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Integrated the parent Working shelf into the shared label map and shelf-header kind typing with the "Working" label.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Integrated the parent's generalized map-key typing for supported shelf kinds, adapted to the fork's expanded shelf set.
- `apps/mobile/src/features/threads/thread-subagent-group.tsx` — Integrated the parent’s shared SubagentRow component refactor for rendering subagent members.
- `apps/mobile/src/features/threads/thread-subagent-group.tsx` — Adopted the parent’s reduced helper-import surface, retaining only subagentCardElapsed from the former inline row presentation helpers.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Integrated fetched turn-item details into expanded work-log rows while preserving read-tool path presentation.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Integrated foreground tool-call formatting for command execution, dynamic tools, file searches, and web searches.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Integrated failed command exit-code extraction and suppression of duplicate full-detail rendering when a formatted tool call is shown.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Integrated formatting of fetched full details for non-read tools.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Integrated fetched output rendering for searches and detailed tool results, including no-output, loading, unavailable-output, and fetch-error states.
- `apps/mobile/src/features/threads/threadListV2.ts` — Integrated the parent working shelf (beta) between pending tasks and the snoozed shelf.
- `apps/mobile/src/features/threads/threadListV2.ts` — Integrated the parent's wording covering busy work in the shared mobile ordering contract.
- `apps/mobile/src/features/threads/threadListV2.ts` — Integrated the parent Working shelf boundary calculation via `workingEnd`.
- `apps/mobile/src/features/threads/threadListV2.ts` — Integrated the parent behavior that ends the active section at `workingShelfHeaderIndex`, falling through to later shelf boundaries when Working is absent.
- `apps/mobile/src/features/threads/threadListV2.ts` — Integrated the parent working shelf into the emitted item list after active threads.
- `apps/mobile/src/features/threads/threadListV2.ts` — Integrated workingShelfHeaderIndex calculation at the correct boundary before visible working items.
- `apps/mobile/src/features/threads/threadListV2.ts` — Preserved the parent's use of visibleWorking so collapsed working shelves still retain a selected working thread.
- `apps/mobile/src/features/threads/use-thread-list-v2-shelf-preferences.ts` — Integrated the parent Working shelf beta enablement and expansion state into the hook result.
- `apps/mobile/src/features/threads/use-thread-list-v2-shelf-preferences.ts` — Integrated the parent Working shelf toggle callback while retaining the fork's Stored shelf behavior.
- `apps/mobile/src/features/voice-input/useVoiceInputController.ts` — Adopted the parent's reduced React hook imports for the provider/session-based voice-input controller.
- `apps/mobile/src/features/voice-input/useVoiceInputController.ts` — Removed obsolete controller-local AppState, Reanimated shared-value, local-transcriber, and showcase-scene imports after responsibility moved out of this controller.
- `apps/mobile/src/features/voice-input/useVoiceInputController.ts` — Accepted the parent's relocated ComposerEditorSelection import, avoiding a duplicate type import.
- `apps/mobile/src/features/voice-input/useVoiceInputController.ts` — Adopted the parent first-party global voice-input provider and session rather than retaining a fork-local VoiceInputController instance.
- `apps/mobile/src/features/voice-input/useVoiceInputController.ts` — Integrated the provider's owner-focus coordination, global availability/busy state, shared audio levels and elapsed time, and target-based draft subscription contract.
- `apps/mobile/src/features/voice-input/useVoiceInputController.ts` — Integrated the mounted-owner guard used by the surrounding parent implementation to prevent stale selection updates after unmounting or switching composers.
- `apps/mobile/src/lib/storage.test.ts` — Integrated parent coverage for persisting `threadListWorkingShelfExpanded`.
- `apps/mobile/src/lib/storage.test.ts` — Integrated parent coverage for persisting the `workingShelfEnabled` feature setting.
- `apps/mobile/src/persistence/mobile-preferences.ts` — Added the parent mobile `threadListWorkingShelfExpanded` preference alongside the fork's shelf preferences.
- `apps/mobile/src/persistence/mobile-preferences.ts` — Added the corresponding sanitizer output typing so upstream Working shelf expansion state can be retained during preference sanitization.
- `apps/mobile/src/persistence/mobile-preferences.ts` — Added validation and restoration of the parent threadListWorkingShelfExpanded mobile preference.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts` — The helper accepts the parent's optional nativeThreadHasTurns state in the parent-compatible second argument position.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.test.ts` — The existing merged turn construction can forward nativeThreadHasTurns to makeClaudeTestTurnInput, supporting upstream native-session identity behavior and tests.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — The Claude query option object is constructed once as queryOptions and passed to queryRunner.open.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — All upstream query-option fields are retained, including model selection, resume targeting, runtime cwd, attachments, settings, tools, MCP overrides, permission policy, tool/dialog callbacks, and resume_return dialog support.
- `apps/server/src/provider/RuntimeInstructions.ts` — Integrated the new watch_pull_request behavior for PR monitoring: invoke the watcher, end the turn, and avoid polling or starting a separate watcher.
- `apps/server/src/telemetry/AnalyticsService.ts` — Added the Effect Result dependency required by the parent telemetry implementation.
- `apps/server/src/telemetry/AnalyticsService.ts` — Added DeliveryState tracking for the failed batch, per-batch attempts, consecutive failures, and next retry time.
- `apps/server/src/telemetry/AnalyticsService.ts` — Integrated the parent's five-attempt batch policy and randomized exponential retry-delay calculation starting from a two-second base.
- `apps/server/src/telemetry/AnalyticsService.ts` — Reused T3 Pretty's equivalent flush interval and send timeout through the parent-facing constant names.
- `apps/server/src/telemetry/AnalyticsService.ts` — Integrated DeliveryState tracking for failed batches, per-batch attempts, consecutive failures, and the next retry time.
- `apps/server/src/telemetry/AnalyticsService.ts` — Integrated the parent flushLock that prevents background and shutdown flushes from concurrently sending the same batch.
- `apps/server/src/telemetry/AnalyticsService.ts` — Integrated the SEND_TIMEOUT abstraction around the complete telemetry request, response cleanup, and status-validation pipeline.
- `apps/server/src/telemetry/AnalyticsService.ts` — Failed telemetry batches are retained in delivery state and retried before newer buffered events.
- `apps/server/src/telemetry/AnalyticsService.ts` — Successful sends reset delivery failure, attempt, and retry timing state.
- `apps/server/src/telemetry/AnalyticsService.ts` — Failures use randomized retry-delay scheduling and stop the current flush until retryAt.
- `apps/server/src/telemetry/AnalyticsService.ts` — Batches are dropped after MAX_BATCH_ATTEMPTS, with a payload-free warning containing only event and attempt counts.
- `apps/server/src/telemetry/AnalyticsService.ts` — flushWhenDue gates retries by the delivery state's retryAt timestamp.
- `apps/server/src/telemetry/AnalyticsService.ts` — The upstream flushLock implementation serializes all flush execution.
- `apps/server/src/telemetry/AnalyticsService.ts` — Integrated the parent FLUSH_INTERVAL_MS-based periodic scheduler.
- `apps/server/src/telemetry/AnalyticsService.ts` — Integrated flushWhenDue gating so periodic ticks respect deliveryRef.retryAt instead of attempting delivery before the calculated retry delay expires.
- `apps/server/src/telemetry/AnalyticsService.ts` — Aligned the scheduler with the parent delivery-state refactor, avoiding the obsolete flushFailureCountRef-based scheduling path.
- `apps/server/src/usage/UsageService.ts` — Integrated the parent nightly's `resolveModelAliases` usage aggregation API while retaining the existing `UsageAggregator` import.
- `apps/server/src/usage/UsageService.ts` — Integrated bounded-concurrency transcript reads through `Effect.forEach` and `TRANSCRIPT_READ_CONCURRENCY` while retaining walk order.
- `apps/server/src/usage/UsageService.ts` — Integrated handling of the structured `readFileRecords` result, including parsed records and deferred cache updates.
- `apps/server/src/usage/UsageService.ts` — Integrated race-safe cache commits using `update.replaces` and `isLaterRead`, preventing a slower scan from replacing newer cached usage.
- `apps/server/src/usage/UsageService.ts` — Integrated `cacheDirty` tracking when a cache entry is committed.
- `apps/server/src/usage/usageAggregation.test.ts` — Integrated the parent's resolveModelAliases import so upstream model-alias resolution tests and behavior remain available.
- `apps/server/src/usage/usageAggregation.ts` — Added UsageCategoryCost typing required by upstream's category-level cost aggregation fields.
- `apps/server/src/usage/usageAggregation.ts` — Added the QUARTER_HOUR_MS interval used by upstream's optimized wall-clock day formatter cache.
- `apps/server/src/usage/usageAggregation.ts` — Added the parent's last-bucket cache state used by its aggregation fast path.
- `apps/server/src/usage/usageAggregation.ts` — Mapped each input record through the parent model-alias implementation before windowing, bucketing, and pricing, so aliased models aggregate under their final target.
- `apps/server/src/usage/usageAggregation.ts` — Retained the parent's deduplication flow in the updated add method.
- `apps/server/src/usage/usageAggregation.ts` — Uses the parent's integer hour-index representation instead of allocating hourly ISO timestamp strings.
- `apps/server/src/usage/usageAggregation.ts` — Uses the parent's #bucketFor helper and its last-bucket optimization rather than retaining the older inline bucket construction.
- `apps/server/src/usage/usageAggregation.ts` — Consumes UsageRecord directly, matching the parent's removal of the now-undefined #mapModel private helper.
- `apps/server/src/usage/usageAggregation.ts` — Keeps the parent's expanded MutableBucket initialization centralized in #bucketFor, including newer pricing and speed-related fields.
- `apps/server/src/usage/usageAggregation.ts` — Integrated model alias mapping, including removal of a stale provider-specific rateModel when the aliased target model's own rate should apply.
- `apps/server/src/usage/usageAggregation.ts` — Integrated the cached last-bucket fast path to avoid repeatedly constructing and hashing bucket keys for sequential records.
- `apps/server/src/usage/usageAggregation.ts` — Integrated parent bucket creation keyed by day, hour, provider, model, and source, including all cost, speed, provenance, record, and session accumulator initialization.
- `apps/server/src/usage/usageScanCache.test.ts` — Integrated the parent’s Grok tail-record and resumable scan-position round-trip coverage.
- `apps/server/src/usage/usageScanCache.test.ts` — Integrated the parent’s updated Codex gpt-6-astra fixture with ultrafast speed persisted in both the usage record and Codex scanner state.
- `apps/server/src/usage/usageScanCache.test.ts` — Extended the restored-cache assertions so the newly integrated parent fixtures are actually validated.
- `apps/server/src/usage/usageScanCache.ts` — Updated the scan-cache format to v5 for Codex service-tier/speed data.
- `apps/server/src/usage/usageScanCache.ts` — Integrated compatibility loading for speed-bearing v4 cache entries via SPEED_COMPATIBLE_SINCE_VERSION.
- `apps/server/src/usage/usageScanCache.ts` — Integrated separate v5 and legacy cache filenames so newer and older servers do not overwrite each other's cache files and v5 can migrate the legacy cache.
- `apps/server/src/usage/usageScanCache.ts` — Integrated the canonical speed-index table and runtime UsageSpeed validation for standard, fast, and ultrafast records.
- `apps/server/src/usage/usageScanCache.ts` — Adopts the parent's indexed speed/service-tier decoding and rejects records whose speed index does not map to a supported SPEEDS value.
- `apps/server/src/usage/usageScanCache.ts` — Stores the decoded speed on UsageRecord in place of the superseded boolean fast field.
- `apps/server/src/usage/usageTranscriptReader.ts` — Integrated upstream's two-phase candidate collection and concurrent filesystem stat processing.
- `apps/server/src/usage/usageTranscriptReader.ts` — Integrated the shared, fixed-size `STAT_CONCURRENCY` worker queue for faster transcript scans.
- `apps/server/src/usage/usageTranscriptReader.ts` — Preserved upstream's indexed result storage so concurrent stat completion does not reorder transcript candidates.
- `apps/server/src/usage/usageTranscripts.ts` — Claude usage records now expose the upstream UsageSpeed-compatible speed field, mapping fast mode to "fast" and all other values to "standard", instead of the legacy boolean fast field.
- `apps/web/src/components/AppSidebarLayout.tsx` — Added upstream brand-width state and the brand-aware `resolveThreadSidebarMinimumWidth` floor.
- `apps/web/src/components/AppSidebarLayout.tsx` — Applied the brand-aware minimum to both drag constraints and rendered standard-sidebar width.
- `apps/web/src/components/AppSidebarLayout.tsx` — Updated maximum-width resolution to account for the computed brand-aware minimum.
- `apps/web/src/components/AppSidebarLayout.tsx` — The resizable sidebar now uses the parent's sidebarMinimumWidth value instead of the fixed THREAD_SIDEBAR_MIN_WIDTH, layered onto the fork's resize configuration.
- `apps/web/src/components/ChatView.tsx` — Added useScratchProject and isScratchProject imports for the parent's scratch-project behavior.
- `apps/web/src/components/ChatView.tsx` — Added useAcknowledgeThreadWoke for the parent's thread-wake acknowledgement behavior.
- `apps/web/src/components/ChatView.tsx` — Integrated the parent's new keybindingValueForCommand helper import for the updated project-script keybinding behavior.
- `apps/web/src/components/ChatView.tsx` — Added the parent removeKeybinding command using serverEnvironment.removeKeybinding with local failure reporting disabled, matching the surrounding keybinding commands.
- `apps/web/src/components/ChatView.tsx` — Automatic routing now refuses to construct a scoped project reference or update the draft when the selected target has no project ID.
- `apps/web/src/components/ChatView.tsx` — Added `draftId`, `environmentId`, `envLocked`, `hasMultipleEnvironments`, `logicalProjectEnvironments`, and `onEnvironmentChange` to the effect dependencies so the upstream environment-switching keyboard behavior does not capture stale route or environment state.
- `apps/web/src/components/ChatView.tsx` — Integrated the parent's padding-left transition gating on data-panel-animations=true.
- `apps/web/src/components/ChatView.tsx` — Integrated the parent's shared --panel-animation-duration timing and ease-out curve for the header transition.
- `apps/web/src/components/ChatView.tsx` — Integrated the parent's motion-safe animation behavior rather than using the previous unconditional 200ms transition.
- `apps/web/src/components/CommandPalette.tsx` — Integrated the parent `buildCommandPaletteRows` import for the newer command-palette row-building implementation.
- `apps/web/src/components/CommandPalette.tsx` — Added the upstream LegendList result-list ref.
- `apps/web/src/components/CommandPalette.tsx` — Added upstream tracking for an intentionally cleared highlight.
- `apps/web/src/components/CommandPalette.tsx` — Added upstream clearTypedHighlight behavior so typing or entering a submenu clears the visible selection and allows the first ArrowDown to land on the first row.
- `apps/web/src/components/CommandPaletteResults.tsx` — The regular command-palette results path now reuses `CommandPaletteEmptyState`, matching the upstream refactor and the virtualized results path.
- `apps/web/src/components/CommandPaletteResults.tsx` — Empty-state messages and action-only wording remain centralized in the upstream helper.
- `apps/web/src/components/ServerUpdateAction.tsx` — Added the ServerInstallation contract type required by installation-aware server update targets.
- `apps/web/src/components/ServerUpdateAction.tsx` — Added the updateOutdatedServer state helper alongside the existing serverEnvironment API.
- `apps/web/src/components/Sidebar.logic.test.ts` — Added the parent's presentThreadShell model helper import for new sidebar thread-shell tests.
- `apps/web/src/components/Sidebar.logic.test.ts` — Added the parent's Effect DateTime import for date/time-sensitive sidebar tests.
- `apps/web/src/components/Sidebar.tsx` — Integrated the parent's SidebarSweepAction type for the standard settle, un-settle, and wake actions.
- `apps/web/src/components/Sidebar.tsx` — Integrated the parent's clearer action-oriented documentation and extended it to cover stored rows.
- `apps/web/src/components/Sidebar.tsx` — Integrated the parent behavior that hides the normal sidebar status/action slot whenever a sweep action is present.
- `apps/web/src/components/Sidebar.tsx` — Replaced the local markThreadVisited callback with the parent's useAcknowledgeThreadWoke hook, centralizing woke-thread acknowledgement behavior.
- `apps/web/src/components/Sidebar.tsx` — Integrated the parent action-sweep state and pointer-driven row-action gesture.
- `apps/web/src/components/Sidebar.tsx` — Integrated same-section sweep confinement, per-server capability checks, live key resolution, cancellation cleanup, and final settle/unsettle/unsnooze dispatch.
- `apps/web/src/components/Sidebar.tsx` — Adapted the parent sweep implementation to T3 Pretty's additional Stored section by using the fork's complete section map.
- `apps/web/src/components/Sidebar.tsx` — Integrated upstream's dependency cleanup by removing attemptSettle, since the callback now performs batch settlement through settleThreads.
- `apps/web/src/components/Sidebar.tsx` — Integrated the parent action-sweep safeguard so list descendants stop receiving pointer events during a sweep, preventing hover actions and tooltips from interfering with the gesture.
- `apps/web/src/components/Sidebar.tsx` — Adapted that safeguard to T3 Pretty's refactored thread-list container rather than the parent's legacy list location.
- `apps/web/src/components/Sidebar.tsx` — Added the parent nightly's onDraftContextMenu callback to SidebarDraftBlock so draft sessions receive the new context-menu behavior.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Integrated the parent claudeSkillInvocation helper from @t3tools/shared/toolActivity.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Retained observeVisibleAnimation through its existing import at the top of the file without introducing a duplicate import.
- `apps/web/src/components/pullRequest/PullRequestReviewAnnotation.tsx` — Adopted the parent's `Circle` and `CircleCheck` icons from `lucide` in place of the older `CircleIcon` and `CheckCircle2Icon` imports.
- `apps/web/src/components/pullRequest/PullRequestReviewAnnotation.tsx` — Integrated the parent's `MorphIcon` component used for the updated resolve/unresolve presentation.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Adopted the parent's non-interactive outer row wrapper, allowing row action buttons to remain in the same rendered row without nesting interactive controls inside the selection button.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Attached `statsRef` and `data-pull-request-stats-key` to the complete outer row and restored the corresponding parameter destructuring for the shared visibility observer.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Integrated the parent's content-visibility boundary and explicit 56.5px intrinsic block size for efficient offscreen row rendering.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Kept the parent's flexible inner selection button and outer selected/hover background handling.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Integrated the parent hunk's normalized JSX nesting and indentation for review signals, stack status, diff statistics, and metadata props.
- `apps/web/src/components/settings/settingsSearch.ts` — Integrated the parent Project order settings-search entry, including its manual, creation-time, and recent-order search terms.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Integrated the flex-wrapped, one-visible-line header container that clips the environment pill onto a second line when horizontal space is insufficient while keeping the brand focus ring inside the clip.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Integrated the exported `SidebarBrandWidthProbe` and its `ResizeObserver`-based response to font-size, zoom, titlebar inset, right padding, sidebar border, and macOS window-control sizing.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Adapted the width probe to account for the actual Pretty mark while retaining the parent's intrinsic chrome minimum by overlapping both measurements and using the wider result.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Integrated the parent's brand-rendering refactor at the conflict boundary by extracting Pretty's live brand markup into a reusable renderer.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Added the parent's SidebarBrandMark implementation using T3Wordmark, cap-height alignment, trimmed text metrics, and backdrop-aware Code label coloring.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Made the parent brand helper available to SidebarBrandWidthProbe so the parent's chrome minimum remains represented in sidebar sizing.
- `apps/web/src/components/threadSidebarWidth.test.ts` — Added coverage for resolving a measured brand width into a rounded-up sidebar minimum.
- `apps/web/src/components/threadSidebarWidth.test.ts` — Updated maximum-width coverage to exercise the parent API’s explicit minimum-width argument.
- `apps/web/src/components/threadSidebarWidth.test.ts` — Added coverage ensuring maximum width never falls below a dynamically raised minimum on narrow viewports.
- `apps/web/src/components/threadSidebarWidth.test.ts` — Added parent clamp-helper coverage for raising widths below the minimum, retaining in-range widths, and capping widths above the maximum.
- `apps/web/src/components/usage/UsagePage.tsx` — Integrated the parent callback that lets `UsageEnvironmentFilter` open the model-pricing dialog.
- `apps/web/src/components/usage/UsagePage.tsx` — Added the parent-provided onOpenModelPrices callback to UsageEnvironmentFilter and its props contract, enabling the upstream model-pricing action.
- `apps/web/src/components/usage/UsagePage.tsx` — Adopted the parent refactor that returns `Menu` directly instead of retaining the redundant fragment wrapper.
- `apps/web/src/components/usage/UsagePage.tsx` — Integrated the parent's compact `MenuTrigger` and pending-status markup layout without changing its accessible scanning text or issue-state behavior.
- `apps/web/src/components/usage/UsagePage.tsx` — Retained the parent menu flow, including environment status entries, partial-total messaging, coverage notice placement, and the Model prices action.
- `apps/web/src/diffPanelStore.test.ts` — Updated the default branch-selection test description to use the parent UI terminology “Changes” instead of “working tree changes”.
- `apps/web/src/diffPanelStore.ts` — Changed the default diff-panel selection from unstaged changes to the branch Changes view with a null base reference.
- `apps/web/src/diffPanelStore.ts` — Retained upstream's explanatory comment defining the branch scope as all checkout changes since its base.
- `apps/web/src/hooks/showThreadUndoNotice.ts` — Added upstream support for Discarded-thread undo notices.
- `apps/web/src/hooks/useThreadActions.ts` — Added the exported useAcknowledgeThreadWoke hook.
- `apps/web/src/hooks/useThreadActions.ts` — Integrated server-backed Woke acknowledgement through thread.visit at the wake timestamp for environments supporting visited tracking.
- `apps/web/src/hooks/useThreadActions.ts` — Integrated the browser-local visited-watermark fallback for older servers.
- `apps/web/src/routes/__root.tsx` — Integrated NightlyMobileBetaNotice within FirstRunGate, including for the hosted-static Hosted Nightly flow.
- `apps/web/src/state/query.ts` — EnvironmentQueryView now returns the underlying typed Effect failure through the failure field when a query fails, while continuing to expose the separately formatted error string.
- `apps/web/src/versionSkew.ts` — Added the optional `ServerInstallation` parameter and installation-aware update guidance.
- `apps/web/src/versionSkew.ts` — Added npm-global update commands with the detected installation prefix and upstream's shell-safe single-quote escaping.
- `apps/web/src/versionSkew.ts` — Added pnpm-dlx and bunx command generation while retaining npx as the default runner.
- `docs/internals/connection-runtime.md` — Documented jittered exponential backoff and its protection against synchronized reconnect storms while retaining the five-minute cap.
- `docs/internals/connection-runtime.md` — Integrated the parent behavior that foregrounding, explicit retry, and offline reports probe an established session and reconnect only after probe failure, including the loopback/offline-report rationale.
- `docs/internals/connection-runtime.md` — Integrated immediate long-background recovery attempts even when the platform reports offline, without delaying an ordinary in-flight foreground attempt.
- `docs/internals/connection-runtime.md` — Integrated the parent registry guarantees that cloud-account changes affect relay registrations only and do not discard directly paired environments.
- `docs/internals/connection-runtime.md` — Integrated platform-owned cleanup such as drafts into explicit environment removal.
- `docs/internals/connection-runtime.md` — Retained the parent's clarified package boundary: platform layers provide storage, credentials, network signals, and lifecycle events while React consumes the runtime.
- `docs/internals/glossary.md` — Added the parent's glossary scope statement and link to the architecture overview.
- `docs/internals/glossary.md` — Updated the turn definition to identify a V2 turn as a run while retaining the fork's detailed completion semantics.
- `docs/internals/glossary.md` — Added the V2 Orchestrator definition, including serialized commands and an I/O-free decision step.
- `docs/internals/glossary.md` — Documented that persisted projections are committed atomically with their events.
- `docs/internals/glossary.md` — Added outbox-effect and effect-worker concepts, including post-commit execution and command-based result feedback.
- `docs/internals/providers.md` — Documented that the parent `opencode` driver probes the installed OpenCode version and selects the 1.x or 2.x runtime.
- `docs/internals/providers.md` — Integrated the parent requirement that directory-scoped OpenCode MCP registrations must not cause threads in one directory to share a T3 MCP entry; the adjacent 1.x and 2.x bullets retain the detailed runtime-specific isolation behavior.
- `docs/user/keybindings.md` — Documented that `mod+Alt+Enter` sends while leaving the thread running in the background and opens a fresh new-thread composer.
- `docs/user/keybindings.md` — Documented that `mod+Enter` performs the same send-and-open-fresh-composer action in a new thread.
- `docs/user/keybindings.md` — Added the parent command name **Composer: Send and Start New Thread** alongside the existing configurable composer bindings.
- `docs/user/keybindings.md` — Integrated upstream documentation that `thread.undo` can reverse discarding a draft.
- `packages/client-runtime/src/connection/model.ts` — Added the optional serverUpdateRequired flag documenting when an older host orchestration protocol requires an update.
- `packages/client-runtime/src/connection/model.ts` — Extended the custom ConnectionBlockedError constructor to accept and preserve serverUpdateRequired, adapting the parent field to T3 Pretty's bounded-error implementation.
- `packages/client-runtime/src/connection/supervisor.test.ts` — Each retry delay is now tested one millisecond before expiration to prove that no connection attempt starts prematurely, followed by the final millisecond that triggers the retry.
- `packages/client-runtime/src/connection/supervisor.test.ts` — The retry delays are assigned to a reusable local constant, and the final attempt count is derived from its length instead of being hard-coded.
- `packages/client-runtime/src/connection/supervisor.ts` — Replaced the fixed retry-delay array with the parent's base-delay and maximum-delay configuration expected by the newest retry implementation.
- `packages/client-runtime/src/connection/supervisor.ts` — Adopted QUICK_CONNECTION_PROBE_TIMEOUT so the three-second probe policy can cover mobile resumes, explicit retries, and offline events rather than remaining mobile-specific.
- `packages/client-runtime/src/connection/supervisor.ts` — Integrated the parent’s exponential retry ceilings, doubling from two seconds up to five minutes.
- `packages/client-runtime/src/connection/supervisor.ts` — Integrated upper-half randomized delay distribution to prevent clients from reconnecting in lockstep.
- `packages/client-runtime/src/connection/supervisor.ts` — Integrated the exported, deterministic `retryDelayMs(failureCount, random)` API, allowing retry timing to be tested with an injected random value.
- `packages/client-runtime/src/connection/supervisor.ts` — Integrated the parent documentation clarifying that foreground, network-restoration, and explicit-retry paths bypass the persistent-failure wait.
- `packages/client-runtime/src/connection/supervisor.ts` — Adopted the parent's first-party connected-lease signal classifier, including normal disconnect termination and retry-ladder reset after a long mobile resume.
- `packages/client-runtime/src/connection/supervisor.ts` — Adopted immediate session replacement for application-active-reconnect, avoiding a probe that could remain in a prolonged Resuming state after mobile suspension.
- `packages/client-runtime/src/connection/supervisor.ts` — Adopted the parent's signal-specific probe timeout policy: quick probes for explicit retries, offline reports, and application-active-probe; the standard timeout for application-active; and no probe for unrelated signals.
- `packages/client-runtime/src/connection/supervisor.ts` — Adopted the parent's policy of probing ordinary wakeups, retries, and offline reports before replacing a potentially healthy socket.
- `packages/client-runtime/src/connection/supervisor.ts` — When a connected-session probe consumes an explicit RetryRequested signal, resetRetryState is set to false so that retry does not also reset the backoff for a later unrelated failure.
- `packages/client-runtime/src/connection/supervisor.ts` — Signal consumption now uses the parent's takeSignal helper inside the concurrent event race, preserving the upstream fix that an explicit RetryRequested signal clears resetRetryState so it cannot reset a later unrelated failure's backoff.
- `packages/client-runtime/src/connection/supervisor.ts` — The parent's bounded health-check intent remains represented by the independently forked, timeout-bounded startProbe operation; unlike the sequential parent loop, unrelated monitor events do not recreate or extend that timeout.
- `packages/client-runtime/src/connection/supervisor.ts` — The parent's prompt handling of disconnect, retry, offline, credential-change, and wake signals during a probe is composed into the fork supervisor through the common MonitorEvent race and post-race authoritative intent checks.
- `packages/client-runtime/src/connection/supervisor.ts` — Replaced fork-specific wake-recovery flag consumption with the parent's generalized `probeUnanswered`/`failedProbe` implementation.
- `packages/client-runtime/src/connection/supervisor.ts` — Integrated immediate recovery when a probe is unanswered after application activation, an explicit retry request, or a network change.
- `packages/client-runtime/src/connection/supervisor.ts` — Adopted the parent's first-party retry jitter implementation by passing `Random.next` to `retryDelayMs`.
- `packages/client-runtime/src/state/projectCommands.test.ts` — Integrated the upstream openScratch test proving the command waits until the newly created scratch project reaches the client atom store before resolving.
- `packages/client-runtime/src/state/projectCommands.test.ts` — Integrated the upstream EnvironmentSupervisor/RPC/Crypto test harness, scoped AtomRegistry cleanup, and projectAtom dependency-injection API.
- `packages/client-runtime/src/state/projectCommands.test.ts` — Adapted the existing idle-TTL test to supply a projectAtom implementation required by the upstream createProjectEnvironmentAtoms API.
- `packages/contracts/src/environment.ts` — Added the optional `usageModelAliases` capability indicating that the server persists model mappings and folds mapped usage into the target model.
- `packages/contracts/src/orchestrationV2.ts` — Added `nativeMetadata.modelSelection` so provider-reported model choices can be displayed independently of the app thread's saved preferences.
- `packages/contracts/src/usage.ts` — Added optional `categoryCostUsd` token-category cost breakdowns for compatible handling of older servers and unsplittable costs.
- `packages/contracts/src/usage.ts` — Added optional `fastCostUsd` and `ultrafastCostUsd` fields for speed-tier request costs.
- `packages/contracts/src/usage.ts` — Added optional `speedPremiumUsd` for the amount paid above standard request rates.
- `packages/contracts/src/usage.ts` — Preserved the upstream field documentation and optional wire-contract semantics.
- `scripts/notify-discord-release.test.ts` — Integrated the parent `notifyDiscordReleaseCommand` import required by the newly added CLI test setup (`runCli`).
- `scripts/notify-discord-release.test.ts` — Tests aggregate Discord embed limits when large release metadata accompanies long notes.
- `scripts/notify-discord-release.test.ts` — Tests splitting oversized lines, words, and Unicode without data loss, malformed Unicode, or Discord limit violations.
- `scripts/notify-discord-release.test.ts` — Tests the exact 4096-character description boundary and splitting of the next character.
- `scripts/notify-discord-release.test.ts` — Tests suppression of everyone, here, user, and role mentions across every generated message while allowing only the configured release role in the first message.
- `scripts/notify-discord-release.test.ts` — Tests that the secret token is absent from Effect cause rendering and captured structured logs.
- `scripts/notify-discord-release.test.ts` — Uses the parent’s consolidated safe-request-context Effect test structure and completion style.
- `scripts/notify-discord-release.test.ts` — Added the workflowRun helper that executes checked-in release workflow shell commands through stubbed gh/node commands and feeds captured arguments to the real CLI parser.
- `scripts/notify-discord-release.test.ts` — Added end-to-end coverage for publishing long nightly release notes as ordered Discord sends, preserving mention restrictions and literal shell-like text without execution.
- `scripts/notify-discord-release.test.ts` — Added workflow fallback coverage for stable channels, failed or partial release-note retrieval, prerelease conditions, repository/tag environment wiring, preview-channel exclusion, and latest-release note-file handling.
- `scripts/notify-discord-release.test.ts` — Added CLI coverage for omitted nightly notes, ignored note files for latest releases, unreadable nightly notes files, stopping after a failed continuation send, and invalid webhook configuration redaction.
- `scripts/notify-discord-release.ts` — Integrated redacted loading of DISCORD_WEBHOOK_URL so the webhook credential is treated as sensitive configuration.
- `scripts/notify-discord-release.ts` — Integrated explicit URL parsing and the typed DiscordReleaseWebhookConfigurationError for invalid webhook configuration.
- `scripts/notify-discord-release.ts` — Integrated suppression of unintended Discord @everyone, @here, user, and role mentions in release-supplied text.
- `scripts/notify-discord-release.ts` — Integrated Markdown escaping and compaction of generated GitHub pull-request entries, contributor profile links, and Full Changelog links.
- `scripts/notify-discord-release.ts` — Integrated Discord embed-description chunking that prefers line and word boundaries and avoids splitting UTF-16 surrogate pairs.
- `scripts/notify-discord-release.ts` — Integrated the parent's release-announcement behavior while adapting only its product name to T3 Pretty branding.
- `scripts/notify-discord-release.ts` — Replaced the fork-local webhook timeout mechanism with the parent's first-party one-minute timeout around the complete request and retry pipeline, preserving Retry-After handling.
- `scripts/notify-discord-release.ts` — Integrated the parent's request-error sanitization, which records only the HTTP or Effect error discriminator and cannot retain a webhook URL token.
- `scripts/notify-discord-release.ts` — Integrated the parent's response-error sanitization by omitting the underlying filter error cause entirely.

## Parent changes intentionally omitted

- `AGENTS.md` — Split a request only when the maintainer asks.. Reason: This directly conflicts with T3 Pretty's authoritative rule to split PRs whenever a request or description contains multiple concerns, indicated by wording such as “also.” Only this conflicting restriction was omitted.
- `apps/mobile/src/App.tsx` — Remove `View` from the `react-native` import.. Reason: T3 Pretty's retained mobile layout still requires `View`; removing it would regress fork-specific presentation code.
- `apps/mobile/src/features/threads/ThreadAgentsSheet.tsx` — Replace the locally rendered subagent row with the newly extracted parent SubagentRow component and remove its direct rendering dependencies from ThreadAgentsSheet.. Reason: The conflict context's rendered body still uses T3 Pretty's enhanced AgentRow, including glass grouping, GlassRowPressable presentation, and the sheet-specific onOpen flow. Switching only to the parent component/import would either fail to compile or discard those fork-specific presentation and navigation extensions; safely adapting the extracted component would require changes to SubagentRow.tsx that are not present in the supplied conflict.
- `apps/mobile/src/features/threads/ThreadAgentsSheet.tsx` — The parent's unconditional `border-b border-border py-3.5` wrapper styling for every agent row is not applied to glass rows.. Reason: T3 Pretty's frosted GroupedCard design requires compact py-3 spacing, horizontal inset padding, and a subtle divider only between rows.
- `apps/mobile/src/features/threads/ThreadAgentsSheet.tsx` — The parent's text-xs elapsed-time size is not applied to glass rows.. Reason: T3 Pretty's existing frosted sheet design uses the more compact text-2xs timer; the upstream text-xs size remains in use for non-glass rows.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Use composerDraftKey as the voice controller's ownerKey.. Reason: T3 Pretty deliberately separates the stable composer/dictation owner from the currently open queued-message draft. Adopting the parent owner-key change would alter fork-specific dictation and settings ownership; the upstream live draft behavior is instead preserved through readDraftMessage and subscribeToDraftChanges.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Upstream's pendingModel override and temporary suppression of reportedModelSelection while a model selection is pending.. Reason: T3 Pretty's picker applies model choices immediately and the surrounding provider has no pending-model selection lifecycle. Referencing upstream's pendingModel here would be incoherent and could regress the fork's instant-apply behavior; the settled selected/reported model behavior is still integrated.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Pass displayedModelSelection and reportedModelSelection to getProviderOptionCurrentLabel in the legacy select-option DisclosureRow renderer.. Reason: T3 Pretty replaced that legacy animated DisclosureRow/submenu renderer with its authoritative ThreadSettingsControlStack and no longer calls getProviderOptionCurrentLabel at this boundary. Restoring the parent renderer would duplicate and regress the fork's rebuilt one-screen card-based picker; adding unsupported selection props to the fork-only stack would be speculative.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Update `ThreadSettingsChoiceContent` to pass `displayedModelSelection` and `reportedModelSelection` into `getProviderOptionCurrentValue` when determining the selected provider option.. Reason: T3 Pretty intentionally removed the compact pushed choice page as part of its one-screen model-picker rebuild. Restoring that obsolete component would regress the fork's navigation and picker architecture, and there is no remaining call at this conflict boundary to which the parent API update can be applied.
- `apps/server/src/telemetry/AnalyticsService.ts` — The parent's five-minute maximum retry-backoff ceiling (`RETRY_MAX_DELAY_MS = 300_000`).. Reason: It conflicts with T3 Pretty's existing 60-second telemetry retry ceiling. The parent's backoff and jitter behavior is retained, but its maximum is bound to the authoritative fork limit.
- `apps/server/src/telemetry/AnalyticsService.ts` — Use telemetryConfig.flushBatchSize directly when taking a batch.. Reason: T3 Pretty already validates and bounds this setting as flushBatchSize; using the raw value would bypass its configuration safeguard.
- `apps/server/src/telemetry/AnalyticsService.ts` — Include sent.failure as cause metadata in retry and dropped-batch logs.. Reason: HTTP errors may retain request data, including telemetry properties and the PostHog key. T3 Pretty intentionally keeps best-effort telemetry diagnostics payload-free.
- `apps/server/src/usage/usageAggregation.ts` — Perform global raw-key deduplication before hourly/day window validation.. Reason: That behavior conflicts with T3 Pretty's reliability hardening: it lets out-of-window records consume dedupe state, is not provider-scoped, duplicates the bounded dedupe pass, and can suppress a valid in-window record.
- `apps/web/src/components/AppSidebarLayout.tsx` — Remove the direct THREAD_SIDEBAR_MIN_WIDTH import from AppSidebarLayout.. Reason: T3 Pretty's fork-specific sidebar sizing behavior still depends on the explicit minimum-width constant; removing it would regress that behavior.
- `apps/web/src/components/AppSidebarLayout.tsx` — The upstream `useSyncExternalStore` viewport subscription and render-time viewport snapshot.. Reason: T3 Pretty already resolves drag limits from the live `window.innerWidth` and uses a viewport-responsive CSS width, preserving the same live-clamping behavior without app-wide rerenders or stale render-time caps.
- `apps/web/src/components/AppSidebarLayout.tsx` — The upstream numeric `clampThreadSidebarWidth` assignment for the sidebar CSS variable.. Reason: Using that render-time pixel value would replace T3 Pretty's live CSS resizing and Tesla-specific width behavior. The upstream brand minimum is instead composed around Pretty's responsive CSS width, while maximum drag bounds are evaluated against the live viewport.
- `apps/web/src/components/ChatView.tsx` — The inherited useThreadActions name from the upstream import hunk was not restored.. Reason: OURS explicitly deleted the pre-existing useThreadActions import. The parent's new addition, useAcknowledgeThreadWoke, is integrated independently, preserving both edits without reintroducing the legacy dependency.
- `apps/web/src/components/ChatView.tsx` — Parent changed the headline wrapper spacing from pb-8/pb-4 to pb-4/pb-0.. Reason: T3 Pretty intentionally removed this wrapper padding as part of its custom home headline and suggestion-shelf visual layout. Reintroducing pb-4 would regress the fork-authoritative design; the parent's conditional pb-0 adds no behavior beyond the fork's existing zero padding.
- `apps/web/src/components/Sidebar.tsx` — Pass the parent action-sweep state through sweepAction on each row at this search-results call site.. Reason: This call site now renders the fork's specialized SidebarSearchResultRow rather than the regular section-aware thread row targeted by the parent hunk. Search results do not receive the settlement/drag action API that sweepAction accompanies; the surrounding list already suppresses pointer interactions while a sweep is active.
- `apps/web/src/components/Sidebar.tsx` — Allow starting a parent action sweep from this search-results call site via onActionSweepStart.. Reason: SidebarSearchResultRow uses search selection/navigation callbacks and has no section action control from which to start a settlement sweep. Adding the regular-row callback set would regress the fork's specialized search-result API and likely violate its component props.
- `apps/web/src/components/Sidebar.tsx` — Restore the parent/base regular-row props for variants, settlement, snoozing, pinning, dragging, renaming, context menus, and change-request snapshots on search results.. Reason: Those props belong to the former regular thread-row rendering path and were intentionally replaced by T3 Pretty's dedicated search-result component. Restoring them would conflict with that component's behavior and introduce duplicate props already visible in the surrounding call.
- `apps/web/src/components/chat/MessagesTimeline.logic.ts` — Reuse an existing working row, or synthesize one, so a running or completed pre-handoff setup card occupies a parent-defined working slot beneath that header.. Reason: This directly conflicts with T3 Pretty's intentional presentation in which the setup card itself replaces working and thinking placeholders until handoff.
- `apps/web/src/components/chat/MessagesTimeline.logic.ts` — Continue through the generic activity-tail and final timeline-decoration pipeline while setup still owns the pre-handoff state.. Reason: T3 Pretty intentionally returns after attaching trailing tool groups so generic live activity rows cannot appear prematurely during worktree preparation.
- `apps/web/src/components/pullRequest/PullRequestReviewAnnotation.tsx` — The parent's retained `HammerIcon` import and corresponding generic hammer-button presentation were not restored.. Reason: T3 Pretty intentionally replaced that path with `FixFindingButton`; retaining `HammerIcon` would regress the fork-specific finding workflow or leave an unused import.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — The parent retains ProviderEnvironmentSection and changes its sensitive-state lock toggle from conditional LockIcon/LockOpenIcon rendering to MorphIcon with LockGlyph/LockOpen.. Reason: T3 Pretty intentionally deleted this legacy editor. Restoring the deleted component solely to apply its icon refactor would regress the fork's provider-settings architecture and duplicate the replacement field-based controls.
- `apps/web/src/components/settings/settingsSearch.ts` — The parent hunk's retained basic snooze-limited-threads search record at this position.. Reason: A richer snooze-limited-threads record already exists immediately below with the same destination and additional search terms. Retaining both would create duplicate search results; the upstream snooze setting remains represented.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Displaying the parent's `SidebarBrandMark`/T3 Code wordmark in the live sidebar brand link.. Reason: T3 Pretty branding and identity are authoritative. The parent mark remains available to the invisible width probe as a minimum-size baseline, but the user-visible chrome must render the Pretty mark and wordmark.
- `apps/web/src/components/threadSidebarWidth.test.ts` — The parent test fixtures that treat 238px as a valid raised sidebar minimum, including the exact 237.2px-to-238px expectation.. Reason: T3 Pretty’s branded sidebar has an authoritative 256px base minimum. The parent’s dynamic minimum and rounding behavior is retained using measurements above that fork-specific minimum instead.
- `apps/web/src/index.css` — The parent’s 1.5rem default for --workspace-titlebar-scroll-fade-height.. Reason: It conflicts with T3 Pretty’s explicit 2.5rem clearance for keeping at-rest messages below the header.
- `apps/web/src/index.css` — The parent’s --chat-content-max-width: 46rem declaration.. Reason: OURS deliberately removed this root content-width cap; restoring it would alter T3 Pretty’s authoritative chat layout.
- `apps/web/src/index.css` — The parent’s reduction of --thread-details-panel-width from 19.5rem to 17.5rem, including restoration of that root fixed-width token.. Reason: OURS removed the fixed thread-details width entirely. Reintroducing the parent’s narrower value would regress T3 Pretty’s custom panel layout rather than compose with it.
- `apps/web/src/state/query.ts` — The parent representation sets dataUpdatedAt to a previous success timestamp on failure and to the numeric sentinel 0 when no timestamp exists.. Reason: T3 Pretty's authoritative query-view contract uses null when the current result is not successful; adopting the parent fallback would restore stale/sentinel timestamp behavior that OURS explicitly replaced.
- `docs/internals/connection-runtime.md` — Unconditionally replace an established mobile session on a long-background wakeup without allowing a concurrent probe to preserve a healthy lease.. Reason: T3 Pretty already has a stronger fork-specific make-before-break implementation: it starts the replacement immediately, including while reported offline, but concurrently probes the existing lease. A healthy probe cancels unnecessary replacement, while a dead lease still swaps as soon as the replacement is ready without waiting for probe timeout. Unconditional replacement would regress that established fork behavior.
- `docs/user/keybindings.md` — The parent documentation says a **Follow-up behavior** setting selects Queue or Steer and that the send button uses that configured follow-up behavior.. Reason: T3 Pretty intentionally defaults running-thread messages to steering and exposes automatic queuing through the Legacy features → Queue messages setting. Adopting the parent's setting model would regress the fork's authoritative steering-first behavior.
- `packages/client-runtime/src/connection/supervisor.test.ts` — Upstream's exact 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, and 300s retry-rung expectations, including its additional pre-cap iteration.. Reason: Those timings conflict with T3 Pretty's established reconnect behavior: a 3-second jitterable first rung and its 60s/120s progression to the five-minute cap. The compatible upstream timing-boundary assertions were applied to Pretty's schedule instead.
- `packages/client-runtime/src/connection/supervisor.ts` — Use a 1,000-millisecond retry base delay.. Reason: This would weaken T3 Pretty's relay Worker request throttling by retrying failed environments sooner; the parent retry configuration is retained with T3 Pretty's authoritative 3,000-millisecond starting delay.
- `packages/client-runtime/src/connection/supervisor.ts` — Rename the recovery flag to probeUnanswered and broaden it so it is set during any live-session probe and retained when that probe closes, fails, or times out before answering.. Reason: This would weaken T3 Pretty's deliberate reconnect gating by allowing non-foreground or otherwise generic probe failures to skip backoff, potentially restoring the reconnect and relay Worker chatter that the fork specifically hardened against. The fork instead requires an active foreground wake and an unsuccessful replacement lease.
- `packages/client-runtime/src/connection/supervisor.ts` — Replace the concurrent active-lease monitor with the parent's sequential takeSignal/connectedLeaseEnd nested probe loop and boolean reset return protocol.. Reason: That control-flow replacement would remove T3 Pretty's concurrent session-closure detection, DPoP refresh and expiry handling, authorization retries, probe/replacement head-start race, lease-loss publication, and scoped replacement cleanup. The compatible signal-state fix was integrated through takeSignal without regressing those fork behaviors.
- `packages/client-runtime/src/connection/supervisor.ts` — Shorten an already-running foreground probe's deadline when a later signal requests a shorter probe timeout using the parent's mutable monotonic deadline loop.. Reason: The parent implementation depends on owning the probe inside a sequential nested loop, while T3 Pretty owns the timeout in an independently forked probe and concurrently supervises replacement and authorization events. Transplanting this hunk would require replacing or materially redesigning the fork supervisor and could reintroduce duplicate probe/relay activity; the existing probe remains bounded by its fixed timeout.
- `packages/client-runtime/src/connection/supervisor.ts` — Use the parent's probeUnanswered bookkeeping and direct ConnectionTransientError return path for probe timeout.. Reason: T3 Pretty's supervisor records failed wake recovery through wakeRecoveryFailed/giveUp and attaches the active attempt span before propagating the failure. Replacing that accounting would weaken the fork's no-backoff wake recovery and tracing behavior.
- `.github/workflows/ci.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned
- `.github/workflows/release.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned

## Completed content-hash overlays

- `apps/web/src/components/Sidebar.logic.test.ts` — applied a completed cache entry keyed by the current file contents
- `apps/web/src/components/ChatView.tsx` — applied a completed cache entry keyed by the current file contents
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — applied a completed cache entry keyed by the current file contents
- `apps/web/src/components/Sidebar.tsx` — applied a completed cache entry keyed by the current file contents
- `shared-typecheck` failed after merging `v0.0.46-nightly.20261004.2657`; repaired with `gpt-5.6-sol`: Updated both relay-discovery test fixtures for the new catalog-refresh service member and restored the missing typed supervisor helpers. The supervisor now uses the merged timeout name, the new randomized retry API, and T3 Pretty's wake-recovery state consistently.
  - edited `packages/client-runtime/src/connection/outdatedHostUpdate.test.ts`
  - edited `packages/client-runtime/src/connection/supervisor.ts`
- `mobile-typecheck` failed after merging `v0.0.46-nightly.20261004.2657`; repaired with `gpt-5.6-sol`: Import the parent’s shared SubagentRow component while preserving T3 Pretty’s glass card and pressable behavior.
  - edited `apps/mobile/src/features/threads/ThreadAgentsSheet.tsx`

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.46-nightly.20261005.2689`
- Previously integrated parent nightly: `v0.0.46-nightly.20261004.2657`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `pnpm-lock.yaml` — fork-only dependency entries are re-derived by lockfile regeneration against the merged package manifests
- `apps/desktop/src/app/DesktopApp.ts` — T3 Pretty's conditional startup path for disabled local environments, including opening the window for remote/SSH use without requiring a local backend.
- `apps/desktop/src/app/DesktopApp.ts` — T3 Pretty's packaged-app behavior that serves the client from disk and avoids installing a backend proxy to a closed or dead local port.
- `apps/desktop/src/app/DesktopApp.ts` — T3 Pretty's backend-aware protocol registration for enabled local environments, including server-exposure configuration and the resolved backend endpoint.
- `apps/desktop/src/app/DesktopApp.ts` — T3 Pretty's branch-specific IPC-handler and snapshot initialization, avoiding premature or duplicate setup.
- `apps/desktop/src/app/DesktopApp.ts` — All desktop backend pool instances, including secondary/WSL backends, are explicitly stopped before the layer-scope cascade so they receive graceful termination rather than an OS hard kill.
- `apps/desktop/src/app/DesktopApp.ts` — Backend shutdowns remain concurrent under DESKTOP_SHUTDOWN_BACKEND_CONCURRENCY.
- `apps/desktop/src/app/DesktopApp.ts` — Desktop shutdown completion remains guaranteed through shutdown.markComplete even if backend or renderer-history cleanup fails.
- `apps/desktop/src/preload.ts` — The preload continues caching the seeded window active state before React/AppSidebarLayout subscribes, preventing loss of early did-finish-load state and preserving T3 Pretty's desktop sidebar/window behavior.
- `apps/desktop/src/telemetry/DesktopTelemetryPublisher.test.ts` — Retained DESKTOP_ELECTRON_PROCESS_MAX_COUNT for T3 Pretty's desktop telemetry process-count safeguards and associated test coverage.
- `apps/desktop/src/telemetry/DesktopTelemetryPublisher.test.ts` — The demanded telemetry snapshot remains capped at DESKTOP_ELECTRON_PROCESS_MAX_COUNT Electron processes.
- `apps/desktop/src/telemetry/DesktopTelemetryPublisher.test.ts` — The test continues to require electronProcessesTruncated to be present and true when the process sample exceeds the cap, protecting desktop telemetry reliability and payload safeguards.
- `apps/desktop/src/telemetry/DesktopTelemetryPublisher.ts` — Preserved T3 Pretty's DESKTOP_ELECTRON_PROCESS_MAX_COUNT cap, preventing oversized Electron process telemetry payloads.
- `apps/desktop/src/telemetry/DesktopTelemetryPublisher.ts` — Preserved the electronProcessesTruncated indicator when demanded process metrics exceed the configured cap.
- `apps/desktop/src/telemetry/DesktopTelemetryPublisher.ts` — Preserved the existing per-process normalization and name-length limits after selecting the bounded metric set.
- `apps/mobile/src/connection/onboarding.ts` — The 30-second mobile pairing deadline remains enforced and still reports a network-class transient error on timeout.
- `apps/mobile/src/connection/onboarding.ts` — Pairing-attempt generation checks remain before and after registry mutation, preventing invalidated or stale onboarding attempts from completing normally.
- `apps/mobile/src/connection/onboarding.ts` — T3 Pretty's explicit prepare-then-register flow and failure propagation remain intact.
- `apps/mobile/src/connection/platform.ts` — Application-active connection wakeups remain gated on a recorded background stint, preventing inactive→active UI interruptions such as Control Center, notification shade, or permission sheets from causing unnecessary probes or reconnects.
- `apps/mobile/src/connection/platform.ts` — Managed relay account changes continue to emit credentials-changed wakeups for T3 Pretty's Surge Connect flow.
- `apps/mobile/src/connection/platform.ts` — Environment-owned thread outbox and composer draft cleanup continues to use T3 Pretty's per-resource timeout and warning-based failure isolation.
- `apps/mobile/src/connection/platform.ts` — The new cleanup operation also uses T3 Pretty's mobile cleanup safeguards, preventing one synchronous composer-error cleanup failure from disrupting the overall environment cleanup.
- `apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx` — Preserved T3 Pretty's connection-completion safeguards: navigation occurs only while the screen is mounted and focused, the attempt generation is still current, and the active pairing URL still matches.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — Preserved T3 Pretty's PendingSecretRequestCard import, which supports the fork's secure provider/API-key request flow.
- `apps/server/src/mcp/PreviewAutomationBroker.ts` — Preserved the Pretty client connection key keyed by both environment ID and client ID, which is required for correctly scoped preview eviction and connection removal.
- `apps/server/src/mcp/PreviewAutomationBroker.ts` — Preserved collision-safe JSON tuple encoding for preview client and host assignment identities.
- `apps/server/src/mcp/toolkits/preview/handlers.ts` — Preview invocations continue to use T3 Pretty's centralized `requirePreviewCapability()` authorization path, preserving the fork's shared capability-authorization behavior.
- `apps/server/src/orchestration-v2/Orchestrator.control-reads.test.ts` — Preserved the T3 Pretty V2 stored-shelf test, including store clearing pinned state and propagating storedAt to the thread shell.
- `apps/server/src/orchestration-v2/Orchestrator.control-reads.test.ts` — Preserved unstore behavior that restores active/unsettled state.
- `apps/server/src/orchestration-v2/Orchestrator.control-reads.test.ts` — Preserved World Scenery assignment semantics across repeated photos from the same set and replacement from a different photo set.
- `apps/server/src/orchestration-v2/Orchestrator.control-reads.test.ts` — Preserved fork-specific enabled-skill deduplication and subagent-policy projection coverage.
- `apps/server/src/orchestration-v2/Orchestrator.control-reads.test.ts` — Preserved the safeguard that pending user input prevents a thread from being stored.
- `apps/server/src/orchestration-v2/legacy/LegacyV1ThreadImporter.ts` — Preserved the T3 Pretty import of deriveProviderThread used by legacy native-session/provider-thread migration behavior.
- `apps/server/src/provider/providerMaintenanceCommandCoordinator.ts` — Per-target duplicate maintenance commands are still rejected immediately through the fork-supplied makeAlreadyRunningError behavior.
- `apps/server/src/provider/providerMaintenanceCommandCoordinator.ts` — The optional queued notification still runs before waiting on or executing the keyed command lock.
- `apps/server/src/provider/providerMaintenanceCommandCoordinator.ts` — Acquired target state is still released on success, failure, or interruption through Effect.ensuring.
- `apps/server/src/provider/providerMaintenanceCommandCoordinator.ts` — Maintenance commands remain serialized by lockKey while independently tracking active targetKey values.
- `apps/server/src/server.ts` — Preserved T3 Pretty's opt-in redacted agent monitoring integration through the AgentMonitoring import.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Preserved useLocation for T3 Pretty’s location-aware connections settings behavior.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Preserved connectionStatusTitle alongside connectionStatusText for the fork’s richer connection-state presentation.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Preserved managedRelaySessionAtom used by T3 Pretty’s managed relay integration.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Preserved SURGE_CODE_ACCOUNT_NAME and SURGE_CONNECT_NAME so Surge Connect retains its fork-specific identity and branding.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Preserved T3 Pretty's `environmentCatalog.retryNow` command binding, including local failure handling via `reportFailure: false`, so saved remote environments retain the fork's retry behavior.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Preserved T3 Pretty's fork-specific add-backend/T3 Connect state shape by not restoring the removed legacy remote-mode, host, and pairing-code state declarations.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Manual saved-backend submission continues to parse a DesktopSshEnvironmentTarget and connect through connectSshEnvironment via connectSavedBackendSshTarget rather than invoking the unrelated pairing-code flow.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Desktop SSH parse failures continue to use formatDesktopSshConnectionError and the fork's inline error UX.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — SSH-specific field cleanup, dialog closure, tunnel-oriented success messaging, and desktop SSH route handling remain centralized in connectSavedBackendSshTarget.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Route additions retain the fork's environment-identity safeguard and SSH-specific presentation.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Preserved T3 Pretty's deliberate removal of the legacy connection-mode card, manual remote fields, and remote-mode body from ConnectionsSettings.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Avoided reintroducing an obsolete connection UI path that could conflict with the fork's current T3 Connect and saved-environment architecture.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Manual environment creation remains available only through the desktop bridge because it is an SSH flow; non-desktop surfaces continue to use Surge Connect.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — The Environments header action remains hidden when there are neither server update targets nor a desktop bridge.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — T3 Pretty's subdued ghost styling for the server-updates action is retained.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Manual environment creation remains limited to the desktop bridge and uses the fork's SSH-managed tunnel form.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — The generic manual remote-link option is not restored, preserving T3 Pretty's design that non-SSH environment connections flow through Surge Connect.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — The fork-specific add-environment description and simplified direct SSH presentation remain intact for ordinary additions.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — T3 Pretty's responsive master-detail Environments layout, including its styled environment selector and detail panel.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Primary-environment selection and inline rendering of the fork's primary connection settings.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Environment machine icons, connection-state indicators, Surge Connect labeling, disabled-state styling, and accessible selection semantics.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Working-aware duplicate saved-environment filtering and the control for revealing or hiding duplicate saved environments.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — The desktop-only SSH/manual-environment boundary: route creation is exposed only when the desktop bridge and its route dialog are available.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Existing saved-environment enable, remove, and removal-progress behavior.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — T3 Pretty's provider-definition-driven environment field flow remains authoritative, including the adjacent ProviderEnvironmentFieldRow implementation and its field-specific labels, descriptions, sensitivity handling, redacted-secret replacement behavior, and clear action.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — The removed legacy arbitrary-variable editor is not reintroduced alongside the fork's newer environment helpers and UI.
- `apps/web/src/connection/platform.ts` — Preserved T3 Pretty's runtime-capable EnvironmentId import, avoiding regression of fork code that uses the contracts export as a value.
- `docs/user/source-control.md` — The expanded pull-request discovery, background detection, readiness grouping, sorting, filtering, search, scope, and persisted-filter behavior remains intact.
- `docs/user/source-control.md` — T3 Pretty's native iPhone and iPad pull-request manager and routing from thread Git controls and conversation links are preserved.
- `docs/user/source-control.md` — Compact right-panel review tabs and in-app handling of Origin pull requests at cursor.com/codebase are preserved.
- `docs/user/source-control.md` — The remembered review/thread file-tree toggle and proactive-panel behavior are preserved.
- `docs/user/source-control.md` — T3 Pretty's merge-commit line-count handling, browser fallback, platform-specific command-click behavior, and local branch checkout guidance are preserved.
- `packages/client-runtime/src/authorization/service.ts` — Preserved the original cached DPoP ticket error when relay bootstrap fails, so a relay outage does not mask a retryable endpoint error.
- `packages/client-runtime/src/authorization/service.ts` — Preserved cached DPoP tokens when bootstrap confirms that the relay endpoint has not changed.
- `packages/client-runtime/src/authorization/service.ts` — Preserved T3 Pretty's endpoint-relocation recovery, including refreshing the rejected token with the newly obtained bootstrap only when the relay host actually moved.
- `packages/client-runtime/src/authorization/service.ts` — Preserved authentication-specific token renewal and session identity checks.
- `packages/client-runtime/src/connection/catalog.ts` — Bearer connection profile HTTP and WebSocket base URLs continue using T3 Pretty's ConnectionUrl schema instead of being weakened to unvalidated strings.
- `packages/client-runtime/src/connection/supervisor.test.ts` — Preserved the T3 Pretty test harness's `randomRoll` option for deterministic control of retry jitter and reconnect timing tests.
- `packages/client-runtime/src/connection/supervisor.ts` — The bounded 64-entry supervisor signal buffer remains in place, preserving backpressure and preventing disconnect/control signals from being dropped during bursts.
- `packages/client-runtime/src/connection/supervisor.ts` — Quiet replacement lease establishment continues to suppress progress reporting, preventing it from mutating the published prepared connection or visible connection state while the existing lease remains active.
- `packages/client-runtime/src/connection/supervisor.ts` — The concurrent MonitorEvent race across supervisor signals, transport closure, DPoP refresh and expiry, authorization retry, probe completion, replacement timing, and replacement completion remains intact.
- `packages/client-runtime/src/connection/supervisor.ts` — Authoritative intent and retry-state refs are rechecked after every raced event so simultaneous disconnect, offline, or retry signals cannot be silently consumed.
- `packages/client-runtime/src/connection/supervisor.ts` — T3 Pretty's continuous periodic better-route checks remain active, including checks for routes learned while already connected.
- `packages/client-runtime/src/connection/supervisor.ts` — Existing probe, replacement, authorization-refresh, lease-loss, and reconnect behavior remains under the fork's event-driven state machine rather than being regressed to the parent's older linear signal loop.
- `packages/client-runtime/src/connection/supervisor.ts` — The replacement-connection lifecycle remains coordinated with active probes, including stopping probes and authorization retry timers after a successful replacement.
- `packages/client-runtime/src/connection/supervisor.ts` — Failed replacement scopes are explicitly closed, preventing connection-scope leaks.
- `packages/client-runtime/src/connection/supervisor.ts` — A failed replacement waits for an in-flight probe to determine whether the existing lease remains usable.
- `packages/client-runtime/src/connection/supervisor.ts` — DPoP authorization replacement failures keep a viable active connection and schedule a backoff retry for transient failures, while blocked or unclassified failures remain fatal.
- `packages/client-runtime/src/connection/supervisor.ts` — Lease-loss handling and the fork’s reconnect-without-dead-time behavior remain intact.
- `packages/client-runtime/src/connection/supervisor.ts` — Pretty's connected-lease replacement flow remains intact, including reusable lease publication for fresh generations and attempts.
- `packages/client-runtime/src/connection/supervisor.ts` — Lease publication continues to read the current network intent rather than a stale pre-establishment snapshot, protecting reconnect and replacement correctness.
- `packages/client-runtime/src/connection/supervisor.ts` — Pretty's established/current lease naming and lifecycle structure are retained, including later stability timing and old-transport release behavior.
- `packages/contracts/src/server.ts` — Retained the T3 Pretty safeguard limiting advertised SSH remote-open targets to REMOTE_OPEN_TARGET_MAX_COUNT while continuing to tolerate forward-compatible target entries.

## Parent changes integrated at conflict boundaries

- `pnpm-lock.yaml` — took the parent nightly's generated lockfile wholesale instead of AI-splicing it
- `apps/desktop/src/app/DesktopApp.ts` — Load parent-provided legacy local-storage data from the resolved desktop user-data path before any window is created, allowing preload migration data to be available before renderer storage is read.
- `apps/desktop/src/app/DesktopApp.ts` — Run rendererHistory.shutdown as a guaranteed finalizer during desktop shutdown, before marking shutdown complete.
- `apps/desktop/src/preload.ts` — Added the parent's synchronous legacy localStorage retrieval and merge during preload startup.
- `apps/desktop/src/preload.ts` — Marks legacy storage migration complete only after a successful merge, while retaining best-effort startup if migration fails.
- `apps/desktop/src/telemetry/DesktopTelemetryPublisher.test.ts` — Added the parent NodeServices import required by the updated desktop telemetry test infrastructure.
- `apps/desktop/src/telemetry/DesktopTelemetryPublisher.test.ts` — Retained the shared DesktopHostTelemetryMessage contract import.
- `apps/desktop/src/telemetry/DesktopTelemetryPublisher.test.ts` — Enabling diagnostics demand is now expected to trigger a second metrics read.
- `apps/desktop/src/telemetry/DesktopTelemetryPublisher.test.ts` — The newly read metrics sample is expected to be recorded in renderer history, yielding two recorded copies of the test metrics.
- `apps/desktop/src/telemetry/DesktopTelemetryPublisher.ts` — Integrated upstream's diagnostics-demand behavior: Electron process details are emitted only while at least one diagnostics demand source is active.
- `apps/desktop/src/telemetry/DesktopTelemetryPublisher.ts` — Applied truncation signaling only when diagnostics are demanded, so intentionally omitted non-demand metrics are not misreported as count-based truncation.
- `apps/mobile/src/connection/onboarding.ts` — Pairing commands now accept the parent's structured input containing pairingUrl and optional expectedEnvironmentId.
- `apps/mobile/src/connection/onboarding.ts` — The expected environment identifier is forwarded into pairing preparation so adding a route can verify the intended saved machine.
- `apps/mobile/src/connection/onboarding.ts` — Single-flight scheduling now distinguishes the same pairing URL used with different expected environment identifiers.
- `apps/mobile/src/connection/onboarding.ts` — The parent's route-specific API documentation and composite concurrency key are retained.
- `apps/mobile/src/connection/platform.ts` — Added networkPathChanges to the wakeup layer so online Wi-Fi-to-cellular and similar path transitions wake connections before a stale LAN socket times out.
- `apps/mobile/src/connection/platform.ts` — Adopted the parent's Stream.mergeAll composition with unbounded concurrency for the application-state, credential, and network-path wakeup streams.
- `apps/mobile/src/connection/platform.ts` — Integrated the parent cleanup of thread composer errors when an environment is cleared, adapting the synchronous operation to T3 Pretty's asynchronous cleanup wrapper.
- `apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx` — Integrated the parent API change that passes params.routeFor to onConnectPress so connection handling can honor the requested post-connect route.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — Integrated the parent ComposerErrorNotice import for the upstream composer error presentation behavior.
- `apps/server/src/mcp/PreviewAutomationBroker.ts` — Updated hostAssignmentKey to accept McpThreadInvocationScope.
- `apps/server/src/mcp/PreviewAutomationBroker.ts` — Read the provider session ID from scope.thread.providerSessionId under the parent's new thread-scoped invocation model.
- `apps/server/src/orchestration-v2/Orchestrator.control-reads.test.ts` — Integrated the parent regression test ensuring delegated child threads do not inherit the parent's linked pull request or pull-request list.
- `apps/server/src/orchestration-v2/Orchestrator.control-reads.test.ts` — Integrated coverage that delegated children still inherit branch and worktree information and retain parent lineage.
- `apps/server/src/orchestration-v2/Orchestrator.control-reads.test.ts` — Integrated coverage that a child can link its own pull request without mutating the parent's pull-request metadata.
- `apps/server/src/orchestration-v2/legacy/LegacyV1ThreadImporter.ts` — Integrated the parent cleanup that removes the obsolete makeKeyedSerialExecutor import.
- `apps/server/src/provider/providerMaintenanceCommandCoordinator.ts` — Replaced the fork-local ../KeyedLock.ts usage with the parent's first-party @t3tools/shared/KeyedLock implementation.
- `apps/server/src/provider/providerMaintenanceCommandCoordinator.ts` — Integrated the parent's explicitly typed KeyedLock.make&lt;string&gt;() API.
- `apps/server/src/provider/providerMaintenanceCommandCoordinator.ts` — Integrated the parent's simplified Effect composition using Effect.void, Effect.andThen, and Effect.ensuring without changing coordinator ordering or cleanup semantics.
- `apps/server/src/server.ts` — Integrated the parent DirectEndpoints environment module import required by the nightly server implementation.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Integrated ChevronRightIcon, RouteIcon, and TerminalIcon required by the parent’s expanded connection UI.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Integrated RelayConnectionRegistration and RelayConnectionTarget for the parent’s relay connection model.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Integrated connectionRoutes for the parent’s connection-route behavior.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Integrated the parent `environmentCatalog.register` command binding for registering discovered environments.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Integrated the parent `useRelayEnvironmentDiscovery()` state used by the new relay environment discovery flow.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Added the parent's routeTarget state so the add-backend dialog can add a route to an existing saved machine rather than always creating a new machine.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — The parent's route-target identity constraint is honored through connectSavedBackendSshTarget, which passes expectedEnvironmentId when routeTarget is present.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — The parent's route-aware successful-add behavior is retained through the helper's "Route added" result and route-specific description.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Changes to routeTarget correctly refresh handleAddSavedBackend indirectly because connectSavedBackendSshTarget depends on routeTarget and is itself a dependency of this callback.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Opening the add-environment dialog now clears the current route target with setRouteTarget(null), preventing stale routing state from carrying into the new environment flow.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Closing the add-environment dialog continues to clear saved backend errors.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — The dialog now identifies a route-target operation with “Add a route to …” in its title.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Route additions retain the parent's explanation that another address joins the existing machine rather than creating a duplicate machine.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — When a route target is present, the parent's remote pairing form is rendered so an alternate route such as a Tailscale address can be added.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Added the parent SavedBackendListRow route action, setting the selected route target, clearing stale saved-backend errors, and opening the existing add-environment dialog.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Adapted the upstream route action to T3 Pretty's selected-environment detail architecture rather than reverting to the parent's flat environment list.
- `apps/web/src/connection/platform.ts` — Integrated the parent’s EnvironmentId dependency; the value-capable import remains valid for both runtime and type positions.
- `docs/user/source-control.md` — Added the upstream web and desktop GitHub pull-request-list quick-action mode activated with Shift.
- `docs/user/source-control.md` — Added upstream bulk closing by dragging across rows in one group, Escape cancellation, and retention of failed closes for retry.
- `docs/user/source-control.md` — The parent's review-editing, GitLab terminology, auto-merge, waiting fork-workflow approval, and revert capabilities remain covered by the existing detailed sections surrounding this conflict without duplicating them here.
- `packages/client-runtime/src/authorization/service.ts` — Integrated upstream's direct-endpoint behavior: an unreachable direct address no longer causes token rejection or an unnecessary relay/bootstrap round trip, allowing the cached token to remain available for the T3 Connect route.
- `packages/client-runtime/src/authorization/service.ts` — Preserved upstream's exception for EnvironmentAuthInvalidError, which continues into token replacement rather than treating the failure as a mere direct-address connectivity problem.
- `packages/client-runtime/src/connection/catalog.ts` — Added optional learned-route metadata so server-reported routes can be identified and replaced when their addresses change.
- `packages/client-runtime/src/connection/catalog.ts` — Added optional T3 Connect authorization metadata for routes authenticated with the environment's T3 Connect credential.
- `packages/client-runtime/src/connection/supervisor.test.ts` — Integrated the parent harness's `initialConfig` callback for testing session initial-configuration behavior.
- `packages/client-runtime/src/connection/supervisor.test.ts` — Integrated the parent harness's `checkRoute` callback for testing route checks, preflight behavior, and route selection.
- `packages/client-runtime/src/connection/supervisor.ts` — Added the 60-second periodic better-route check used while connected through a fallback route.
- `packages/client-runtime/src/connection/supervisor.ts` — Added the five-minute better-route cooldown that prevents repeated connection attempts to a flaky preferred route.
- `packages/client-runtime/src/connection/supervisor.ts` — Connection establishment now obtains its entry through the upstream `attemptEntry` effect rather than using the older captured `entry` value.
- `packages/client-runtime/src/connection/supervisor.ts` — An online network change now immediately requests a better-route check for the active lease.
- `packages/client-runtime/src/connection/supervisor.ts` — A wakeup that resets retry backoff now immediately requests a better-route check for the active lease.
- `packages/client-runtime/src/connection/supervisor.ts` — The parent's lease-scoped route-check behavior is composed into the fork's MonitorEvent signal handling instead of replacing the fork supervisor architecture.
- `packages/client-runtime/src/connection/supervisor.ts` — The parent’s lease-aware handling during connected probing is preserved in the refactored event loop: relevant network and wakeup signals invoke requestBetterRouteCheck(lease) before signal dispatch.
- `packages/client-runtime/src/connection/supervisor.ts` — Disconnect, retry, offline, and wakeup events continue to interrupt or redirect probing through the current monitor state machine rather than the obsolete probeEvent control flow.
- `packages/client-runtime/src/connection/supervisor.ts` — When a requested preferred-route switch lands on another route, the requested route is placed into the better-route cooldown using monotonic time.
- `packages/client-runtime/src/connection/supervisor.ts` — Optional route learning now runs in a scoped fiber for each published active lease, adapted to Pretty's replacement-capable lease lifecycle.
- `packages/client-runtime/src/connection/supervisor.ts` — Upstream connected-state publication behavior remains represented through Pretty's publication helper, with the appropriate lease generation and attempt values.
- `packages/contracts/src/server.ts` — Added the parent's optional directEndpoints server-config field, allowing clients to discover advertised LAN and tailnet addresses while remaining compatible with older servers.

## Parent changes intentionally omitted

- `apps/desktop/src/app/DesktopApp.ts` — The parent's unconditional early desktop-protocol registration, IPC-handler installation, bootstrap log, and snapshot initialization from this hunk.. Reason: T3 Pretty intentionally performs these operations later with configuration specific to either the local-disabled remote/SSH path or the resolved local-backend path. Restoring the unconditional setup would duplicate initialization and could temporarily configure packaged or local-disabled startup against an invalid/dead local origin; the equivalent behavior remains present in both fork branches below.
- `apps/desktop/src/app/DesktopApp.ts` — Use the parent stopAllPoolInstances() helper for backend cleanup.. Reason: The conflicting T3 Pretty implementation explicitly performs bounded concurrent shutdown across every pool instance. Replacing it with the parent helper call would discard that fork-specific shutdown behavior; the parent's stop-all intent is still preserved by the inline implementation.
- `apps/mobile/src/connection/platform.ts` — Wake on every AppState transition to active, including transitions for which no background entry was recorded.. Reason: This conflicts with T3 Pretty's explicit mobile reliability safeguard: inactive→active blips do not suspend the process and must not trigger connection probes or reconnects. Genuine background resumes and the parent's new network-path wakeups remain covered.
- `apps/server/src/mcp/toolkits/preview/handlers.ts` — Replace preview authorization with `requireThreadMcpCapability("preview")`.. Reason: The thread-specific parent call conflicts with T3 Pretty's newer dedicated shared preview-authorization path. Replacing the fork helper here would bypass that centralized behavior and could make preview authorization inconsistent across call sites.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Retention of savedBackendMode, savedBackendHost, and savedBackendPairingCode in the parent add-backend dialog state.. Reason: T3 Pretty intentionally removed these legacy declarations as part of its fork-specific connection flow. Restoring them would undo that fork change; the new saved-machine route target is compatible and is integrated independently.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Directly call connectPairing with remotePairingInput, including the new expectedEnvironmentId option, from handleAddSavedBackend.. Reason: This fork handler is the manual desktop SSH flow and has already parsed an SSH target. Calling connectPairing would ignore that target and replace the fork's SSH-managed tunnel behavior. The compatible expected-environment validation is instead preserved on connectSshEnvironment through connectSavedBackendSshTarget.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Clear pairing-code fields and show the parent's generic paired-backend success toast from this SSH handler.. Reason: Those fields and messages belong to the pairing flow. The fork's SSH helper performs the applicable SSH field cleanup and provides route-aware, SSH-specific success messaging.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Show the parent's generic error toast and reset the loading flag when manual SSH target parsing fails.. Reason: The fork intentionally uses its SSH-specific formatter and inline error state for this validation failure. The loading state is not started until connectSavedBackendSshTarget runs, so resetting it in the parse catch is unnecessary.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — The parent T3 Connect fallback-route offer, including RelayConnectionRegistration, success messaging, and route-aware error handling.. Reason: The implementation is embedded entirely in legacy renderRemoteModeBody infrastructure that T3 Pretty deliberately deleted. The supplied context does not expose the fork's replacement UI where this behavior could be integrated without resurrecting the removed path.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — The parent route-aware primary action label that changes from “Add environment” to “Add route” when routeTarget is present.. Reason: That action belongs to the deleted legacy remote-mode body and cannot be retained independently at this conflict boundary.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — The parent's retained legacy connection-mode card and manual host/pairing-code form helpers.. Reason: T3 Pretty removed these helpers; restoring them would directly reverse the fork's authoritative UI change.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Render the manual Add environment dialog unconditionally on every web surface.. Reason: This conflicts with T3 Pretty's intentional platform behavior: manual environment creation is an SSH-only desktop capability, while other surfaces connect through Surge Connect.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Use the parent's ghost-muted variant for ServerUpdatesAction.. Reason: T3 Pretty's existing ghost variant plus fork-specific muted classes preserves its authoritative visual design while retaining the same server-update action behavior.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Offer a generic “Remote link” mode for ordinary manual environment additions and restore the remote/SSH mode chooser.. Reason: This conflicts with T3 Pretty's authoritative connection architecture: desktop hand-added environments are SSH-only, while other environment connections are handled through Surge Connect. The remote form is retained only for the compatible parent route-addition workflow.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — Retain and export ProviderEnvironmentSection, the legacy arbitrary environment-variable editor.. Reason: T3 Pretty intentionally deleted this component while introducing the adjacent provider-field-definition environment flow. Restoring the old editor would reintroduce superseded behavior and dependencies instead of preserving the fork's authoritative provider/secret settings UX.

# Reviewed integration of v0.0.46-nightly.20261005.2702

- Exact upstream target: cfa4f765ec05950a032b6c1cf9cdfff0c2391545.
- Composed current Origin main9584e089333a94a136528185a1611125e9db2d90 with the preserved2689 candidate and its nine reviewed route, wire-compatibility and bounded-output repairs.
- The newer native2689 checkpointac8a914c44551b6b65659f32b5b1b1fa5ede40ce fixes active-lease references, scoped periodic checks and preferred-route handling. These are already covered by the candidate’s stronger tested supervisor implementation; the native cachef0e0095e85729856fc272748f4090a76b43cee7e is retained unchanged.
- Preserve fork retry timing, healthy-lease probe-before-reconnect behavior, on-demand HTTP authorization, bounded ACP queues/wire framing, strict NDJSON parsing, scoped MCP registries, ranked search, home suggestions, activity motion, read-aloud, API-key requests, mobile onboarding and relay sizing.
- Keep shipped migration IDs1 through69 unchanged; assign ScheduledTaskWebhooks and WebhookRelayDeliveries to70 and71. Append the reviewed durable webhook dispatch and secret-ref claim migration at72.
- Integrate upstream native goals, Stop/delegation changes, signed/held webhook support, HTML rendering and one-use private secret cards alongside fork capabilities. Adapt fork-only imports and encoders to Effect4.0.1.
- Retain the fork workflow/release boundary and PS_5 relay sizing; omit public-upstream CI ownership and PS_80 production sizing.
- Fix malformed snooze/event timestamp visibility and legacy failed-session queued-state clearing. Adapt search fixtures to canonical assistant output and explicit legacy substring decoding, retaining their full assertions. Grok fallback retains both the built-in resume and compact commands.
- Verified six review findings against fork PR4 at3fa2c9e9227e68f547d7993bc290bf7b24ef9709. The fork repair commit is b50752d820c9a9fbf7cec252e89d93c1c105fb75; its compatible repairs are applied here without importing the fork workflow boundary.
- Commit webhook claim, delivery log and pending dispatch together before acknowledgement. Service restart reloads pending work with the same idempotent command; failed writes roll back the claim. Reserve workers atomically before forking, keep execution interruptible, and bound pending deliveries per task.
- Commit signed-task saves with their one-use secret-ref claims. Failed saves retain the private value for retry; a committed claim prevents reuse even if file cleanup fails. Only the same consumer command may replay its already-consumed ref, and expired claim metadata is pruned.
- Secret requests wait on stored card/run events with a cursor taken before the first read. Secret inputs use standard password masking; disabling webhook holding accurately states that queued requests are discarded.
- Preserve mobile animation bindings. Remove the unused retired Follow-ups screen; the current Threads settings retains queue/steer through legacyQueueEnabled, and old device preferences remain intentionally retired.
- Final composed-source validation passed:1316 tests across75 files; contracts, client-runtime, web, mobile, desktop, server and relay typechecks; frozen install; web lint and scenery motion tests; production web build; server bundle; production iOS export; mobile static checks; and all4 production TLS-guard cases. Publication still requires the normal exact-head review and merge flow.

- Follow-up review at b507 identified four further reliability cases, repaired here: replayed signed saves return the current task without overwriting later edits or recreating deleted rows; webhook dispatch retries stop after five failed attempts and preserve their terminal error in the delivery log; run accounting is owned by each durable delivery, with completion and pending deletion committed together; direct secret handoff commits its claim before best-effort file cleanup.
- The deferred-COMMIT regression exposed a connection left in an open failed transaction by the custom Node SQLite adapter. Adopt Effect4.0.1's shared SQLite acquirers, which roll back failed commits and reject a connection when rollback fails, while retaining BEGIN IMMEDIATE, read-only behavior and fork settings. Focused SQLite, webhook and secret regressions pass.
- Final follow-up source validation passed:1330 tests across77 files, all seven scoped typechecks, targeted backend lint, production server bundle and all four TLS-guard cases. Earlier web/mobile build and frozen-install gates remain passed on unchanged dependency/frontend semantics. A normal integration branch is used for publication because Origin intentionally excludes automation branches from its PR review jobs.

- Final nightly2702 review repairs authorize local HTML images against the caller's canonical project/worktree root and read through validated no-follow descriptors. Relay offline holding verifies a URL capability signed by the environment's existing link key before reserving capacity; endpoint, hook and token are bound, and the proof is removed from forwarded query data. Existing unsigned URLs still proxy online; offline holding needs the newly displayed signed URL.
- Declining a recovered pending secret request removes its earlier stored value. Direct HEAD webhook probes return405 without dispatching. Preview-browser publication preserves completed peer installations instead of deleting their directory.
- HTML renders use a shared self-contained resource policy on server, headless preview, web and mobile. Clients restrict fetched markup before browser execution, including older backend responses; mobile HTML uses about:blank and web uses an opaque sandbox. Network resources, connections, frames and form submission are blocked while inline scripts/styles and embedded media remain usable.
- Only html_render publications receive pending markers. The bounded rotating cleanup uses a24-hour grace period, preserves persisted references and removes committed markers; ordinary uploads and unsubmitted drafts are untouched. Failed/interrupted publications remove both page and marker. New regressions cover authorization/symlink escape, forged/transplanted hold capabilities, recovered secret decline, HEAD dispatch exclusion, older-backend resource restrictions, peer installation and marked crash orphans.
- Repair the existing Expo allowance reader's unsupported update:view --non-interactive argument. CI=1 remains; the daily cap, Vancouver timezone, release fingerprint/deduplication rules, native cadence and TLS publication guard are unchanged.
- Final composed validation passed:1403 tests across82 focused files (four browser cases remain skipped under the explicit QA hold), all seven scoped typechecks, targeted lint, production web build, server bundle, production iOS export, mobile static checks and all four learned-route TLS publication guard cases. The matching user-fork repairs passed400 tests across29 files, the same seven typechecks, bundle/lint and four TLS guard cases. Expo release-guard regressions are included. Existing SwiftLint/ktlint/detekt tooling remains unavailable; no native source was changed. The current native fingerprint matches the delivered iOS184 runtime, so this source requires no new IPA.

### Follow-up review at55627c0a — four client/compatibility repairs

The exact-head fork code and security reviews completed on2026-10-06 at07:14/07:18UTC. Code review raised four P2 findings, all repaired in both integration trees: mobile HTML requests are keyed by URL and use the latest error callback without restarting streamed downloads; full-screen failures show File unavailable with an explicit retry that refreshes authorization; ordinary HTML previews retain the original opaque-origin sandbox and signed sibling resources while html_render publications and clients retain their strict document resource policy; arbitrary secret answers validate non-blank input while preserving intentional whitespace through client input, RPC encode/decode and storage/consumption. Pretty's separate bounded API-key prompt schema remains unchanged.

Composed validation now covers411 tests/31files in the user fork and1414/84files in Pretty, plus four existing skipped real-browser cases each. New mocked-platform React unit regressions cover callback rerenders, URL cancellation/stale results and full-screen error/retry. All seven scoped typechecks pass using isolated fresh caches; unchanged file-viewer React Compiler lint warnings are confirmed against the published baseline. Server bundles, Pretty production web build and production iOS export pass. Real client QA remains held and these unit regressions do not replace it. Native review3190 failed before any posted Origin review result and has no visible annotations; no duplicate retry/build or held log access was performed. A new review is required after publishing this follow-up head.

### Follow-up review at39f34b3 — five network/orchestrator/client repairs

Both existing exact-head reviews completed (security07:54:49UTC, code07:58:51UTC); code posted four P2 findings and one P1 mobile parity finding. Repairs now block host interfaces' entire public IPv4/global IPv6 subnets (CIDR/netmask fallback), re-probe only registered candidates for driver-only delegation, initialize the actual in-memory HTML document with the current app theme before mount while preserving live updates and resource policy, expose Stop watching on mobile linked PR rows with scoped watching:false commands, and serialize secret-answer store/record/cleanup operations so a concurrent losing answer cannot delete a winning value. Inert script/comment/template theme markers are ignored, and initial theme keys/values are sanitized before CSS insertion.

Composed suites include32files in the user fork and85in Pretty, with4 existing skipped real-browser cases each. Focused subnet, driver-only recovery, theme, mobile user-action and both answer-order regressions pass; all seven scoped types, targeted lint, both server bundles, Pretty production web build and iOS export pass, as do the unchanged actual four-case TLS guards. Fresh native fingerprint still matches delivered iOS184, retaining OTA-only delivery. Exact committed-head results are recorded externally after commit hooks. Two Git overview React memo-dependency warnings remain; no unrelated memoization refactor was made. QA/evidence waiver and narrow3189 checkout log permission remain pending. No merge/release or duplicate native review build.

The two old-main fork Release failures37430133691 and37432384696 were scheduled at438fb6230 and failed before any job/check ran. Both visible workflow annotations state Queue is full for concurrency group release-nightly; read-only metadata shows100pending runs plus the older queued37077047894. These are queue/startup failures, not2702 source validation. Exhausted included Actions allowance remains a separate execution constraint; no rerun, cancellation, workflow, queue or billing change was performed.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.46-nightly.20261006.2735`
- Previously integrated parent nightly: `v0.0.46-nightly.20261005.2702`
- Conflict resolver: manual compose (Cursor Grok 4.6 Cloud Agent). Scheduled Buildkite sync (#3229 and earlier) could not land this tag: shared contract typecheck failed after the automated repair declined on `preview.ts`.

## T3 Pretty changes preserved at conflict boundaries

- `packages/client-runtime/src/state/preview.ts` — Kept `PREVIEW_STATE_IDLE_TTL_MS`, `previewAutomationHostFocusConcurrencyKey`, and the automation atoms (`automationRequests`, `respondToAutomation`, `focusAutomationHost`). A 3-way merge against 2702 treated those unchanged-vs-base symbols as deleted by 2735.
- `packages/client-runtime/src/state/preview.test.ts` — Kept the idle-TTL and connection-specific focus-concurrency tests (upstream deleted the file).
- `packages/client-runtime/src/rpc/http.ts` — Exported `remoteHttpClientLayer` as an alias of 2735's `layerRemoteHttpClient` so Pretty tests and callers still typecheck.
- `packages/contracts/src/rpc.ts`, `apps/server/src/ws.ts`, `apps/server/src/auth/RpcAuthorization.ts`, `packages/client-runtime/src/rpc/client.ts` — Restored `previewAutomation.connect` / `.respond` / `.focusHost` RPCs, auth scopes, websocket handlers, and the 1s re-register-on-completion stream policy.
- `apps/web/src/environments/primary/httpLayer.ts` — Kept Pretty's fetch deadline and scoped cookie/bearer RequestInit; used the upstream layer name.
- `apps/desktop/src/preview/Manager.ts` — Kept Uint8Array recording frames and host-targeted listeners.
- `apps/server/src/textGeneration/*` — Kept `collectUint8StreamText` / 1 MiB diagnostic caps and Pretty extra operations.
- Relay worker — Kept home-suggestions API/store and `serveRelayHttpRequestWith` (health-path deadline).
- Fork workflows under `.github/workflows` remain the Pretty set.
- `AGENTS.md` — Restored Pretty `migrate-dev-db` / `statev2.sqlite` test-data seeding, effect-worker drain verification, Origin PR babysitting, and the one-concern-per-PR rule (including the CONTRIBUTING one-problem-per-PR link).
- `AGENTS.md` — Restored the Pretty-only “Maintainer fleet updates” section (owned hosts, published-artifact/updater-only rollout, continuation handoff, rollback, and the ban on building source on installed machines).

## Parent changes integrated at conflict boundaries

- Preview `adjust` and `clearProfile` commands, server-browser / CDP host path, and `HttpObservability.layer` / `layerRemoteHttpClient` naming.
- `AGENTS.md` — Added OpenCode to the intro, glossary, and provider-surface list next to Pretty’s Grok mention. Kept 2735’s decider/projector/reactor “How it works” rewrite.
- Text generation `TextGenerationOperations.fromRunner` extraction and 2735 CLI/runner changes.
- Relay `layer*` HTTP API names, `traceRelayHttpRequestWith`, and HeldHooks-owned hook endpoint resolution.
- PlaywrightInjectedRuntime and the unused web preview-automation helper modules were deleted with the parent; WelcomeWizard stays deleted in favor of Trailhead.

## Parent changes intentionally omitted

- None of the 2735 preview-adjust / clear-profile / server-browser work was omitted. The parent deletion of preview-automation RPCs was not taken: Pretty still hosts automation connections.
- `AGENTS.md` — Did not take the parent “Split it only when the maintainer asks” PR rule. That conflicts with Pretty’s one-concern-per-PR policy, same as earlier nightlies.
- `AGENTS.md` — Did not take the parent `VACUUM INTO` / `state.sqlite` test-data recipe. Pretty seeds worktree state with `migrate-dev-db` into `statev2.sqlite`.

## Post-merge repairs

- `shared-typecheck` on the scheduled bot tree failed because auto-merge dropped `previewAutomationHostFocusConcurrencyKey` and renamed HTTP/relay test helpers without updating every call site. This compose keeps both names/behaviors and restores the missing export and RPC surface.
- `install` failed with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` because the merge took 2735's lockfile while Pretty's `pnpm-workspace.yaml` `patchedDependencies` set differs. Regenerated `pnpm-lock.yaml` with `pnpm install --lockfile-only --no-frozen-lockfile` (same path as `scripts/fork/run-upstream-sync.sh` `regenerate_lockfile`).
- `shared-typecheck` on this composed tree then failed because path-matched cache blobs dropped 2735 contract/runtime symbols Pretty still calls:
  - Re-exported `PREVIEW_AUTOMATION_OPERATIONS` (2735 left it file-private after the V1/server split).
  - Restored `RepositoryOrigin`, `origin`, `repositoryGroupingKeyOf`, `repositoryGroupingDisplayNameOf`, plus 2735 `worktreesDirectory` / `serverBrowser` capabilities, while keeping Pretty capability keys.
  - Restored `packages/client-runtime/src/connection/supervisor.test.ts` from Origin main so the harness still provides `checkRoute` / `preflight` and Pretty's retry/TLS tests.
  - Corrected `threads-sync.test.ts` to import `effect/http` (both parents) and added 2735's cache-read-failure case with the wider `loadCached` error channel.
- `web-typecheck` failed on stale cache mixes in chat/storage/preview. Restored Pretty `ChatView.tsx` / `MessagesTimeline.tsx`, then wired `usePreviewAvailable` so server-browser environments can open preview. Composed connection storage (`makeCatalogBackend` + `layer`/`connectionStorageLayer`), `AgentBrowserCursor` (`AgentCursorMark` + Pretty pointer phases), `CloudEnvironmentConnectList` fixtures (`loaded`), and both HTTP-layer export names.
- `desktop-typecheck` / `relay-typecheck` failed on the same cache pattern: test files kept Pretty `makeLayer`/`TestLayer`/`httpClientLayer` call sites after 2735 renamed helpers. Restored Pretty-sized desktop/APNS tests from main; composed backend/auth/window/Manager tests with both `layer*` and `make*` names; added `environmentPublicKey` on relay `HookEndpoint` so Pretty hold-proof still typechecks; pointed the leftover `connectorTestLayer` call at `layerConnectorTest`.
- `server-bundle` failed on stale `Layers/` and `effect/unstable/http` imports after 2735 flattened persistence/provider modules. Pointed `server.ts` / AgentMonitoring / ProjectionAutomation* at the flattened paths and `effect/http`.
- `mobile-typecheck` needed aliases for 2735 `layer` names (`connectionStorageLayer`, `runtimeContextLayer`, `cryptoLayer`, `relayTestLayer`).
- Re-applied Pretty environment label/remote URL max-length checks so the existing contract tests still hold, and only split same-machine clones when the checkout root is known so 2735 fork-origin grouping still works.
- Origin review of this compose flagged the dropped fleet-update section and leftover `serverExposureLayer` / `makeEnvironmentLayer` / `httpClientLayer` aliases in desktop backend tests. Restored the policy from Origin `main` and pointed those call sites at `layerServerExposure` / `layerEnvironment` / `layerHttpClient`.
- Pretty’s Windows stdin-delivery test still asserted a 48-hex static token after 2735 switched bootstrap to a 32-byte secret plus a rotating HMAC token. Kept the Pretty delivery assertions and applied the 2735 secret/token contract.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.46-nightly.20261007.2787`
- Previously integrated parent nightly: `v0.0.46-nightly.20261006.2735`
- Conflict resolver: manual compose (Cursor Grok 4.6 Cloud Agent). Scheduled Buildkite sync (#3249 checkpoint, #3250 blocked) opened Origin PR #820. The automation's resolution cache was reused for 112 conflicted files; five remaining conflicts plus the WelcomeWizard modify/delete were composed by hand.

## T3 Pretty changes preserved at conflict boundaries

- `apps/server/src/auth/PairingGrantStore.ts` — Kept all-requested-scopes consumption (`every()`, always pass `requestedScopes`). A rejected request must not consume a one-time pairing link. `AuthPairingLinks.consumeAvailable` already uses `NOT EXISTS` / `json_each` all-scopes SQL.
- `apps/mobile/src/features/threads/ThreadGitControls.tsx` — Kept Pretty's PR / Snooze / Settle header. Accepted 2787 `AuthSourceControlWriteScope` gating and the `canOperateTerminal` / `canOpenTerminal` caller contract. Terminal operate remains in `ThreadTerminalRouteScreen` / Android header, not restored as a Pretty header item.
- `apps/server/src/sourceControl/GitHubCli.ts` — Kept Pretty `getCodexReview` (GraphQL + pagination) on top of 2787's `GitHubApi` rewrite. Re-exported `PinnedGitHubCredential` / `AllowGitHubReserve`. Error classes expose `detail` for `GitHubSourceControlProvider`.
- `apps/server/src/mcp/McpHttpServer.ts` — One `threads` binding per registrar. Kept Pretty body-size helpers, capability middleware, `HtmlProjectService` provides, `toolkitRegistration` for orchestrator/device, `McpServer.toolkit` for ComputerUse/Automations/Secrets, and split `/mcp`, `/mcp/computer-use`, `/mcp/automations` transports.
- WelcomeWizard stays deleted. Upstream's new wizard import/terminal coverage was retargeted at Trailhead (`Trailhead.import.test.tsx`, `Trailhead.terminal.test.tsx`) with Pretty labels and operate-scope gating on `TrailheadProjects` / `TrailheadAgents`.
- Desktop listen-contract provides (`ServerBrowser`, `WebhookRoute` / `RelayDeliveryProof`) and Pretty-only drizzle snapshot entities were left in place (#818 / #819).

## Parent changes integrated at conflict boundaries

- 2787 OAuth MCP unauthorized challenge (`resource_metadata`, `invalid_token` only when a token was presented; no OAuth offer for provider-session tokens).
- 2787 `GitHubApi` rewrite of `GitHubCli` (REST/GraphQL through the API service; `fromGitHubApiError` mapping).
- Mobile git-control write-scope disablement for pull/push/commit.
- Cache-applied compositions for the other conflicted files (112 entries from `automation/sync-resolution-cache`).

## Parent changes intentionally omitted

- Did not restore WelcomeWizard. Pretty's Trailhead is the onboarding surface.
- Did not put 2787's terminal menu back into the iOS thread git header. Pretty's header is Settle / Snooze / PR; terminal authorization stays on the terminal route and Android header.

## Post-merge repairs

- `ChatView.tsx` exceeded the 256 KiB repair skip, so `PreviewSessionSync` / `useEnvironmentSupportsServerBrowser` were wired by hand. Raised `scripts/fork/repair-sync-tree.mjs` `MAX_FILE_BYTES` to 512 KiB.
- `Sidebar.tsx` — imported `useAtomCommand`.
- `packages/client-runtime/src/state/runtime.ts` — dropped the local duplicate `followStreamInEnvironment` (keep the `environmentStreams` import / re-export).
- `editorPreferences.ts` — exported `resolveAndPersistPreferredEditor` for StorageSettings.
- Tests: `onError` on file-save coordinators, `changeRequest: null` on `useThreadActionMenu`, `canOperateThread` on ComposerPrimaryActions standalone stop.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.46-nightly.20261008.2813`
- Previously integrated parent nightly: `v0.0.46-nightly.20261007.2787`
- Conflict resolver: manual compose (Cursor Grok 4.6 Cloud Agent). Scheduled Buildkite sync (#3267 on main `fe8e09751`) resolved text conflicts, then failed the server typecheck gate from Origin PR #822 (239 errors in 15 `apps/server` files). Automated repair declined, so the bot opened report PR #824. This compose supersedes #824.

## T3 Pretty changes preserved at conflict boundaries

- Origin and Forgejo providers stay in `sourceControlProviderCliLayers` (packaged desktop boot).
- `getAutomatedReview` / Codex review GraphQL pagination stays on the GitHub source-control provider, now calling `fetchGitHubCodexReview` on `GitHubApi` instead of the deleted `GitHubCli` wrapper.
- `ChangeRequest.mergedAt` remains `Option<DateTime>` at the Pretty contract boundary. Provider mapping converts the parent's `string | null` records.
- `GITHUB_QUOTA_SNAPSHOT_CAPACITY` (256) is kept on `githubQuota` so a burst of one-off Enterprise hosts cannot retain quota rows forever. The deleted `githubGraphQlBudget` bound moved here.
- `StorageInventoryLayerLive` stays in the server layer graph.
- WelcomeWizard stays deleted. Trailhead remains the onboarding surface.
- Fork workflows under `.github/workflows` remain the Pretty set.
- Mobile glass / mint-glass / ConnectionSheetButton / Pretty header chrome stay composed onto 2813's v5 native stack, layout metrics, and ThreadHeader extraction.

## Parent changes integrated at conflict boundaries

- 2813 deleted `GitHubCli` / `GitHubCli.test.ts` and `githubGraphQlBudget` / `githubGraphQlBudget.test.ts`. The live transport is `GitHubApi.layerWithDependencies` (credentials + quota + rate-limit pause).
- `GitHubPullRequestCli` rename to `GitHubPullRequestApi` is complete, including leftover test identifiers.
- Mobile `react-native-screens` is the committed v5 tarball (`apps/mobile/deps/react-native-screens-5.0.0-t3.7.tgz`). The unused `patches/react-native-screens@4.28.0.patch` is deleted: 2813 no longer depends on 4.28.0, and the v5 archive already owns Android glass setters and `hidesSharedBackground`. `onlyBuiltDependencies` still lists `react-native-screens@4.28.0` because 2813 left that leftover.
- 2813 snapshot-window index migration is registered as Pretty migration ID 74 (`060_ThreadSnapshotWindowIndexes.ts`), after Pretty-only ledger identities.
- Cache-applied compositions for the other conflicted files from `automation/sync-resolution-cache` (2813 window), plus hand-composed mobile Home/Connections/ThreadRoute screens.

## Parent changes intentionally omitted

- Did not keep `GitHubCli` as a wrapper. 2787 did that while 2813 still had a CLI-shaped service; 2813 removes the module. Pretty Codex review and Origin/Forgejo layers are preserved on the new API service.
- Did not retain `patches/react-native-screens@4.28.0.patch`. The automation's fork-side fallback would have kept an unreferenced 4.28.0 patch after the v5 migration.
- Did not restore WelcomeWizard.

## Post-merge repairs

- Server typecheck on the scheduled bot tree failed because the resolver kept `GitHubCli` (and leftover `GitHubPullRequestCli` names) after 2813 deleted the module, while tests and `layerWithDependencies` expected `GitHubApi` / `GitHubQuota`. This compose deletes the CLI module, provides `GitHubApi.layerWithDependencies` from `sourceControlProviderCliLayers`, `server.ts`, `ws.ts`, evaluate-thread-titles, and the PR registry, and ports Codex onto `githubCodexReview.fetchGitHubCodexReview`.
- GitManager test fakes map `mergedAt` strings onto `Option<DateTime>` and implement `getAutomatedReview`.
- `githubQuota` evicts the oldest snapshot past 256 hosts; the former `githubGraphQlBudget` capacity test is ported.
- Provider tests cover `getAutomatedReview` GraphQL read + pagination (ported from the deleted `GitHubCli.test.ts`).
- `pnpm-lock.yaml` takes the 2813 parent copy; regeneration follows install, same as `scripts/fork/run-upstream-sync.sh`.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.46-nightly.20261008.2819`
- Previously integrated parent nightly: `v0.0.46-nightly.20261008.2813`
- Conflict resolver: manual compose (Cursor Grok 4.6 Cloud Agent). Scheduled Buildkite sync (#3273 on main `df5dd06da`) resolved text conflicts, then failed web typecheck: `UsageLimitsSection` required `hiddenProviders` and the automated repair declined rather than hard-code an empty set. The bot opened report PR #826. This compose supersedes #826.

## T3 Pretty changes preserved at conflict boundaries

- Usage coverage notices (`sourceWarnings`, omitted-environment cap, `coverageWarningsOmitted`) and the status-pulse pending glyph on the environment filter.
- Pretty `overflow-clip` / background chrome on the Usage page shell.
- GitManager unpublished-branch PR lookup skip (`unpublishedSkip`, zero TTL so a push without `-u` is not cached).
- Pretty `UsageLayerLive` / `ServerSettingsLayerLive` naming; 2819's `CursorUsageReader.layer` is provided on that graph.
- Pretty `untilTime: UsageTimestamp` on the usage summary input, plus 2819 `awaitRefresh`.
- Historical `grokBot` display name next to 2819 Muse Code.
- ChatView direct-annotation send path, 2819 `keepFullHistory` / `fullHistoryThreadKeys`, and draft-thread PR linking.
- client-runtime stale-time / force-refresh gate on connected environment queries, now passing 2819's `emit`.
- Pretty Automatic PR / Automations user-doc links and the Full-access default paragraph.
- Fork workflows under `.github/workflows` remain the Pretty set.

## Parent changes integrated at conflict boundaries

- Usage provider visibility: `usagePagePreferences.hiddenProviders`, `useUsage(..., hiddenProviders)`, `UsageLimitsSection.hiddenProviders`, and the Usage page `UsageProviderFilter`. Preferences are the source of truth; hidden providers are dropped from totals, sessions, limits bars, and Cursor enable prompts.
- 2819 kept-window / muted-figure loading (`shown`, `usageLoadingState`) so a new range does not blank the last answered usage.
- Muse Code built-in driver, settings schema, and user docs. OpenCode is restored on the built-in driver list and settings meta (present on 2813/2819; dropped from Pretty during the 2813 compose).
- UsageService scan refactor: `scanTranscriptDir`, Cursor account cache / `awaitRefresh`, concurrent OpenCode / Antigravity / Cursor sources.

## Parent changes intentionally omitted

- Did not hard-code `hiddenProviders={new Set()}`. That would ignore stored provider-visibility preferences.
- Did not take the automation cache's fork-only UsagePage blob (it omitted the `hiddenProviders` producer and is what failed #3273).
- Did not restore WelcomeWizard.

## Post-merge repairs

- Wired `hiddenProviders` from `readUsagePagePreferences()` / `updatePreferences` into `useUsage` and `UsageLimitsSection`. The 2819 preference schema and `usage.test.tsx` provider-filter cases landed with the tag.
- Restored `pendingCount` on the Usage environment filter after the 2819 compose dropped it, and dropped the leftover `keepFullHistoryOnceRef` so ChatView matches 2819's `keepFullHistory` API.
- `scanTranscriptDir` reads Pretty `TranscriptListing.files` (not the listing object) and marks the source `partial` when the walk is truncated or directories are unreadable.
- Muse text generation uses `TextGenerationOperations.fromRunner` so Pretty activity headlines, home suggestions, and project-icon denial exist on the new driver.
- Muse session MCP maps `mcpSession.servers` (Pretty granted toolkits and connected apps) instead of hard-coding one `t3-code` URL from `endpoint`.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.46-nightly.20261008.2833`
- Previously integrated parent nightly: `v0.0.46-nightly.20261008.2819`
- Conflict resolver: `gpt-6.1-sol` with `xhigh` reasoning
- 1 file(s) took the fork-side fallback because no model resolution was available; review their omissions below

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/ChatView.tsx` — AgentsPanel and subagent model/runtime conversion imports supporting Pretty's agent-panel UX.
- `apps/web/src/components/ChatView.tsx` — resolveLiveThreadHeadline import supporting Pretty's live thread headlines.
- `apps/web/src/components/ChatView.tsx` — Project-script input, creation, command, ID generation, keybinding decoding, and last-invoked-script persistence imports.
- `apps/web/src/components/ChatView.tsx` — Pretty's TitlebarLayoutControlsDragHole and WorkspacePageHeader imports.
- `apps/web/src/components/chat/ChatComposer.tsx` — T3 Pretty's composer menu controls retain their Menu, MenuCheckboxItem, MenuPopup, and MenuTrigger dependencies.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Retains ScopedThreadRef, which types the fork's thread command-menu items, without changing or removing that item variant.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Retains the observeVisibleAnimation import supporting T3 Pretty's existing visibility-aware animation consumers.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — dataKey={listIdentityKey} resets virtualization bounds when switching threads, including switches between two nonempty timelines; citation-pin dataVersion refreshes remain independent.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Pretty's conditional top fade remains a separately mounted, aria-hidden, pointer-events-none overlay rather than a fade applied to the scrolling list.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The sole mounted list retains citation positioning, remembered-position restoration, live-follow controls, fullscreen and disclosure-settling guards, and reduced-motion-aware working-scroll behavior.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Timeline minimap rendering, preview inputs, manual-navigation notification, and scroll-to-row interaction remain wired to the same list.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Run-specific generated-image paths remain connected from ctx.generatedImagePathsByTurn to ChatMarkdown, preserving Pretty's assistant-image rendering support and existing image-expansion handler.
- `apps/web/src/components/chat/SkillInlineText.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/proposedPlan.test.ts` — The downloadPlanAsTextFile import supporting fork plan-download tests remains available.
- `apps/web/src/proposedPlan.test.ts` — The fork-added afterEach hook continues calling vi.unstubAllGlobals(), preventing stubbed globals from leaking between tests.
- `apps/web/src/terminal/ghostty/core.ts` — T3 Pretty's try/finally protection frees the allocated GhosttySelection on normal completion, exceptions, and upstream's new early-return paths.
- `apps/web/src/terminal/ghostty/core.ts` — Idempotent, best-effort terminal disposal with individually guarded resource releases, so one cleanup failure does not prevent subsequent cleanup.
- `apps/web/src/terminal/ghostty/core.ts` — Independent PTY writer detachment and terminal freeing, ensuring a detachment failure does not skip terminal deallocation.
- `apps/web/src/terminal/ghostty/core.ts` — Cleanup failure accounting and warning, subsequent opaque-slot releases, and final PTY writer state reset remain reachable.
- `docs/README.md` — Retained the internal Apps (remote MCP connections) documentation entry and its existing destination.
- `docs/README.md` — Retained the internal Automations documentation entry and its existing destination.
- `packages/client-runtime/src/state/runtime.ts` — restartOnReconnect subscriptions remain dependent on the target environment's RPC generation, so generation changes rebuild the subscription.
- `packages/client-runtime/src/state/runtime.ts` — Reconnect-aware subscriptions still wait with Stream.never when no connected generation is available; options.subscribe remains invoked only after that gate passes.
- `packages/contracts/src/rpc.ts` — Retained AutomationStreamMessage and AutomationClientCommand imports supporting Pretty's automation streaming and client-command contracts.
- `packages/contracts/src/rpc.ts` — Retained automation run-list and individual run-detail input/result imports.
- `packages/shared/package.json` — Preserved public exports for appMentions and activityProjection, keeping existing mention and activity-projection helpers accessible to consumers.
- `packages/shared/package.json` — Preserved createPullRequestPrompt and hiddenInstructionBlocks exports.
- `packages/shared/package.json` — Preserved automationRunPrompt and automationSchedule exports for the fork's automation features.
- `packages/shared/package.json` — Preserved nativeResume, editorLaunch, shellCommandFormat, and networkHost exports.
- `packages/shared/package.json` — Preserved imageTool and serverConfigDigest exports.
- `packages/shared/package.json` — Preserved changelogPresentation for shared What's New presentation, connectBranding for fork branding, and trailhead for the fork's welcome experience.
- `packages/shared/package.json` — Preserved threadPullRequestNesting for the fork's PR-based thread organization.
- `packages/shared/package.json` — Preserved skillFrontmatter and skillTool alongside upstream inlineSkills; no existing skill implementation or entry point was replaced.

## Parent changes integrated at conflict boundaries

- `apps/web/src/components/ChatView.tsx` — Migration from the inherited ChatCanvas import to ThreadFind, ThreadFindCanvas, and ThreadFindControls.
- `apps/web/src/components/ChatView.tsx` — THREAD_FIND_BAR_RESERVED_HEIGHT import for upstream thread-find layout.
- `apps/web/src/components/chat/ChatComposer.tsx` — Migrate proposedPlanTitle from the web-local module to @t3tools/shared/proposedPlanText.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Adds the parent's shared formatProviderSkillDisplayName import for provider-skill display formatting.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Adds ThreadFindTimelineContext, MarkdownFindContext, and useFindRevealRef imports for the parent's timeline and Markdown find integration.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Adds shouldPreserveAssistantLineBreaks from the shared Markdown pipeline for the parent's assistant line-break handling.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Retain MarkdownFindContext around the timeline's row contexts, citation viewport, list, and minimap.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Retain findActive checks that suppress initial end scrolling and visible-content-position maintenance during find.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Retain upstream's onLoad={handleListLoad} wiring rather than reverting to the older onCitationListLoad entry point.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Use the upstream single-list render structure while composing Pretty's virtualization and fade changes into it.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The data-thread-find-text="true" wrapper marks the citation-wrapped assistant markdown as searchable thread text, leaving the author heading, changed-files section, and message metadata outside that scope.
- `apps/web/src/proposedPlan.test.ts` — Removal of the direct proposedPlanTitle import and its standalone test suite. These were unchanged from BASE, rather than fork additions.
- `apps/web/src/terminal/ghostty/core.ts` — Successful select-all converts both native grid references to screen points, applies the selection, and returns { start, end } to satisfy the declared return contract.
- `apps/web/src/terminal/ghostty/core.ts` — Select-all explicitly returns null when the native operation fails or either endpoint cannot be converted, without applying an invalid selection.
- `apps/web/src/terminal/ghostty/core.ts` — Free the cellQuery buffer using CELL_QUERY.size during disposal, matching the buffer used by the batched cell-query render path and preventing its leak.
- `docs/README.md` — Added the parent’s Adding a provider documentation entry linking to ./internals/adding-a-provider.md.
- `packages/client-runtime/src/state/runtime.ts` — Optional completeWhen termination via Stream.takeUntil is applied after followStreamInEnvironment in both ordinary and reconnect-aware subscriptions, honoring the RPC wrapper's forwarded completion predicate.
- `packages/client-runtime/src/state/runtime.ts` — Subscriptions without completeWhen retain their existing stream behavior; idle TTL and sensitive-input labeling remain unchanged.
- `packages/contracts/src/rpc.ts` — Added OrchestrationV2SearchThreadInput, OrchestrationV2SearchThreadResult, and OrchestrationV2SearchThreadError imports for the parent's typed orchestration V2 thread-search RPC contracts.
- `packages/shared/package.json` — Added codexArtifactTemplates, codexFileCitations, and codexMarkdownDirectives exports with their upstream types and import targets.
- `packages/shared/package.json` — Added markdownGithubAlerts, markdownListIndentation, and markdownPipeline exports.
- `packages/shared/package.json` — Added proposedPlanText export.
- `packages/shared/package.json` — Added threadFindText and threadSearch exports.
- `packages/shared/package.json` — Added markdownLinks and fileLinks exports.
- `packages/shared/package.json` — Added inlineSkills export without displacing the fork's skill exports.

## Parent changes intentionally omitted

- `apps/web/src/components/chat/MessagesTimeline.tsx` — THEIRS retains the base's topbar-scroll-fade class directly on the LegendList scroll container; that class placement is not retained.. Reason: It would undo OURS's deliberate move to a separate stationary, noninteractive top-edge overlay. The fade remains available through the fork overlay; only the conflicting class placement is omitted.
- `apps/web/src/components/chat/SkillInlineText.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: apps/web/src/components/chat/SkillInlineText.tsx was not safe to resolve automatically: Do not apply these candidate edits. OURS deliberately replaced exact-name comparison with skillMentionMatchesName, consistent with the fork's odd-name mention fix. THEIRS moves tokenization and lookup into matchInlineSkills, but its implementation is not supplied, so the candidate replacement may silently regress fork matching. Retaining the old loop is also incoherent in the supplied file because SKILL_TOKEN_REGEX is undeclared and end is undefined. Retry with @t3tools/shared/inlineSkills::matchInlineSkills, @t3tools/shared/skillTool::skillMentionMatchesName, and their relevant tests or original token-regex definition. No behaviors are reported as preserved, integrated, or intentionally omitted because no safe resolution has been established.
- `shared-typecheck` failed after merging `v0.0.46-nightly.20261008.2833`; repaired with `gpt-6.1-sol`: Restore the missing Deferred import and adapt the parent's new lifecycle test to T3 Pretty's flat EnvironmentRegistry API, addressing the root errors and their cascading type failures. Preserve all test assertions and existing fork behavior without omitting any upstream changes.
  - edited `packages/client-runtime/src/state/runtime.test.ts`
- `web-typecheck` failed after merging `v0.0.46-nightly.20261008.2833`; repaired with `gpt-6.1-sol`: Update the skill formatter import and add the required search-highlight roles to all four fork palettes, with a version bump to refresh installed World Scenery themes. Wire T3 Pretty's T3 Chat colors into the exported definition, defaults, and built-in registry while preserving upstream metadata and all other themes.
  - edited `apps/web/src/components/chat/SkillInlineText.tsx`
  - edited `apps/web/src/scenery/worldSceneryTheme.ts`
  - edited `apps/web/src/themePalette.ts`
