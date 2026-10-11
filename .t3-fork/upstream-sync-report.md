# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261011.2980`
- Previously integrated parent nightly: `v0.0.46-nightly.20261011.2967`
- Conflict resolver: `gpt-6.1-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/server/src/git/GitManager.test.ts` — Activity-headline generation remains available in the test service, including its default, override support, input forwarding, and TextGenerationError translation.
- `apps/server/src/git/GitManager.test.ts` — Home-suggestion generation remains available in the test service, including its default, override support, input forwarding, and TextGenerationError translation.
- `apps/server/src/git/GitManager.test.ts` — Project-icon generation remains available in the test service, including its default path, override support, input forwarding, and TextGenerationError translation.
- `apps/server/src/persistence/Migrations.ts` — All shipped T3 Pretty migration IDs, names, import bindings, and execution order remain unchanged, including previously integrated parent migrations at their Pretty-specific IDs.
- `apps/server/src/persistence/Migrations.ts` — Retained branch pull-request repair, orchestration event recorded-at, and branch-head migration registrations at IDs 50–52.
- `apps/server/src/persistence/Migrations.ts` — Retained World Scenery thread-assignment and thread-canvas migration registrations at IDs 53–54.
- `apps/server/src/persistence/Migrations.ts` — Retained activity compaction metadata and superseded tool-update cleanup migrations at IDs 55 and 57.
- `apps/server/src/persistence/Migrations.ts` — Retained enabled-skill and subagent-policy persistence migrations at IDs 56 and 58.
- `apps/server/src/persistence/Migrations.ts` — Retained the search-index migration at ID 59.
- `apps/server/src/persistence/Migrations.ts` — Retained automation persistence, automation command receipts, and webhook dispatch outbox migrations at IDs 60, 69, and 72.
- `apps/server/src/persistence/Migrations.ts` — Retained stored-thread persistence at ID 66 alongside the existing auto-settle-disabled migration at ID 65.
- `apps/server/src/persistence/Migrations.ts` — Left migration-loader wiring, startup execution, preview reconciliation, and migration-history divergence diagnostics unchanged.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — Upgrading the shipped Pretty ledger through migration 69 without modifying existing ledger entries, followed by full migrationManifest equality and idempotence checks.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — Pretty's migration IDs 70–72 for ScheduledTaskWebhooks, WebhookRelayDeliveries, and WebhookDispatchOutbox.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — Manifest-based migration IDs and uniqueness checks for McpAppModelContext and ThreadSnapshotWindowIndexes.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — Rejection of conflicting upstream preview migrations 53 and 54 without changing migration history or legacy-import progress.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — Transactional schema-and-ledger rollback, removal of the conflicting view, successful retry, and subsequent no-op migration execution.
- `apps/server/src/provider/Drivers/CodexManagedProvider.ts` — Managed Codex activity-headline generation remains exposed through generateActivityHeadline and its native implementation.
- `apps/server/src/provider/Drivers/CodexManagedProvider.ts` — Managed Codex home-suggestion generation remains exposed through generateHomeSuggestions and its native implementation.
- `apps/server/src/provider/Drivers/CodexManagedProvider.ts` — Managed Codex project-icon generation remains exposed through generateProjectIcon and its native implementation.
- `apps/server/src/provider/Drivers/CodexManagedProvider.ts` — All retained fork generation methods continue using protect for authenticated access, scoped execution, and TextGenerationError mapping.
- `apps/server/src/server.ts` — Retained PullRequestServiceLive rather than reverting to layerPullRequestService, preserving the fork’s service binding and shared HTTP/WebSocket caching and invalidation wiring.
- `apps/server/src/server.ts` — Retained the shared ServerBrowser provisioning and the fork’s explicit warning that omitting it prevents HttpRouter.serve from completing startup.
- `apps/server/src/textGeneration/TextGeneration.test.ts` — Retained the generateActivityHeadline test stub supporting Pretty's generated activity headlines.
- `apps/server/src/textGeneration/TextGeneration.test.ts` — Retained the generateHomeSuggestions test stub supporting Pretty's home suggested prompts.
- `apps/server/src/textGeneration/TextGeneration.test.ts` — Retained the generateProjectIcon test stub supporting Pretty's generated project icons.
- `apps/server/src/textGeneration/TextGeneration.test.ts` — Preserved per-test overrides and explicit failures for unconfigured generation methods.
- `apps/server/src/textGeneration/TextGeneration.ts` — ProjectIconGenerationInput and ProjectIconGenerationResult remain exported alongside the unchanged unsupportedProjectIconGeneration export.
- `apps/server/src/textGeneration/TextGeneration.ts` — TextGenerationOp remains derived from ProviderTextGeneration, preserving coverage of fork-specific text-generation methods rather than restricting it to the parent's explicit operation list.
- `apps/server/src/textGeneration/TextGeneration.ts` — The fallback runner's error-classification helper remains available, including missing-instance, authentication, expired-session, and refresh-token failure handling.
- `apps/server/src/textGeneration/TextGeneration.ts` — Fallback model selection retains the chosen instance and the precedence of per-provider text-generation defaults, per-provider general defaults, and the global text-generation default.
- `apps/server/src/textGeneration/TextGeneration.ts` — Provider snapshot checks continue to exclude unauthenticated or explicitly text-generation-unsupported instances while allowing selection when snapshot retrieval fails.
- `apps/web/src/routes/_chat.pull-requests.tsx` — Retain data-pull-requests-column on the mounted list root, preserving the Pretty styling and behavior hook.
- `apps/web/src/routes/_chat.pull-requests.tsx` — Keep the flat bg-background surface and existing header, chrome-fade, search, and filter wiring unchanged.
- `packages/contracts/src/rpc.ts` — Retained the fork-added ProviderInstanceEnvironment dependency in the RPC contracts, alongside ProviderInstanceId and ProviderInstanceMutation, without changing its name or source.
- `packages/provider-acp-registry/src/server/driver.ts` — Preserved generateActivityHeadline with its operation-specific TextGenerationError for ACP Registry instances.
- `packages/provider-acp-registry/src/server/driver.ts` — Preserved generateHomeSuggestions with its operation-specific TextGenerationError for ACP Registry instances.
- `packages/provider-acp-registry/src/server/driver.ts` — Preserved generateProjectIcon with its operation-specific TextGenerationError for ACP Registry instances.
- `packages/provider-core/src/server/textGeneration.ts` — Preserves T3 Pretty's removal of the redundant TextGenerationError type-only import, leaving the existing value import unchanged.
- `packages/provider-core/src/server/textGeneration.ts` — Live activity headline generation retains its provider entry point, raw summary, optional command and detail context, model selection, and empty-headline result semantics.
- `packages/provider-core/src/server/textGeneration.ts` — Home suggested-prompt generation retains its provider entry point, workspace digest, separate project and explore counts and card kinds, previous titles, project keys, prompts, and model selection.
- `packages/provider-core/src/server/textGeneration.ts` — Project icon generation retains its provider entry point, project title, output path, model selection, and returned path; the adjacent unsupported-image-generation error helper remains unchanged.
- `packages/provider-core/src/server/textGeneration.ts` — The shared provider documentation continues to explicitly include Pretty generation.
- `packages/provider-core/src/server/textGenerationOperations.ts` — Activity-headline generation remains exposed through the returned service, with summary, command, and detail prompt inputs, working-directory and model selection forwarding, named tracing, and headline sanitization.
- `packages/provider-core/src/server/textGenerationOperations.ts` — Home-suggestion generation remains exposed through the returned service, preserving context, project and exploration counts, previous-title inputs, working-directory and model selection forwarding, and the generated suggestions response.
- `packages/provider-core/src/server/textGenerationOperations.ts` — The generateProjectIcon unsupported-operation handler remains exposed with its existing provider-name normalization.
- `packages/provider-core/src/server/textGenerationPrompts.test.ts` — Retains the fork-added buildProjectIconPrompt import used by project-icon prompt tests.
- `packages/provider-grok/src/server/textGeneration.ts` — Grok project-icon generation remains exposed through generateProjectIcon, using the requested working directory, model selection, project title, and output path.
- `packages/provider-grok/src/server/textGeneration.ts` — Project-icon generation retains its direct runGrokJson execution, returned-path trimming, and fallback to the requested output path when the generated path is empty.
- `packages/provider-muse/src/server/textGeneration.ts` — Retained the TextGenerationOperations namespace required by T3 Pretty's centralized text-generation operation call sites.
- `packages/provider-muse/src/server/textGeneration.ts` — Preserved the fork's provider-core import refactor rather than restoring the direct prompt-builder and sanitizer imports removed from BASE.
- `packages/provider-muse/src/server/textGeneration.ts` — Retained toJsonSchemaObject for schema conversion.
- `packages/provider-muse/src/server/textGeneration.ts` — Retains T3 Pretty's TextGenerationOperations.fromRunner architecture, including its supplied operations, rather than reverting to the BASE's individually duplicated wrappers.
- `packages/provider-muse/src/server/textGeneration.ts` — Keeps the shared operations wired to the existing runMuseJson runner, preserving Muse enablement checks, model and reasoning selection, structured-output validation, scoped read-only execution, and timeout handling.
- `packages/provider-opencode/src/server/textGeneration.ts` — Retain generateActivityHeadline in the OpenCode operation schema and associated error contexts, preserving support for the fork's generated activity headlines.
- `packages/provider-opencode/src/server/textGeneration.ts` — Retain generateHomeSuggestions in the OpenCode operation schema and associated error contexts, preserving support for the fork's home-suggestion generation.
- `packages/provider-opencode/src/server/textGeneration.ts` — Retain generateProjectIcon in the OpenCode operation schema and associated error contexts, preserving support for the fork's project-icon generation.
- `packages/shared/src/serverSettings.ts` — Home suggestions retain their dedicated model-selection patch handling, replacing the saved selection when explicitly supplied and leaving it unchanged when omitted.

