# Personal fork sync and desktop releases

The fork treats GitHub `main` as the only release source of truth. It does not rebuild or merge
source code on installed machines.

## Flow

1. `Fork Upstream Sync` runs at the top of every hour and finds the newest
   `pingdotgg/t3code` nightly tag.
2. It merges that tag into an `automation/upstream-*` branch and opens a pull request.
3. Clean changes remain untouched. If Git reports text conflicts, the workflow asks the Railway
   CLIProxyAPI `gpt-5.6-luna` model to resolve each file with max reasoning. The prompt treats fork
   behavior as authoritative while requiring compatible upstream behavior to be retained.
4. The workflow dispatches the normal fork CI on the result and merges the pull request only after
   every required check passes. Unsafe, binary, oversized, uncertain, or test-failing changes stop
   and create an issue pointing to the failed run.
5. Every commit merged to `main`, whether from the upstream sync or a personal pull request,
   starts `Fork Desktop Release`.
6. `m1-dev-t3code-fork` builds macOS arm64 and x64. `windows-5080-t3code-fork` builds Windows
   x64. Only trusted `main` commits run on these self-hosted machines; pull requests use GitHub-
   hosted runners.
7. GitHub publishes a public prerelease with the installers, blockmaps, and `nightly` update
   manifests. Packaged fork apps point `electron-updater` at
   `SergeSerb2/t3code-fork-theme`, so no per-machine GitHub token is required.

Fork versions retain the newest integrated upstream nightly prefix and append a monotonic fork
build number. This makes personal merges newer than the parent build without pretending that a
newer upstream tag was integrated before its sync pull request merged.

## Required repository configuration

- Secret `CLI_PROXY_API_KEY`: Railway CLIProxyAPI bearer token used only by the trusted scheduled
  sync workflow.
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

Disable the old launchd and Windows scheduled updater only after one published fork release
has been downloaded and installed through the in-app updater on each platform. Until that proof,
the local updater remains the rollback path rather than an active source-merging system.
