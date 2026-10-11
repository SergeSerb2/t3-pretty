# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261010.2948`
- Previously integrated parent nightly: `v0.0.46-nightly.20261010.2935`
- Conflict resolver: hand-merge from Origin `main` (`e1fca72bb`)
- 0 file(s) remain on an unresolved fork-side fallback

## T3 Pretty changes preserved at conflict boundaries

- `packages/contracts/src/sourceControl.ts` — Kept Pretty discovery caps and `ChangeRequest.mergedAt` as `Option<Utc>`; adopted the parent's open branded `SourceControlProviderKind`.
- `packages/contracts/src/settings.ts` — Kept Pretty fields (`globalEnvironment`, `legacyQueueEnabled`, scenery, home suggestions, agent monitoring) while adopting `sourceControlHosts` in place of top-level `github`/`bitbucket`.
- `packages/contracts/src/pullRequest.ts` — Kept Origin capability requirements and the fork `Map` comment shape; adopted parent host-agnostic action/capability types.
- `packages/shared/src/sourceControl.ts` — Kept Origin detection, Grok review markers, and Forgejo/GitCafe host rules; branded every kind with `SourceControlProviderKind.make`.
- `packages/client-runtime/src/operations/projects.ts` — Adopted `getNewProjectPublishTargets` / host-definition clone sources; Origin stays in the registry so publish and clone pickers still offer it.
- `packages/client-runtime/src/originSourceControlClient.ts` — New Pretty client definition so Origin survives the parent's per-host registry. GitHub's `/pull/` matcher yields to Origin's `cursor.com/codebase/.../pull/` URLs.
- `apps/server/src/serverSettings.ts` — Adopted parent host-secret slots; kept Pretty bounded `readFilePrefix` reads, write-size cap, and `globalEnvironment` secret hydrate/persist.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — Kept multi-server MCP via `T3_CODE_MCP_AUTHORIZATION` while adopting parent timeout and read-only tool lists.
- `apps/server/src/server.ts` — Kept `ReviewLayerLive` / `ProjectStore.layer` wiring required by Pretty review.
- `apps/mobile/src/Stack.tsx` and settings sheet targets — Kept Pretty Microphone settings; adopted parent source-control host presentation.
- `apps/mobile/src/persistence/mobile-preferences.ts` — Kept `legacyQueueEnabled` (Follow-ups stay removed) and adopted parent microphone priority.
- `docs/user/composer.md` — Kept T3 Pretty microphone docs while adopting parent composer wording.

## Parent changes integrated at conflict boundaries

- Source control provider kind is an open branded slug, not a closed literal union.
- Each host package ships a client definition; clone, publish, checkout, and presentation read that registry.
- New projects can be published to any ready host (`getNewProjectPublishTargets`).
- Host settings live under `settings.sourceControlHosts` (GitCafe token and GitHub tokens included); retired top-level `github`/`bitbucket` keys migrate on load.
- Quick actions and reference parsing follow each host's capabilities.
- Mobile microphone order for voice input.
- Diffs for projects outside the server cwd; Claude MCP servers on the control channel; native subagent stop without stopping the owner.

## Parent changes intentionally omitted

- Follow-ups / Settings Follow-up UI. Pretty keeps `legacyQueueEnabled` and steering as the default.
- GitHub-only `getNewProjectGitHubTarget`. Replaced by the parent registry, with Origin registered as a first-class host.

## Post-merge repairs

- Register Origin in `sourceControlClients` and wrap GitHub's change-request URL matcher so `cursor.com/codebase/.../pull/` is not attributed to GitHub.
- Brand Origin server `kind`/`provider` fields with `SourceControlProviderKind.make("origin")`.
- Restore Pretty `globalEnvironmentSecretName` and bounded settings-file reads on top of the parent's host-secret model.