## Parent changes integrated at conflict boundaries

- `apps/server/src/git/GitManager.test.ts` — Added generateReviewGuide to the fake implementation with the parent's empty-stops default and existing override support.
- `apps/server/src/git/GitManager.test.ts` — Exposed generateReviewGuide through the returned TextGeneration service using the parent's direct input-forwarding delegation.
- `apps/server/src/persistence/Migrations.ts` — Added the static import and executable manifest registration for 061_PullRequestReviewGuides.ts. It runs as Pretty migration 75, after all existing migrations, rather than overwriting the occupied migration 61.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — PullRequestReviewGuides is included in the expected successful retry, with an explicit assertion that the fork manifest contains exactly one such migration.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — The existing complete-ledger comparison also checks the review-guide migration as part of the shipped-ledger upgrade, without assuming the parent's numbering.
- `apps/server/src/provider/Drivers/CodexManagedProvider.ts` — Added managed Codex generateReviewGuide delegation to nativeGeneration.generateReviewGuide, with the same authenticated-access, scope, and error protections as the other generation methods.
- `apps/server/src/server.ts` — Integrated the clarification that the shared pull-request service is provided after the review-guide service so it also supplies the guides; retained that ordering using the fork’s PullRequestServiceLive binding.
- `apps/server/src/textGeneration/TextGeneration.test.ts` — Added the parent's generateReviewGuide default test stub alongside the fork-specific methods.
- `apps/server/src/textGeneration/TextGeneration.ts` — ReviewGuideGenerationInput and ReviewGuideGenerationResult are exported from the server text-generation module.
- `apps/server/src/textGeneration/TextGeneration.ts` — The new generateReviewGuide operation is covered by keyof ProviderTextGeneration, composing the parent's operation-type extension with Pretty's broader operation typing.
- `apps/web/src/routes/_chat.pull-requests.tsx` — Make the list relinquish its width with w-0 flex-none when maximizedAway is true, and restore flex-1 when it is false.
- `apps/web/src/routes/_chat.pull-requests.tsx` — Apply overflow-x-hidden to contain horizontal overflow in the pull-request list column.
- `packages/contracts/src/rpc.ts` — Added PullRequestReviewGuideResult from ./pullRequestReviewGuide.ts, preserving the parent's new review-guide result dependency.
- `packages/provider-acp-registry/src/server/driver.ts` — Added generateReviewGuide to the ACP Registry unsupported text-generation implementation, preserving the parent's API addition and explicit error behavior.
- `packages/provider-core/src/server/textGeneration.ts` — Adds the parent's PullRequestReviewGuide contract type import.
- `packages/provider-core/src/server/textGeneration.ts` — Review-guide input preserves read-only checkout intent, change identity and author description, base branch and commit, settled review context, optional maintainer instructions, and model selection.
- `packages/provider-core/src/server/textGeneration.ts` — Stack-aware review-guide context includes layer numbers, nullable titles and fetched head SHAs, and open, closed, or merged states.
- `packages/provider-core/src/server/textGeneration.ts` — Review-guide results derive from PullRequestReviewGuide while leaving headSha, generatedAt, and modelSelection to the server.
- `packages/provider-core/src/server/textGeneration.ts` — ProviderTextGeneration exposes generateReviewGuide alongside every existing Pretty generation method.
- `packages/provider-core/src/server/textGenerationOperations.ts` — Added and exposed generateReviewGuide with its named Effect span, review-guide prompt construction, working-directory and model selection forwarding, investigation timeout, and direct runner result.
- `packages/provider-core/src/server/textGenerationPrompts.test.ts` — Adds the upstream buildReviewGuidePrompt import alongside the fork import, supporting review-guide prompt tests.
- `packages/provider-grok/src/server/textGeneration.ts` — Shared Grok text-generation operations now use TextGenerationOperations.withoutInvestigation("Grok", runGrokJson) through fromRunner, as introduced by the parent.
- `packages/provider-muse/src/server/textGeneration.ts` — Added the investigationUnsupported named import introduced by the parent, making it available to upstream unsupported-investigation handling.
- `packages/provider-muse/src/server/textGeneration.ts` — Adds the typed generateReviewGuide handler and upstream's investigationUnsupported("generateReviewGuide", "Muse Code") failure, reflecting Muse's inability to investigate a checkout from its empty read-only directory.
- `packages/provider-opencode/src/server/textGeneration.ts` — Add the parent's generateReviewGuide operation to the OpenCode operation schema and associated error contexts.
- `packages/shared/src/serverSettings.ts` — Review guide model-selection patches explicitly replace the saved selection when supplied, alongside the fork's home suggestions selection.

