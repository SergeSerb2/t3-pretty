# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261014.3105`
- Previously integrated parent nightly: `v0.0.46-nightly.20261014.3093`
- Conflict resolver: reused `automation/sync-resolution-cache` entries from Buildkite #3542 (`gpt-6.1-sol` / `xhigh`), then corrected unsound blobs

## T3 Pretty changes preserved at conflict boundaries

- `apps/desktop/src/settings/DesktopClientSettings.ts` — Keep writeSemaphore.withPermits(1) around UUID generation and settings persistence so client-settings writes remain serialized.
- `apps/desktop/src/settings/DesktopClientSettings.ts` — Keep the Effect.flatMap connection to writeClientSettings, preserving symlink-aware atomic persistence, size validation, temporary-file cleanup, typed errors, and settings-set tracing.
- `apps/desktop/src/updates/DesktopUpdates.ts` — Nightly discovery uses the fork-owned SergeSerb2/t3-pretty repository and stores the resolved tag in latestNightlyTagRef for the download path.
- `apps/desktop/src/updates/DesktopUpdates.ts` — Fetch failure, successful lookup without a nightly, and successful tag lookup remain distinct; failures retain warning logging and the /latest feed fallback.
- `apps/desktop/src/updates/DesktopUpdates.ts` — The Effect timeout remains in place to bound nightly discovery when Electron fetch abort is unreliable, protecting first-window startup.
- `apps/desktop/src/updates/DesktopUpdates.ts` — GitHub generic-feed resolution remains wired into feed selection and differential-download disabling, with mock-update feed precedence unchanged.
- `apps/desktop/src/updates/updatesTestHarness.ts` — Keep the GitHubReleasesClient test layer and its existing provision to DesktopUpdates.layer, avoiding real network calls with a default null nightly-tag result.
- `apps/desktop/src/updates/updatesTestHarness.ts` — Retain options.githubReleasesClient overrides so tests can exercise custom release-client behavior.
- `apps/mobile/src/features/cloud/linkEnvironment.ts` — Retains dpopFailureMessage for cloudEnvironmentLinkError's invalid_credential handling, preserving DPoP-failure-specific diagnostics alongside the existing error detail, cause, and trace ID.
- `apps/server/src/auth/PairingGrantStore.ts` — One-time-token scopes, subject, optional label, and optional proof-key thumbprint remain decoded and validated before ID generation, preserving standard-client scope defaults, the one-time-token subject default, and PairingCredentialInputValidationError handling.
- `apps/server/src/auth/PairingGrantStore.ts` — Validated metadata remains available to the existing downstream consumers: issued credential label and proof-key fields, persisted scopes/subject/label/proof-key binding, issuance error context, and pairing-link upsert events.
- `apps/server/src/auth/ServerSecretStore.ts` — Effect-based secret-path resolution rejects invalid secret names before UUID generation or filesystem writes.
- `apps/server/src/auth/ServerSecretStore.ts` — Secret-value size validation remains wired into set before UUID generation and persistence, preserving SecretStoreValueTooLargeError reporting.
- `apps/server/src/auth/ServerSecretStore.ts` — The existing set continuation remains intact, including temporary-file persistence, 0600 permissions, failure cleanup, typed error mapping, and ServerSecretStore.set tracing.
- `apps/server/src/cloud/CliTokenManager.ts` — HTTP request failures remain collapsed to a stable request-failed diagnostic, preventing authorization codes and refresh tokens retained in request errors from escaping this boundary.
- `apps/server/src/cloud/CliTokenManager.ts` — Pretty's whole-exchange timeout remains enforced, and either timeout produces the existing stable CloudCliTokenExchangeFailure timeout diagnostic.
- `apps/server/src/cloud/CliTokenManager.ts` — Responses still reach Pretty's readTokenResponse handling, preserving explicit body release for rejected or declared-oversized responses, bounded response collection, sanitized decoding failures, and the response-read deadline.
- `apps/server/src/cloud/ManagedEndpointRuntime.ts` — T3 Pretty's runtimeScope capture remains available to existing scope-bound managed-endpoint lifecycle work.
- `apps/server/src/mcp/PreviewAutomationBroker.ts` — Preview automation connections retain Queue.dropping with PREVIEW_AUTOMATION_MAX_PENDING_REQUESTS_PER_CLIENT, preserving Pretty's per-client queue limit instead of restoring the base's unbounded queue.
- `apps/server/src/relay/AgentAwarenessRelay.ts` — Relay agent-activity publishes continue to use RELAY_AGENT_ACTIVITY_PUBLISH_TIMEOUT, preserving the fork's established timeout policy.
- `apps/server/src/relay/AgentAwarenessRelay.ts` — The publish request, response logging, tracing, and surrounding publication gating, confirmation, and retry wiring remain unchanged.
- `apps/server/src/resourceTelemetry/NativeTelemetryClient.ts` — History reads remain serialized through historyMutex.withPermits(1), preserving the fork's telemetry concurrency safeguard.
- `apps/server/src/resourceTelemetry/NativeTelemetryClient.ts` — HISTORY_REQUEST_TIMEOUT continues to bound the entire history operation, including waiting for the mutex, generating the request ID, sending the command, and awaiting the response.
- `apps/server/src/resourceTelemetry/NativeTelemetryClient.ts` — Pending history entries retain retainedEntryCount: 0 alongside their deferred and snapshots; the existing cleanup finalizer still removes the request on completion, failure, or timeout.
- `apps/server/src/server.ts` — Retains the StorageCleanup import required by Pretty's server cleanup integration.
- `apps/server/src/server.ts` — Retains the HomeSuggestions service import supporting Pretty's home-suggestion loading and refresh behavior, including the restart fix evidenced by fork history.
- `apps/server/src/server.ts` — Retains HomeSuggestionsMesh alongside the suggestion service, preserving the server dependency for Pretty's cross-environment suggestion integration.
- `apps/server/src/server.ts` — Retain the orchestrationHttpApiLayer and projectHttpApiLayer aliases used by T3 Pretty’s HTTP route-layer composition rather than reverting to the base namespace imports.
- `apps/server/src/server.ts` — Retains the fork's runtimeStateLayer identifier rather than reverting it to layerRuntimeState, preserving the name used by the fork's startup wiring.
- `apps/server/src/server.ts` — Preserves runtime-state parked signaling, activation gating, and listening-address validation. The adjacent publication path still records launcher-managed status, delegates record cleanup to server ownership, and logs persistence failures without aborting startup.
- `apps/server/src/vcs/GitVcsDriverCore.test.ts` — Regression coverage keeps a missing prunable worktree associated with its branch when pruning fails, rather than incorrectly treating the branch as free.
- `apps/server/src/vcs/GitVcsDriverCore.test.ts` — Regression coverage keeps locked missing worktrees visible and their branches occupied.
- `apps/server/src/vcs/GitVcsDriverCore.test.ts` — Regression coverage verifies listRefs prunes deleted worktree entries and actually releases their branches for force updates.
- `apps/server/src/vcs/GitVcsDriverCore.test.ts` — Regression coverage verifies createWorktree prunes a deleted checkout before reusing its branch without requiring a prior listRefs call, protecting cold new-thread and Fix in another thread flows.
- `apps/server/src/vcs/GitVcsDriverCore.test.ts` — Regression coverage verifies deleted-worktree pruning and branch reuse when createWorktree runs from a linked worktree.
- `apps/web/src/cloud/linkEnvironment.ts` — Retains normalizeSecureRelayUrl and the existing secure URL comparisons used by configured-relay matching and its account-aware wrapper.
- `apps/web/src/components/ServerUpdateAction.test.tsx` — Retains the restart-wait regression assertion requiring T3 Pretty's status-pulse class, without restoring the base animate-status-pulse name.
- `apps/web/src/components/ServerUpdateAction.test.tsx` — Preserves the existing prohibition on animate-spin, which is covered by the broader animate- assertion.
- `apps/web/src/components/ServerUpdateAction.tsx` — ServerUpdateProgress continues to render T3 Pretty's StatusPulseDot, preserving the fork's shared pulse-component wiring rather than bypassing it with a raw span.
- `apps/web/src/components/chat/ChatComposer.tsx` — Citation submission retains settings.legacyQueueEnabled in its callback dependencies, matching Pretty’s dispatch logic: running-thread messages default to steering unless legacy queue is enabled.
- `apps/web/src/components/sidebar/SidebarUpdatePill.tsx` — Retained the fork-added CSSProperties and MouseEvent type imports supporting custom sidebar styling and interactions. No animation, event-handler, or rendering code is changed.
- `apps/web/src/routes/__root.tsx` — The main application’s SceneryHost remains mounted within FirstRunGate, preserving the render path for T3 Pretty’s World Scenery backgrounds.
- `apps/web/src/routes/__root.tsx` — The separate Trailhead scenery host and existing appearance, theme, font, and Windows glass synchronization remain unchanged.
- `docs/user/updating.md` — Preserved OURS' deliberate removal of npm-publication prerequisites and framing, consistent with the surrounding T3 Pretty R2 feed and fork-specific CLI instructions.
- `docs/user/updating.md` — Retained the explicit exclusion of manually updated servers from bulk updates and the notice or Settings → Connections entry points.
- `docs/user/updating.md` — Used T3 Pretty branding in the newly integrated failed-update guidance.
- `packages/client-runtime/src/connection/supervisor.ts` — Expected-restart handling retains timeout, endpoint-unavailable, and remote-unavailable as transient reasons.
- `packages/client-runtime/src/connection/supervisor.ts` — The exported 240-second restart retry window and 8-second retry-delay cap remain intact, including the documented return to the normal five-minute cap afterward.
- `packages/client-runtime/src/connection/supervisor.ts` — Establishment continues to use ConnectionDriver.CONNECTION_ESTABLISHMENT_TIMEOUT rather than restoring the duplicated local timeout.
- `packages/client-runtime/src/connection/supervisor.ts` — Quiet replacement establishment continues to suppress progress reporting, preventing speculative replacements from changing the published connection state or prepared connection.
- `packages/client-runtime/src/connection/supervisor.ts` — Pretty's quiet flag remains available alongside upstream synchronization accounting.
- `packages/client-runtime/src/connection/supervisor.ts` — Quiet replacement-lease establishment remains effective for non-relay connections, suppressing progress reporting and leaving the still-published prepared connection and connection state untouched.
- `packages/client-runtime/src/connection/supervisor.ts` — Connection establishment continues to use an explicitly forked, attempt-owned lease scope through Scope.provide(leaseScope), preserving the fork's lease-lifetime isolation from the establishment race.
- `packages/contracts/src/desktopBootstrap.ts` — Desktop bootstrap length limits and their existing schema consumers remain intact for paths, hosts, tokens, telemetry URLs, and the resource-monitor path.
- `packages/contracts/src/desktopBootstrap.ts` — Local-bearer handshake timeout budgets remain unchanged: 90 seconds for readiness, 8 seconds for exchange retries, and 100 seconds overall, preserving the fork's Windows splash handshake accommodation.
- `packages/contracts/src/desktopBootstrap.ts` — The requirement to mirror timeout values in desktopBearerTimeout.js for direct Node smoke-test consumption is retained.
- `packages/provider-acp/src/server/AcpSessionRuntime.ts` — Retains bounded allowed-value diagnostics using summarizeSessionConfigOptionValuesForError, including formatted values, the omitted-value indicator, allowedValues, and allowedValueCount.
- `packages/provider-acp/src/server/AcpSessionRuntime.ts` — Preserves boolean/string type validation and rejection of unsupported values outside the explicit custom-model exemption.
- `packages/shared/src/nodeSqliteClient.ts` — Retains Client.makeSqliteAcquirers so a failed COMMIT is rolled back before releasing the connection, and cleanup failure causes the connection to be rejected.
- `packages/shared/src/nodeSqliteClient.ts` — Preserves acquisition-helper state across requests instead of recreating it during routing; applies the same protection independently to each reader connection.

