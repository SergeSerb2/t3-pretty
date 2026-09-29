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
