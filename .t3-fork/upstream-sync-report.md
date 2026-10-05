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
