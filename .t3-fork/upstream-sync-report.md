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