## Parent changes intentionally omitted

- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — Restoration of the parent preview-seeded upgrade test body in place of Pretty's shipped-ledger test.. Reason: Relative to BASE, Pretty deliberately replaced this test body with shipped-ledger compatibility coverage. Retain that fork intent; the new parent review-guide expectation is incorporated into the manifest-based retry test instead.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — Literal parent migration-number expectations 53, 54, and 56–61, including ID 61 for PullRequestReviewGuides.. Reason: These cannot replace Pretty's shipped numbering. ID 61 lies within the ledger range that Pretty explicitly retains unchanged; the review-guide expectation uses its migrationManifest entry instead.

## Post-merge repairs

- `web-typecheck` failed after merging `v0.0.46-nightly.20261011.2980`; repaired with `gpt-6.1-sol`: Adapt all failing guide call sites to the environment-scoped review API and make the shared highlighter literal non-widening, addressing all six reported errors. Preserve guide rendering, comment subscriptions, and fork behavior while leaving suggestions and unrelated code unchanged.
  - edited `apps/web/src/components/pullRequest/PullRequestGuideTab.tsx`
  - edited `apps/web/src/components/pullRequest/guide/guideRunStore.ts`
  - edited `apps/web/src/components/pullRequest/guide/useGuideDiffFiles.ts`
  - edited `apps/web/src/lib/syntaxHighlighting.ts`