## Parent changes integrated at conflict boundaries

- `apps/desktop/src/settings/DesktopClientSettings.ts` — Update UUID generation to crypto.randomUUIDv4(), matching the parent’s changed Crypto API while retaining suffix normalization and error mapping.
- `apps/desktop/src/updates/DesktopUpdates.ts` — Configuration reads readNotAppliedInstallVersion and initializes notAppliedVersionRef before base update-state initialization.
- `apps/desktop/src/updates/DesktopUpdates.ts` — When an unapplied install is recorded, configuration logs a warning containing the running version and intended target version.
- `apps/desktop/src/updates/updatesTestHarness.ts` — Adopt the updated comment documenting in-memory tracking of both restart markers and install records; retain the surrounding install-record read, write, removal, and inspection paths.
- `apps/mobile/src/features/cloud/linkEnvironment.ts` — Replaces the old relayProtectedErrorMessage import with relayRequestFailureDetail, matching the supplied decodedRelayClientError implementation and preserving its relay failure details and trace IDs.
- `apps/mobile/src/features/cloud/linkEnvironment.ts` — Retains ManagedRelay for the existing typed relay-client error handling.
- `apps/server/src/auth/PairingGrantStore.ts` — UUID generation now invokes crypto.randomUUIDv4() as required by the parent's updated API, retaining generate-id error mapping to PairingCredentialRandomGenerationError.
- `apps/server/src/auth/ServerSecretStore.ts` — Migrate UUID generation from crypto.randomUUIDv4 to crypto.randomUUIDv4(), adapting the parent API change to Pretty’s validated pipeline.
- `apps/server/src/cloud/CliTokenManager.ts` — Token exchange now directly composes HTTP execution with readTokenResponse through Effect.flatMap, removing the extra generator wrapper.
- `apps/server/src/cloud/CliTokenManager.ts` — OAUTH_REQUEST_TIMEOUT now bounds the complete request-and-response pipeline alongside Pretty's existing exchange cap; whichever deadline expires first terminates the exchange.
- `apps/server/src/cloud/ManagedEndpointRuntime.ts` — The parent's HttpClient.withScope initialization is retained alongside the fork's runtime scope.
- `apps/server/src/mcp/PreviewAutomationBroker.ts` — Connection ID generation invokes the updated crypto.randomUUIDv4() API and retains Effect.orDie error handling.
- `apps/server/src/relay/AgentAwarenessRelay.ts` — Retain upstream's Effect.timeout wrapper around publishAgentActivity, already implemented by the fork, so the relay request remains bounded rather than reverting to the unbounded BASE implementation.
- `apps/server/src/resourceTelemetry/NativeTelemetryClient.ts` — History request IDs use crypto.randomUUIDv4().pipe(...) rather than treating randomUUIDv4 as an Effect value, matching the parent API change and the adjacent sampleNow implementation.
- `apps/server/src/server.ts` — Adds the parent ServerOwnership import without replacing or removing any Pretty service import.
- `apps/server/src/server.ts` — Adopt the parent’s runtime-state import cleanup: retain makePersistedServerRuntimeState and remove the clearPersistedServerRuntimeState and persistServerRuntimeState imports.
- `apps/server/src/server.ts` — Removes the obsolete Effect.acquireRelease wrapper around runtime-state publication and uses Effect.gen directly, matching the supplied closing structure and ownership-managed cleanup.
- `apps/server/src/vcs/GitVcsDriverCore.test.ts` — Retain the Git-before-2.36 compatibility test that simulates rejection of worktree list -z with exit code 129 and verifies successful worktree discovery through both listRefs and listWorktreePaths.
- `apps/server/src/vcs/GitVcsDriverCore.test.ts` — Retain native realpath comparisons in the upstream compatibility test for platform-compatible path assertions.
- `apps/server/src/vcs/GitVcsDriverCore.test.ts` — Adapt the retained Pretty tests to the current layerServerConfig and layerTest fixture naming shown in the surrounding merged code.
- `apps/web/src/cloud/linkEnvironment.ts` — Adopts the parent import change from relayProtectedErrorMessage to relayRequestFailureDetail while retaining ManagedRelay.
- `apps/web/src/components/ServerUpdateAction.test.tsx` — The restart-wait test now rejects every animate-prefixed class, incorporating the parent's stronger guard for the calm status row.
- `apps/web/src/components/chat/ChatComposer.tsx` — Adds saveCitationDraftToPrompt to preserve an unsaved citation comment when a question or approval takes over the editor, with matching-prompt guards and prompt state/ref updates.
- `apps/web/src/components/sidebar/SidebarUpdatePill.tsx` — Integrated the parent-added useMemo import without replacing any fork imports.
- `apps/web/src/routes/__root.tsx` — DesktopUpdateLaunchNotice is mounted for Electron clients within FirstRunGate, preserving the parent’s desktop-only condition and startup gating.
- `docs/user/updating.md` — Documented that the update confirmation lists skipped machines and reasons, including offline machines and machines requiring manual updates.
- `docs/user/updating.md` — Documented detection of a desktop restart on the old version, suppression of automatic reinstallation even when another device requests it, and retry through the update button on the affected machine.
- `packages/client-runtime/src/connection/supervisor.ts` — Adds the separate 75-second synchronization timeout alongside the establishment timeout.
- `packages/client-runtime/src/connection/supervisor.ts` — Retains upstream's documentation distinguishing credential/session establishment from socket opening and initial configuration delivery, including allowance for slow cold servers.
- `packages/client-runtime/src/connection/supervisor.ts` — Count routes reaching the synchronizing stage before optionally reporting connection progress.
- `packages/client-runtime/src/connection/supervisor.ts` — Propagate the synchronization counter through relay-traced establishment.
- `packages/client-runtime/src/connection/supervisor.ts` — Non-relay connection establishment receives synchronizedRoutes, matching the updated function signature and counting synchronizing-stage progress even during quiet establishment.
- `packages/client-runtime/src/connection/supervisor.ts` — Initialize synchronizedRoutes for each attempt and pass it to establishTracedConnection, wiring establishment progress to the existing deadline loop so each route reaching synchronization receives its own snapshot-time budget.
- `packages/contracts/src/desktopBootstrap.ts` — Export SERVER_EXIT_CODE_STATE_DIR_OWNED = 78, including the documented requirement that supervisors must not restart servers refused by the state-directory owner.
- `packages/provider-acp/src/server/AcpSessionRuntime.ts` — Allows string values listed in options.customModels for model-category session config options, even when absent from the provider-advertised choices.
- `packages/shared/src/nodeSqliteClient.ts` — Routes ReadOnly work to the reader worker when available, while other work and unavailable-reader fallback use the writer.
- `packages/shared/src/nodeSqliteClient.ts` — Retains separate reader and writer semaphores, allowing independent reader/writer activity while serializing access to each connection.
- `packages/shared/src/nodeSqliteClient.ts` — Applies connection routing to both ordinary acquisitions and scoped transaction acquisitions.
- `pnpm-lock.yaml` — took the parent nightly's generated lockfile wholesale; regeneration against the merged manifests follows.

