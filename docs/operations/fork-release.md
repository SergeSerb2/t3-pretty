# T3 Pretty parent sync and desktop releases

T3 Pretty treats Cursor Origin `main` (`serbinenko/t3-pretty`) as the only release source of
truth. It does not rebuild or merge source code on installed machines. Parent T3 Code nightlies
still come from GitHub (`pingdotgg/t3code`); that is someone else's repository.

## Flow

1. `T3 Pretty Upstream Sync` runs every four hours at 00:00, 04:00, 08:00, 12:00, 16:00,
   and 20:00 UTC. Each check finds the newest `pingdotgg/t3code` nightly tag. Maintainers can use
   the manual dispatch only when an operational fix needs an immediate retry.
2. It merges that tag into an `automation/upstream-*` branch and opens an Origin pull request.
   The fork deliberately keeps `.github/workflows` from its own `main`; upstream workflow changes
   cannot replace the trusted sync/release boundary.
3. Clean changes remain untouched and do not make a model request. If Git reports text conflicts,
   the workflow asks the Railway CLIProxyAPI `gpt-5.6-sol` model to resolve each file with `xhigh`
   reasoning, in batches of at most five conflicts per request so a heavily conflicted file cannot
   turn into one long-running call that the proxy times out. A batch whose edit set fails
   validation (a non-unique or missing `old_text`) is requested once more before the run gives
   up, and every completed file is checkpointed to the `automation/sync-resolution-cache` branch
   even when the run fails, so a rerun resumes where it stopped instead of re-resolving finished
   files. Modify/delete conflicts resolve
   through the same contract, presented as one whole-file conflict against an empty deleted side;
   an empty resolution follows the deletion (the usual outcome when the parent's refactor removes
   a file the fork only tracked). Its preservation contract treats T3 Pretty and other
   fork-specific behavior as
   authoritative, integrates compatible parent improvements around it, and keeps the smallest
   T3 Pretty side when both intents genuinely cannot coexist. One exception: if the parent later
   ships a first-party implementation of a feature T3 Pretty added as fork-only (for example a
   native mobile pull-request manager), the resolver replaces the fork copy with the parent
   version and re-applies only Pretty branding. Generated lockfiles are the one path the model
   never sees: a conflicted `pnpm-lock.yaml` takes the parent nightly's copy, and the workflow
   then regenerates it against the merged package manifests, which re-derives the fork-only
   dependency entries.
4. Every sync commits `.t3-fork/upstream-sync-report.md`. It identifies T3 Pretty behavior
   preserved at conflict boundaries, compatible parent behavior integrated there, and every
   parent change intentionally omitted to protect T3 Pretty. Fork-owned parent workflow changes
   are enumerated as omissions too. The report is copied into the sync pull request and every
   T3 Pretty desktop release note, so an omission cannot exist only in a transient Actions log.
5. The workflow merges the Origin pull request once Origin reports it mergeable. Parent CI is
   disabled on this fork, so sync does not wait on Check, Test, Mobile Native Static Analysis, or
   Release Smoke. Unsafe, binary, oversized, or uncertain resolver results still stop and open an
   Origin pull request titled `Upstream sync blocked: <tag>` with the failure notes.
6. Every commit merged to `main`, whether from the parent sync or a T3 Pretty pull request,
   starts its own `T3 Pretty Desktop Release`. Release runs are not collapsed through a workflow
   concurrency group: the dedicated runners queue every main commit, and the CI run number
   makes each fork version unique even when multiple releases overlap.
7. Before building, the release preflight runs `scripts/fork/generate-changelog.mjs`, which asks
   the Railway CLIProxyAPI model (`gpt-5.6-sol`, `high` reasoning by default) to write one What's
   New entry per shipped fork build — the fork's own commits plus the parent nightly window —
   for every build still missing an entry, then commits and pushes `changelogData.ts`. That push
   only happens for runs triggered by `main` itself and only when the triggering commit is still
   the `main` tip, so a manual dispatch of another ref cannot move `main`, and it does not
   retrigger the workflow. The build and publish jobs check out the pushed changelog commit, so
   each release ships its own notes; the already-released skip check recognizes the tagged
   changelog child of the triggering commit, so re-running a completed run stays a no-op.
   Generation failures downgrade to warnings: the release ships without new entries and the next
   run regenerates everything missing.
