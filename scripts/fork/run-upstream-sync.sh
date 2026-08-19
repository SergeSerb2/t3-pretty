#!/usr/bin/env bash
# Integrate the newest pingdotgg/t3code nightly into T3 Pretty and land it
# on Origin main. The four-hour Buildkite schedule runs this as a native
# macos-release step. The imported GHA wrapper calls the same script so a
# manual workflow_dispatch cannot drift.
#
# Do not write GITHUB_OUTPUT. The macos-release importer often omits that
# file, and `set -u` then killed every scheduled sync in discover.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

. scripts/fork/macos-ci-prelude.sh
. scripts/fork/load-buildkite-secrets.sh CURSOR_API_KEY CLI_PROXY_API_KEY

# Fail instead of hanging if Origin HTTPS cannot load credentials.
export GIT_TERMINAL_PROMPT="${GIT_TERMINAL_PROMPT:-0}"

RESOLUTION_CACHE_BRANCH="${RESOLUTION_CACHE_BRANCH:-automation/sync-resolution-cache}"
UPSTREAM_URL="https://github.com/pingdotgg/t3code.git"
ORIGIN_REPO="${ORIGIN_REPO:-serbinenko/t3-pretty}"
export CLI_PROXY_API_URL="${CLI_PROXY_API_URL:-https://cli-proxy-api-production-1615.up.railway.app/v1}"
export CLI_PROXY_MODEL="${CLI_PROXY_MODEL:-gpt-5.6-sol}"
export CLI_PROXY_REASONING_EFFORT="${CLI_PROXY_REASONING_EFFORT:-xhigh}"
export CLI_PROXY_SERVICE_TIER="${CLI_PROXY_SERVICE_TIER:-priority}"

CACHE_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
CACHE_ROOT="${CACHE_ROOT%/}"
export SYNC_RESOLUTION_CACHE_DIR="${SYNC_RESOLUTION_CACHE_DIR:-${CACHE_ROOT}/sync-resolution-cache}"
mkdir -p "$SYNC_RESOLUTION_CACHE_DIR"

git config user.name "t3-pretty-sync[bot]"
git config user.email "t3-pretty-bot@users.noreply.cursor.com"

# macos-release reuses the workspace. A previous sync leaves `upstream`
# in .git/config, and `git remote add` then exits 1 before the merge
# starts (~2s red job).
if git remote get-url upstream >/dev/null 2>&1; then
  git remote set-url upstream "$UPSTREAM_URL"
else
  git remote add upstream "$UPSTREAM_URL"
fi
# Parent history stays on GitHub. The fork remote is Origin.
# The checkout is a blob:none partial clone, and some blobs the
# merge needs (e.g. .repos/ subtrees bumped by a nightly) exist
# only in the upstream repo; the fork promisor answers "not our
# ref" for those and the merge dies before it starts. Registering
# upstream as a second promisor remote lets git backfill missing
# objects from the remote that actually has them.
git config remote.upstream.promisor true
git config remote.upstream.partialclonefilter blob:none

if git rev-parse --is-shallow-repository >/dev/null 2>&1 &&
  [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
  git fetch --unshallow origin || git fetch --update-shallow origin main
fi
git fetch origin main
git checkout --force -B main origin/main

latest_tag="$({
  git ls-remote --tags --refs upstream 'refs/tags/v*-nightly.*' |
    awk '{sub("refs/tags/", "", $2); print $2}' |
    sort -V |
    tail -n 1
})"
if [[ -z "$latest_tag" ]]; then
  echo "No upstream nightly tag found." >&2
  exit 1
fi

git fetch --no-tags upstream "refs/tags/$latest_tag:refs/tags/$latest_tag"
current_tag=""
if [[ -f .t3-fork/upstream-nightly ]]; then
  current_tag="$(tr -d '[:space:]' < .t3-fork/upstream-nightly)"
fi
# The resolver uses previous_tag..origin/main to recover the fork's
# intent for conflicted paths. Fresh clones do not have the
# previous tag ref even though its commit is in main's history.
if [[ -n "$current_tag" && "$current_tag" != "$latest_tag" ]]; then
  git fetch --no-tags upstream "refs/tags/$current_tag:refs/tags/$current_tag"
fi

export UPSTREAM_TAG="$latest_tag"
export PREVIOUS_UPSTREAM_TAG="$current_tag"
export REUSED_SYNC_RESOLUTION=false
has_update=0

if [[ "$current_tag" == "$latest_tag" ]] &&
  git merge-base --is-ancestor "$latest_tag^{commit}" HEAD; then
  echo "Fork already contains $latest_tag."
  exit 0
fi

