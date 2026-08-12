# T3 Pretty parent sync and desktop releases

T3 Pretty treats GitHub `main` as the only release source of truth. It does not rebuild or merge
source code on installed machines.

## Flow

1. `T3 Pretty Upstream Sync` runs every four hours at 00:00, 04:00, 08:00, 12:00, 16:00,
   and 20:00 UTC. Each check finds the newest `pingdotgg/t3code` nightly tag. Maintainers can use
   the manual dispatch only when an operational fix needs an immediate retry.
2. It merges that tag into an `automation/upstream-*` branch and opens a pull request. The fork
   deliberately keeps `.github/workflows` from its own `main`; upstream workflow changes cannot
   replace the trusted sync/release boundary or require a personal token with workflow scope.
3. Clean changes remain untouched and do not make a model request. If Git reports text conflicts,
   the workflow asks the Railway CLIProxyAPI `gpt-5.6-sol` model to resolve each file with `xhigh`
   reasoning. Its preservation contract treats T3 Pretty and other fork-specific behavior as
   authoritative, integrates compatible parent improvements around it, and keeps the smallest
   T3 Pretty side when both intents genuinely cannot coexist. One exception: if the parent later
   ships a first-party implementation of a feature T3 Pretty added as fork-only (for example a
   native mobile pull-request manager), the resolver replaces the fork copy with the parent
   version and re-applies only Pretty branding.
4. Every sync commits `.t3-fork/upstream-sync-report.md`. It identifies T3 Pretty behavior
   preserved at conflict boundaries, compatible parent behavior integrated there, and every
   parent change intentionally omitted to protect T3 Pretty. Fork-owned parent workflow changes
   are enumerated as omissions too. The report is copied into the sync pull request and every
   T3 Pretty desktop release note, so an omission cannot exist only in a transient Actions log.
5. The workflow dispatches the normal fork CI on the result and merges the pull request only after
   every required check passes. It publishes the four required commit statuses with links to that
   exact run because GitHub suppresses normal push-triggered checks for `GITHUB_TOKEN` automation.
   Unsafe, binary, oversized, uncertain, or test-failing changes stop and create an issue pointing
   to the failed run.
6. Every commit merged to `main`, whether from the parent sync or a T3 Pretty pull request,
   starts its own `T3 Pretty Desktop Release`. Release runs are not collapsed through a workflow
   concurrency group: the dedicated runners queue every main commit, and the GitHub run number
   makes each fork version unique even when multiple releases overlap.
7. Before building, the release preflight runs `scripts/fork/generate-changelog.mjs`, which asks
   the Railway CLIProxyAPI model (`gpt-5.6-sol`, `high` reasoning by default) to write one What's
   New entry per shipped fork build — the fork's own commits plus the parent nightly window —
   for every build still missing an entry, then commits and pushes `changelogData.ts` with the
   workflow `GITHUB_TOKEN`. That push only happens for runs triggered by `main` itself and only
   when the triggering commit is still the `main` tip, so a manual dispatch of another ref cannot
   move `main`, and it does not retrigger the workflow. The build and publish jobs check out the
   pushed changelog commit, so each release ships its own notes; the already-released skip check
   recognizes the tagged changelog child of the triggering commit, so re-running a completed
   Actions run stays a no-op. Generation failures downgrade to warnings: the release ships
   without new entries and the next run regenerates everything missing.
8. `m1-dev-t3code-fork` builds macOS arm64 and x64. `windows-5080-t3code-fork` builds Windows
   x64. Only trusted `main` commits run on these self-hosted machines; pull requests use GitHub-
   hosted runners.
9. GitHub publishes a public prerelease with the installers, blockmaps, and `nightly` update
   manifests. Packaged fork apps point `electron-updater` at
   `SergeSerb2/t3-pretty`, so no per-machine GitHub token is required.

Fork versions retain the newest integrated upstream nightly prefix and append a monotonic fork
build number. This makes personal merges newer than the parent build without pretending that a
newer upstream tag was integrated before its sync pull request merged.

## Required repository configuration

- Secret `CLI_PROXY_API_KEY`: Railway CLIProxyAPI bearer token used by the trusted scheduled
  sync workflow for conflict resolution and by the release preflight for What's New changelog
  generation. `CLI_PROXY_CHANGELOG_EFFORT` optionally overrides the changelog reasoning effort
  (default `high`).
- Secret `FORK_RELEASE_TOKEN`: GitHub credential with repository Contents write access, stored as
  a repository Actions secret. It is exposed only to the trusted `main` publishing step; GitHub's
  own CLI creates the release and uploads its assets without handing this credential to a
  third-party action. Prefer replacing the bootstrap OAuth token with a fine-grained token limited
  to this repository.
- `Check`, `Test`, `Mobile Native Static Analysis`, and `Release Smoke` required on `main`.
- Dedicated runner labels:
  - macOS: `self-hosted`, `macOS`, `ARM64`, `t3code-fork`, `release-only`
  - Windows: `self-hosted`, `Windows`, `X64`, `t3code-fork`, `release-only`

For unattended macOS installation, configure `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`,
`APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `MACOS_PROVISIONING_PROFILE`, `APPLE_TEAM_ID`, and the
Clerk passkey variables used by the upstream build. Without them, the workflow deliberately marks
the macOS artifact as unsigned; it can be downloaded manually, but macOS `electron-updater` cannot
reliably install it. Windows signing is optional for updater mechanics but should use the existing
Azure Trusted Signing secret names before broad distribution.

## Runner recovery

The macOS runner lives at `/Users/m1-dev/actions-runner-t3code-fork` and runs as the LaunchAgent
`actions.runner.SergeSerb2-t3code-fork-theme.m1-dev-t3code-fork`.

The Windows runner lives at `C:\actions-runner-t3code-fork` and runs as the Windows service
`actions.runner.SergeSerb2-t3code-fork-theme.windows-5080-t3code-fork`. The checked-in
`scripts/fork/setup-windows-runner.ps1` can recreate it using a fresh short-lived registration
token at `C:\dev\t3-runner-token.json`; the script deletes that token before configuration.

Do not expose either release runner to `pull_request` jobs. Disable a runner service first if a
release workflow ever begins executing an untrusted ref.

## Retiring the old machine-local updater

Disable the old launchd and Windows scheduled updater after a public fork release, its checksums,
manifests, and packaged `app-update.yml` have been verified. Preserve the plist files, scripts, and
scheduled-task definitions for rollback. An existing installation without `app-update.yml` needs a
one-time manual install of the fork release; do not leave a legacy staged installer active while
waiting for that bootstrap because it can replace the app with an older local build.