8. Origin-connected Linux CI (Depot or Buildkite, `ubuntu-latest` in the workflow YAML) resolves
   the version, writes What's New notes, compiles the WSL `node-pty` binary, and publishes the
   Origin tag plus updater assets. `m1-dev-t3code-fork` only signs the macOS arm64 DMG.
   `windows-5080-t3code-fork` builds Windows x64. iOS TestFlight IPAs still compile on a
   self-hosted Mac through `fork-mobile-release.yml`. Only trusted `main` commits run on the
   self-hosted machines; pull requests do not. iOS store binaries cannot compile on Windows.
   Desktop packaging is skipped when the push cannot change the shipped desktop app (mobile-only,
   docs-only, marketing, or relay-only commits). `workflow_dispatch` and the upstream-sync
   dispatch still always run.
9. The publisher creates an annotated Origin git tag and uploads the installers plus both
   `nightly` and `latest` update manifests to the generic `electron-updater` feed in
   `T3CODE_DESKTOP_UPDATE_FEED_URL`. Origin has no GitHub-style release-asset API, so that feed
   is an S3-compatible bucket (Cloudflare R2 is the intended host; the relay already uses
   Cloudflare). Multi-range requests stay disabled. Already-installed GitHub-provider builds need
   one manual install of a release that contains this feed before later updates can be automatic.
   Windows ships even when Azure Trusted Signing is not configured; unsigned NSIS installers
   still update from that feed, and SmartScreen will warn until ATS secrets are added.

Fork versions retain the newest integrated upstream nightly prefix and append a monotonic fork
build number. This makes personal merges newer than the parent build without pretending that a
newer upstream tag was integrated before its sync pull request merged.

## Required repository configuration

- Detach `serbinenko/t3-pretty` from GitHub under Origin **Settings → General**. Depot and
  Buildkite only run on Origin-hosted repositories, not inbound GitHub mirrors. After detach,
  Origin is the source of truth and pushes no longer flow to GitHub.
- Connect Buildkite from the Origin repository **Apps** tab. `.buildkite/pipeline.yml` imports
  the fork workflows. Create three agent queues: `linux-small` (Buildkite hosted Linux),
  `macos-release` (m1-dev), and `windows-release` (serge-pc). Register the machines with
  `scripts/fork/setup-buildkite-macos-agent.sh` and
  `scripts/fork/setup-buildkite-windows-agent.ps1`. Schedule the pipeline at `0 */4 * * *`
  so upstream sync still runs. Imported Mac jobs use `macos-latest` so the plugin can map
  them onto `macos-release`. Rust is installed with `rustup`, not `dtolnay/rust-toolchain`.
  The importer cannot run Windows jobs; `.buildkite/pipeline.yml` runs
  `scripts/fork/build-windows-nsis.ps1` on `windows-release` in parallel with the importer.
  Mac-only desktop publishes are still allowed if that step is skipped. Depot can take
  Linux jobs but has no macOS/Windows sandboxes.
- Secret `CURSOR_API_KEY`: Cursor API key for the Origin CLI (`origin auth login --api-key`).
  Used to open, merge, and tag on Origin.
- Secret `CLI_PROXY_API_KEY`: Railway CLIProxyAPI bearer token used by the trusted scheduled
  sync workflow for conflict resolution and by the release preflight for What's New changelog
  generation. `CLI_PROXY_CHANGELOG_EFFORT` optionally overrides the changelog reasoning effort
  (default `high`).
- Variable `T3CODE_DESKTOP_UPDATE_FEED_URL`: public HTTPS directory that serves `nightly.yml`,
  `latest.yml`, and the installers. Must not be a GitHub Releases URL. Uploads use that URL's
  path as the S3 key prefix (so `…/t3-pretty/latest/` stores objects under `t3-pretty/latest/`).
- Secrets `T3CODE_RELEASE_S3_BUCKET`, `T3CODE_RELEASE_S3_ACCESS_KEY_ID`,
  `T3CODE_RELEASE_S3_SECRET_ACCESS_KEY`, and optionally `T3CODE_RELEASE_S3_ENDPOINT` plus
  `T3CODE_RELEASE_S3_REGION`: S3-compatible upload target for that feed (R2 uses the account
  endpoint `https://<accountid>.r2.cloudflarestorage.com`). Optional
  `T3CODE_RELEASE_S3_PREFIX` overrides the key prefix derived from the feed URL. If the
  access-key pair is unset, `origin-forge.mjs` falls back to `wrangler r2 object put --remote`
  using `CLOUDFLARE_API_TOKEN`. The live Buildkite pipeline is
  `https://buildkite.com/serge-serbinenkos-org/t3-pretty`.