branch="automation/upstream-${latest_tag//[^0-9A-Za-z._-]/-}"
export SYNC_BRANCH="$branch"
has_update=1

checkpoint_resolutions() {
  shopt -s nullglob
  local entries=("$SYNC_RESOLUTION_CACHE_DIR"/*.json)
  if (( ${#entries[@]} == 0 )); then
    echo "No completed resolutions to checkpoint."
    return 0
  fi
  git fetch origin "refs/heads/$RESOLUTION_CACHE_BRANCH:refs/remotes/origin/$RESOLUTION_CACHE_BRANCH" 2>/dev/null || true
  local index_file="${CACHE_ROOT}/sync-resolution-cache-index"
  rm -f "$index_file"
  local GIT_INDEX_FILE="$index_file"
  export GIT_INDEX_FILE
  local parent_args=()
  if git rev-parse -q --verify "origin/$RESOLUTION_CACHE_BRANCH" >/dev/null 2>&1; then
    git read-tree "origin/$RESOLUTION_CACHE_BRANCH"
    parent_args=(-p "origin/$RESOLUTION_CACHE_BRANCH")
  fi
  local entry blob
  for entry in "${entries[@]}"; do
    blob="$(git hash-object -w "$entry")"
    git update-index --add --cacheinfo 100644 "$blob" "$(basename "$entry")"
  done
  local tree
  tree="$(git write-tree)"
  unset GIT_INDEX_FILE
  if (( ${#parent_args[@]} > 0 )) &&
    [[ "$(git rev-parse "origin/$RESOLUTION_CACHE_BRANCH^{tree}")" == "$tree" ]]; then
    echo "Resolution cache already holds these entries."
    return 0
  fi
  local commit
  commit="$(git commit-tree "$tree" ${parent_args[@]+"${parent_args[@]}"} -m "chore(sync): checkpoint conflict resolutions")"
  git push origin "$commit:refs/heads/$RESOLUTION_CACHE_BRANCH"
  echo "Checkpointed ${#entries[@]} resolution(s) to $RESOLUTION_CACHE_BRANCH."
}

report_blocked() {
  node scripts/fork/origin-forge.mjs setup-ci
  local body="The guarded four-hour T3 Pretty sync could not safely merge $UPSTREAM_TAG. Inspect the failed Origin-connected CI run for this commit."
  node scripts/fork/origin-forge.mjs report-blocked \
    --upstream-tag "$UPSTREAM_TAG" \
    --title "Upstream sync blocked: $UPSTREAM_TAG" \
    --body "$body"
}

on_exit() {
  local status=$?
  trap - EXIT
  if [[ "$has_update" == 1 ]]; then
    checkpoint_resolutions || true
    if (( status != 0 )); then
      report_blocked || true
    fi
  fi
  exit "$status"
}
trap on_exit EXIT

if git fetch origin "refs/heads/$SYNC_BRANCH:refs/remotes/origin/$SYNC_BRANCH" 2>/dev/null &&
  [[ "$(git show "origin/$SYNC_BRANCH:.t3-fork/upstream-nightly" 2>/dev/null | tr -d '[:space:]')" == "$UPSTREAM_TAG" ]] &&
  git merge-base --is-ancestor "$UPSTREAM_TAG^{commit}" "origin/$SYNC_BRANCH" &&
  [[ "$(git show "origin/$SYNC_BRANCH:.t3-fork/upstream-sync-report.md" 2>/dev/null | sed -n '1p')" == "# T3 Pretty upstream integration report" ]]; then
  echo "Reusing the previously validated AI resolution for $UPSTREAM_TAG."
  export REUSED_SYNC_RESOLUTION=true
  git checkout -B "$SYNC_BRANCH" "origin/$SYNC_BRANCH"
  set +e
  git merge --no-edit origin/main
  merge_status=$?
  set -e
else
  git checkout -B "$SYNC_BRANCH" origin/main
  set +e
  git merge --no-ff --no-commit "$UPSTREAM_TAG"
  merge_status=$?
  set -e
fi

# The fork owns its release and security automation. Keep those files
# pinned to fork main instead of allowing an upstream tag to rewrite
# workflows or requiring a broadly scoped personal token.
git restore --source=origin/main --staged --worktree -- .github/workflows

# bash 3.2 (/bin/bash on macos-release) has no `mapfile`.
resolver_paths=()
while IFS= read -r -d '' path; do
  resolver_paths+=("$path")
done < <(git diff --name-only --diff-filter=U -z)
if (( ${#resolver_paths[@]} == 0 )) && (( merge_status != 0 )) &&
  ! git rev-parse -q --verify MERGE_HEAD >/dev/null; then
  echo "Merge failed without producing resolvable conflicts." >&2
  exit "$merge_status"
fi
# Always write the durable integration report. Clean merges make no
# model request; conflict merges use Sol/xhigh and record every
# parent change intentionally omitted to protect T3 Pretty.
# Restore checkpointed per-file resolutions first: a run that failed
# or timed out mid-merge reruns only the files that never finished.
if git fetch origin "refs/heads/$RESOLUTION_CACHE_BRANCH:refs/remotes/origin/$RESOLUTION_CACHE_BRANCH" 2>/dev/null; then
  git archive "origin/$RESOLUTION_CACHE_BRANCH" | tar -x -C "$SYNC_RESOLUTION_CACHE_DIR"
fi
node scripts/fork/resolve-git-conflicts.mjs

# The resolver side-picks a conflicted generated lockfile instead of
# AI-splicing it. Reconcile that copy with the merged package
# manifests so the committed lockfile actually installs (the runner
# sets CI=true, which would force a frozen lockfile, so opt out).
if printf '%s\n' "${resolver_paths[@]}" | grep -qx "pnpm-lock.yaml"; then
  corepack enable
  corepack pnpm install --lockfile-only --no-frozen-lockfile
  git add pnpm-lock.yaml
fi

if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
  echo "Unresolved merge conflicts remain." >&2
  exit 1
fi

mkdir -p .t3-fork
printf '%s\n' "$UPSTREAM_TAG" > .t3-fork/upstream-nightly
git add .t3-fork/upstream-nightly
# Whitespace-guard only the file this workflow writes itself.
# Resolver-composed content is model output; upstream content is a
# trusted release. `git diff --check` would reject a model-emitted
# blank line at EOF after the entire merge succeeded, so it must
# not gate either.
git diff --check --cached -- .t3-fork/upstream-nightly

if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
  git commit -m "chore(sync): merge upstream $UPSTREAM_TAG"
elif ! git diff --cached --quiet; then
  git commit -m "chore(sync): record upstream $UPSTREAM_TAG"
else
  echo "Nothing changed after resolving $UPSTREAM_TAG."
fi

remote_head="$(git rev-parse -q --verify "origin/$SYNC_BRANCH" 2>/dev/null || true)"
if [[ "$(git rev-parse HEAD)" == "$remote_head" ]]; then
  echo "$SYNC_BRANCH is already current."
else
  git push --force-with-lease origin "HEAD:refs/heads/$SYNC_BRANCH"
fi

node scripts/fork/origin-forge.mjs setup-ci
pr_body_path="${CACHE_ROOT}/t3-pretty-upstream-sync.md"
{
  printf '%s\n\n' \
    'Automated four-hour integration of the newest parent T3 Code nightly into T3 Pretty.' \
    'Clean merges are retained directly. Text conflicts are resolved through CLIProxyAPI with gpt-5.6-sol at xhigh reasoning under the T3 Pretty preservation contract.'
  cat .t3-fork/upstream-sync-report.md
} > "$pr_body_path"
node scripts/fork/origin-forge.mjs ensure-pr \
  --base main \
  --head "$SYNC_BRANCH" \
  --title "chore(sync): merge upstream $UPSTREAM_TAG" \
  --body-file "$pr_body_path"

mobile_release_needed=false
if ! git diff --quiet origin/main...HEAD -- \
  apps/mobile \
  packages \
  patches \
  pnpm-lock.yaml \
  scripts/fork/publish-mobile-release.sh \
  scripts/fork/resolve-ios-native-build.mjs \
  scripts/fork/security-eas-local-keychain; then
  mobile_release_needed=true
fi

head_sha="$(git rev-parse HEAD)"
node scripts/fork/origin-forge.mjs merge-pr --head "$SYNC_BRANCH" --sha "$head_sha"
node scripts/fork/origin-forge.mjs delete-branch --head "$SYNC_BRANCH"

# Dispatch desktop preflight if the merge push is missed. Mobile no
# longer has an imported workflow; if this integration changed
# mobile paths, publish from this macos-release job. The script
# flocks /tmp/t3-pretty-ios-mobile.lock so a follow-up ios-mobile
# push job cannot overlap eas update or a local IPA.
node scripts/fork/origin-forge.mjs dispatch --workflow fork-release.yml --ref main
if [[ "$mobile_release_needed" == "true" ]]; then
  echo "Upstream integration changed mobile-relevant paths; publishing OTA/TestFlight from this Mac."
  T3CODE_MOBILE_SKIP_PATH_FILTER=1 \
    T3CODE_MOBILE_UPDATE_MESSAGE="Upstream sync $UPSTREAM_TAG" \
    bash scripts/fork/publish-mobile-release.sh
else
  echo "The upstream integration changed no mobile-relevant paths; skipping mobile release."
fi