## Parent changes intentionally omitted

- `apps/server/src/cloud/CliTokenManager.ts` — The HttpClient.filterStatusOk wrapper retained by THEIRS from BASE. Reason: Keep Pretty's deliberate unfiltered-client behavior so non-2xx responses reach readTokenResponse for explicit body release and a stable, secret-safe failure. Non-2xx rejection itself is preserved; only the filtering implementation is omitted.
- `apps/server/src/relay/AgentAwarenessRelay.ts` — The literal "10 seconds" timeout argument. Reason: Keep the fork's existing RELAY_AGENT_ACTIVITY_PUBLISH_TIMEOUT instead. Its definition is not supplied, so equivalent timing cannot be established and replacing it would risk changing the authoritative fork timeout policy.
- `apps/web/src/components/ServerUpdateAction.tsx` — Replace the in-flight update indicator with a static span and describe it as static. Reason: This would remove the fork's StatusPulseDot consumer and its pulse behavior. The supplied context does not demonstrate an equivalent parent implementation or a supported static mode that preserves that behavior, so the fork component remains authoritative.
- `docs/user/updating.md` — The npm-publication prerequisite for server updates and its accompanying remote-desktop/npm comparison. Reason: OURS deliberately removed both sentences from BASE. Restoring this upstream release-channel framing would regress the fork's R2-based update guidance. The surrounding text already retains remote desktop updates from their own release channel.
- `packages/shared/src/nodeSqliteClient.ts` — The upstream semaphore-only acquirer and transactionAcquirer bodies are replaced by the fork's shared acquisition helpers. Reason: The raw acquisition bodies would bypass T3 Pretty's failed-COMMIT cleanup and connection-rejection safeguards. Their routing and locking behavior is retained through helpers using the corresponding connection and semaphore.
- `.github/workflows/*` — parent workflow changes are omitted; T3 Pretty keeps its Origin/Buildkite release and sync automation from fork `main`.
- `packages/shared/src/nodeSqliteClient.ts` — the checkpointed resolution used `Fiber.getCurrent()` without importing `Fiber`. The import from `effect/Fiber` was added so the parent's SafeIntegers routing compiles. The fork's failed-COMMIT acquisition helpers remain.

## Post-merge repairs

- typecheck / supervisor tests after merging `v0.0.46-nightly.20261014.3105`:
  - `startReplacement` now allocates `synchronizedRoutes` and passes `quiet=true` as the sixth argument. The checkpoint left `true` in the `synchronizedRoutes` slot, which failed typecheck (`boolean` vs `Ref<number>`).
  - Pretty still fails over to the next route when a preferred route stalls, but the per-route cap in `connectOverRoutes` is now setup (15s) plus one snapshot (75s). The previous 15s-only cap contradicted the parent's new snapshot budget and hung the new TestClock test that spends 50s then 40s in `ready`.
  - `CONNECTION_SYNCHRONIZATION_TIMEOUT` is exported from the driver and shared with the supervisor.
  - The fork stall-failover test advances that combined budget instead of 15s.
  - The parent's snapshot-budget test uses the default Effect TestClock rather than a nested `TestClock.layer()`, so `timeoutOrElse` and forked route checks schedule.
  - The `t3 server` live-server CLI test now mocks `fetch` so Pretty's origin probe sees a T3 identity. A closed `127.0.0.1:3773` is stale and would otherwise start a real server in the test.