- Optional secret `DEPOT_TOKEN`: lets the sync job dispatch follow-up workflows when the Origin
  merge push does not start them. Leave unset if Buildkite already triggers on push to `main`.
- Parent CI (`Check`, `Test`, `Mobile Native Static Analysis`, `Release Smoke`) is disabled on
  this fork. Do not require those checks on `main`.
- Dedicated runner labels:
  - macOS: `self-hosted`, `macOS`, `ARM64`, `t3code-fork`, `release-only`
  - Windows: `self-hosted`, `Windows`, `X64`, `t3code-fork`, `release-only`

For unattended macOS installation, configure `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_API_KEY`,
`APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `MACOS_PROVISIONING_PROFILE`, `APPLE_TEAM_ID`, and the
Clerk passkey variables used by the upstream build. Without them, the workflow deliberately marks
the macOS artifact as unsigned; it can be downloaded manually, but macOS `electron-updater` cannot
reliably install it. Windows signing is optional for updater mechanics: missing Azure Trusted
Signing secrets produce an unsigned NSIS installer and skip Authenticode verification. Add the
existing Azure Trusted Signing secret names before broad distribution if SmartScreen prompts should
go away.

## Machines and expected times

Measured from recent successful runs on the current two runners (2026-08-16):

| Job                         | Where it used to run                  | Typical time                                | Where it runs now                             |
| --------------------------- | ------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| Changelog + version + smoke | m1-dev                                | 10 min (6.5 min model + 3 min install)      | `ubuntu-latest`                               |
| WSL `node-pty` linux-x64    | m1-dev (Docker/`linux/amd64`)         | 1 min, and it blocked the DMG               | `ubuntu-latest` native compile                |
| macOS arm64 DMG             | m1-dev                                | 8 min (3.5 min install + 4 min package)     | m1-dev (or a second Mac with the same labels) |
| Windows x64 NSIS            | serge-pc (`windows-5080-t3code-fork`) | 13 min, plus 3 min uploading the pnpm cache | serge-pc, without the cache upload            |
| Publish Origin release      | m1-dev                                | 5 min (3 min just to install Vite+)         | `ubuntu-latest`                               |
| Relay production deploy     | m1-dev                                | queued behind releases                      | `ubuntu-latest`                               |

A desktop release that used to sit 25–40 minutes in the m1-dev queue and then take ~30 minutes of Mac occupancy should now occupy the Mac for only the ~8 minute signed DMG. Changelog, WSL, and publish no longer wait for — or block — iOS.

### Adding m5-dev

This machine is an M5 Pro (18 cores, 48 GB). m1-dev is the existing dedicated Mac runner. Xcode on M1 recently spent 13 minutes compiling and submitting an IPA; the same compile on an M5 Pro should land around 7–10 minutes. Vite + electron-builder is less parallel, so the DMG itself only drops a minute or two. The real win is overlap: one Mac can sign the DMG while the other compiles iOS.

`scripts/fork/setup-macos-runner.sh` registers a LaunchAgent runner with the same labels as m1-dev. It refuses to register if Xcode.app is missing (Command Line Tools cannot build an IPA). Do not register a daily driver until you are willing to share CPU with release jobs, and never give the runner `pull_request` labels.

## Runner recovery

The macOS runner lives at `/Users/m1-dev/actions-runner-t3code-fork`. After the Origin cutover
it should be a Buildkite agent on the `macos-release` queue, registered with
`scripts/fork/setup-buildkite-macos-agent.sh`. Do not give it pull-request queues.

The Windows runner lives at `C:\actions-runner-t3code-fork`. The checked-in
`scripts/fork/setup-windows-runner.ps1` can still recreate a GitHub Actions runner for rollback.
`scripts/fork/ensure-windows-release-toolchain.ps1` installs Git for Windows and Visual Studio
2022 Build Tools (MSVC x64 + Spectre) when they are missing. A copy lives at
`C:\dev\ensure-windows-release-toolchain.ps1` on the runner host. The release job calls that
script with `-CheckOnly` so a missing toolchain fails before the packager starts.

Do not expose either release runner to `pull_request` jobs. Disable a runner service first if a
release workflow ever begins executing an untrusted ref.

## Retiring the old machine-local updater

Disable the old launchd and Windows scheduled updater after a public fork release, its checksums,
manifests, and packaged `app-update.yml` have been verified. Preserve the plist files, scripts, and
scheduled-task definitions for rollback. An existing installation without `app-update.yml`, or an
older GitHub-provider build, needs a one-time manual install of the fork release; do not leave a
legacy staged installer active while waiting for that bootstrap because it can replace the app
with an older local build.
