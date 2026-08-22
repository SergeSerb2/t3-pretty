#!/usr/bin/env bash
# Integrate the newest pingdotgg/t3code nightly into T3 Pretty and land it
# on Origin main. The four-hour Buildkite schedule runs this as a native
# macos-release step. The imported GHA wrapper calls the same script so a
# manual workflow_dispatch cannot drift.
#
# Do not write GITHUB_OUTPUT. The macos-release importer often omits that
# file, and `set -u` then killed every scheduled sync in discover.
set -euo pipefail

# Buildkite sets FORCE_COLOR and NO_COLOR together. Origin's bun CLI then
# prints assertion_error while loading tty colors and, on the macos-release
# agent, can exit 255 from `git fetch` (credential helper) and `origin`.
unset NO_COLOR || true
export FORCE_COLOR="${FORCE_COLOR:-0}"
if [[ "${FORCE_COLOR}" == "1" || "${FORCE_COLOR}" == "true" ]]; then
  export FORCE_COLOR=0
fi

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
SYNC_FAIL_REASON=""

CACHE_ROOT="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
CACHE_ROOT="${CACHE_ROOT%/}"
export SYNC_RESOLUTION_CACHE_DIR="${SYNC_RESOLUTION_CACHE_DIR:-${CACHE_ROOT}/sync-resolution-cache}"
mkdir -p "$SYNC_RESOLUTION_CACHE_DIR"

origin_git() {
  local store="" candidate
  for candidate in \
    "${ORIGIN_GIT_CREDENTIALS:-}" \
    "${HOME}/.git-credentials" \
    /Users/m1-dev/.git-credentials \
    /opt/homebrew/var/buildkite-agent/.git-credentials; do
    if [[ -n "$candidate" && -s "$candidate" ]]; then
      store="$candidate"
      break
    fi
  done
  if [[ -n "$store" ]]; then
    git -c credential.helper= \
      -c "credential.https://origin.cursor.com.helper=store --file=${store}" \
      -c "credential.https://origin.cursor.com/git.helper=store --file=${store}" \
      "$@"
  else
    git "$@"
  fi
}

# macos-release reuses the workspace. A previous sync that died mid-merge
# leaves MERGE_HEAD; `git checkout -B main` then fails in ~2s and every
# later nightly opens another blocked PR instead of finishing the merge.
abort_leftover_git_state() {
  git merge --abort >/dev/null 2>&1 || true
  git rebase --abort >/dev/null 2>&1 || true
  git cherry-pick --abort >/dev/null 2>&1 || true
  git am --abort >/dev/null 2>&1 || true
  git reset --hard HEAD >/dev/null 2>&1 || true
}

git config user.name "t3-pretty-sync[bot]"
git config user.email "t3-pretty-bot@users.noreply.cursor.com"

abort_leftover_git_state

# macos-release reuses the workspace. A previous sync leaves `upstream`
# in .git/config, and `git remote add` then exits 1 before the merge
# starts (~2s red job).
if git remote get-url upstream >/dev/null 2>&1; then
  git remote set-url upstream "$UPSTREAM_URL"
else
  git remote add upstream "$UPSTREAM_URL"
fi
# Parent history stays on GitHub. The fork remote is Origin.
# The checkout is a blob:none partial clone of the fork remote, so
# upstream-side objects must be fetched eagerly with --no-filter:
# lazy backfill asks the fork promisor first, it answers "not our
# ref" for upstream-only objects, and one unfetchable object fails
# the whole backfill batch ("could not fetch ... from promisor
# remote", merge exit 128) instead of falling through to upstream.
# Do not register upstream as a promisor: that also makes every
# upstream fetch inherit the blob:none filter, recreating the
# missing-blob state this fetch strategy exists to avoid. Earlier
# runs did register it on this reused workspace, so unset it here.
git config --unset remote.upstream.promisor || true
git config --unset remote.upstream.partialclonefilter || true

if git rev-parse --is-shallow-repository >/dev/null 2>&1 &&
  [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
  origin_git fetch --unshallow origin || origin_git fetch --update-shallow origin main
fi
origin_git fetch origin main
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

git fetch --no-tags --no-filter --force upstream "refs/tags/$latest_tag:refs/tags/$latest_tag"
current_tag=""
if [[ -f .t3-fork/upstream-nightly ]]; then
  current_tag="$(tr -d '[:space:]' < .t3-fork/upstream-nightly)"
fi
# The resolver uses previous_tag..origin/main to recover the fork's
# intent for conflicted paths. Fresh clones do not have the
# previous tag ref even though its commit is in main's history.
if [[ -n "$current_tag" && "$current_tag" != "$latest_tag" ]]; then
  git fetch --no-tags --no-filter --force upstream "refs/tags/$current_tag:refs/tags/$current_tag"
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
  origin_git fetch origin "refs/heads/$RESOLUTION_CACHE_BRANCH:refs/remotes/origin/$RESOLUTION_CACHE_BRANCH" 2>/dev/null || true
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
  if (( ${#parent_args[@]} == 0 )); then
    :
  elif [[ "$(git rev-parse "origin/$RESOLUTION_CACHE_BRANCH^{tree}")" == "$tree" ]]; then
    echo "Resolution cache already holds these entries."
    return 0
  fi
  local commit
  commit="$(git commit-tree "$tree" ${parent_args[@]+"${parent_args[@]}"} -m "chore(sync): checkpoint conflict resolutions")"
  origin_git push origin "$commit:refs/heads/$RESOLUTION_CACHE_BRANCH"
  echo "Checkpointed ${#entries[@]} resolution(s) to $RESOLUTION_CACHE_BRANCH."
}

report_blocked() {
  local status="${1:-1}"
  node scripts/fork/origin-forge.mjs setup-ci
  local detail="${SYNC_FAIL_REASON:-The job exited ${status}.}"
  local body="The guarded four-hour T3 Pretty sync could not safely merge $UPSTREAM_TAG.

${detail}

Inspect the failed Origin-connected CI run for this commit."
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
      report_blocked "$status" || true
    fi
  fi
  exit "$status"
}
trap on_exit EXIT

# Restore checkpointed per-file resolutions first: a run that failed
# or timed out mid-merge reruns only the files that never finished.
load_resolution_cache() {
  if origin_git fetch origin "refs/heads/$RESOLUTION_CACHE_BRANCH:refs/remotes/origin/$RESOLUTION_CACHE_BRANCH" 2>/dev/null; then
    git archive "origin/$RESOLUTION_CACHE_BRANCH" | tar -x -C "$SYNC_RESOLUTION_CACHE_DIR"
  fi
}

# Always write the durable integration report. Clean merges make no
# model request; conflict merges use Sol/xhigh and record every
# parent change intentionally omitted to protect T3 Pretty.
resolve_current_merge() {
  local merge_status="$1"
  local resolver_paths=()
  local path

  # The fork owns its release and security automation. Keep those files
  # pinned to fork main instead of allowing an upstream tag to rewrite
  # workflows or requiring a broadly scoped personal token.
  git restore --source=origin/main --staged --worktree -- .github/workflows

  # Keep the resolved nightly marker and report when merging a newer
  # origin/main into a previously finished sync branch. The job rewrites
  # both files after the newest tag is integrated.
  for path in .t3-fork/upstream-nightly .t3-fork/upstream-sync-report.md; do
    if git diff --name-only --diff-filter=U | grep -qx "$path"; then
      git checkout --ours -- "$path"
      git add -- "$path"
    fi
  done

  # bash 3.2 (/bin/bash on macos-release) has no `mapfile`.
  while IFS= read -r -d '' path; do
    resolver_paths+=("$path")
  done < <(git diff --name-only --diff-filter=U -z)
  if (( ${#resolver_paths[@]} == 0 )) && (( merge_status != 0 )) &&
    ! git rev-parse -q --verify MERGE_HEAD >/dev/null; then
    SYNC_FAIL_REASON="Merge failed without producing resolvable conflicts (exit ${merge_status})."
    echo "$SYNC_FAIL_REASON" >&2
    return "$merge_status"
  fi
  load_resolution_cache
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
    SYNC_FAIL_REASON="Unresolved merge conflicts remain after the resolver finished."
    echo "$SYNC_FAIL_REASON" >&2
    return 1
  fi
}

commit_sync() {
  local message="$1"
  if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
    git commit -m "$message"
  elif ! git diff --cached --quiet; then
    git commit -m "$message"
  else
    echo "Nothing changed for: $message"
  fi
}

merge_ref() {
  local ref="$1"
  local message="$2"
  local refresh_remote="${3:-}"
  local refresh_refspec="${4:-}"
  local merge_status
  if git merge-base --is-ancestor "$ref^{commit}" HEAD 2>/dev/null ||
    git merge-base --is-ancestor "$ref" HEAD 2>/dev/null; then
    echo "HEAD already contains $ref."
    return 0
  fi
  set +e
  git merge --no-ff --no-commit "$ref"
  merge_status=$?
  set -e
  # A merge that dies before producing conflicts (exit > 1) is an object
  # problem, not a text problem: a promisor backfill answered "not our
  # ref" for an object one side references. Re-fetch the merge input
  # with full objects and retry once before declaring the run blocked.
  if (( merge_status > 1 )) && [[ -n "$refresh_remote" ]]; then
    echo "Merge of $ref exited $merge_status before producing conflicts; re-fetching full objects and retrying once."
    git merge --abort >/dev/null 2>&1 || git reset --hard HEAD >/dev/null 2>&1 || true
    if [[ "$refresh_remote" == "origin" ]]; then
      origin_git fetch --no-filter origin "$refresh_refspec"
    else
      git fetch --no-tags --no-filter --force upstream "$refresh_refspec"
    fi
    set +e
    git merge --no-ff --no-commit "$ref"
    merge_status=$?
    set -e
  fi
  resolve_current_merge "$merge_status"
  commit_sync "$message"
}

# A finished resolution of an older nightly is a better merge base than
# origin/main: later nightlies used to start from scratch, re-pay every
# conflict, and time out while the resolved branch went stale against main.
reusable_sync_branch=""
reusable_sync_tag=""

# Nightly tags are not always one fast-forward line (retagged, rebuilt, or
# parallel nightlies). Ancestry between two tags is only a staleness signal
# when both commits sit on the same upstream first-parent line; otherwise
# the tag-name sort below and the finished report check decide.
same_first_parent_line() {
  local a b
  a="$(git rev-parse "$1")"
  b="$(git rev-parse "$2")"
  [[ "$a" == "$b" ]] && return 0
  git rev-list --first-parent "$a" | grep -qx "$b" && return 0
  git rev-list --first-parent "$b" | grep -qx "$a" && return 0
  return 1
}
while IFS=$'\t' read -r _sha ref; do
  [[ -n "$ref" ]] || continue
  local_name="${ref#refs/heads/}"
  case "$local_name" in
    automation/upstream-*) ;;
    *) continue ;;
  esac
  origin_git fetch origin "refs/heads/$local_name:refs/remotes/origin/$local_name" 2>/dev/null || continue
  candidate_tag="$(git show "origin/$local_name:.t3-fork/upstream-nightly" 2>/dev/null | tr -d '[:space:]')"
  [[ -n "$candidate_tag" ]] || continue
  git rev-parse -q --verify "$candidate_tag^{commit}" >/dev/null 2>&1 ||
    git fetch --no-tags --no-filter --force upstream "refs/tags/$candidate_tag:refs/tags/$candidate_tag" 2>/dev/null ||
    continue
  git merge-base --is-ancestor "$candidate_tag^{commit}" "origin/$local_name" || continue
  [[ "$(git show "origin/$local_name:.t3-fork/upstream-sync-report.md" 2>/dev/null | sed -n '1p')" == "# T3 Pretty upstream integration report" ]] || continue
  if ! git merge-base --is-ancestor "$candidate_tag^{commit}" "$latest_tag^{commit}" &&
    same_first_parent_line "$candidate_tag^{commit}" "$latest_tag^{commit}"; then
    continue
  fi
  if [[ -z "$reusable_sync_tag" ]] ||
    [[ "$(printf '%s\n%s\n' "$reusable_sync_tag" "$candidate_tag" | sort -V | tail -n 1)" == "$candidate_tag" ]]; then
    reusable_sync_branch="$local_name"
    reusable_sync_tag="$candidate_tag"
  fi
done < <(origin_git ls-remote --heads origin "refs/heads/automation/upstream-*" || true)

if [[ -n "$reusable_sync_branch" ]]; then
  echo "Reusing the previously validated AI resolution on $reusable_sync_branch ($reusable_sync_tag)."
  export REUSED_SYNC_RESOLUTION=true
  git checkout -B "$SYNC_BRANCH" "origin/$reusable_sync_branch"
else
  git checkout -B "$SYNC_BRANCH" origin/main
fi

merge_ref origin/main "chore(sync): merge origin/main before $UPSTREAM_TAG" origin main
merge_ref "$UPSTREAM_TAG" "chore(sync): merge upstream $UPSTREAM_TAG" \
  upstream "refs/tags/$UPSTREAM_TAG:refs/tags/$UPSTREAM_TAG"

mkdir -p .t3-fork
printf '%s\n' "$UPSTREAM_TAG" > .t3-fork/upstream-nightly
git add .t3-fork/upstream-nightly
# Whitespace-guard only the file this workflow writes itself.
# Resolver-composed content is model output; upstream content is a
# trusted release. `git diff --check` would reject a model-emitted
# blank line at EOF after the entire merge succeeded, so it must
# not gate either.
git diff --check --cached -- .t3-fork/upstream-nightly
if ! git diff --cached --quiet; then
  git commit -m "chore(sync): record upstream $UPSTREAM_TAG"
fi

push_sync_branch() {
  origin_git fetch origin "refs/heads/$SYNC_BRANCH:refs/remotes/origin/$SYNC_BRANCH" 2>/dev/null || true
  remote_head="$(git rev-parse -q --verify "origin/$SYNC_BRANCH" 2>/dev/null || true)"
  if [[ "$(git rev-parse HEAD)" == "$remote_head" ]]; then
    echo "$SYNC_BRANCH is already current."
  else
    origin_git push --force-with-lease origin "HEAD:refs/heads/$SYNC_BRANCH"
  fi
}

push_sync_branch

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

land_sync_pr() {
  local head_sha
  head_sha="$(git rev-parse HEAD)"
  node scripts/fork/origin-forge.mjs merge-pr --head "$SYNC_BRANCH" --sha "$head_sha"
}

if ! land_sync_pr; then
  echo "Origin merge failed; merging origin/main and retrying once."
  origin_git fetch origin main
  # Treat the existing integration report as the base for this merge:
  # without REUSED_SYNC_RESOLUTION the resolver formats a fresh report
  # from the retry merge alone, so a clean (or marker-only) origin/main
  # merge would replace the upstream integration record with "no text
  # conflicts" and the landed PR body would misdescribe the tree.
  export REUSED_SYNC_RESOLUTION=true
  merge_ref origin/main "chore(sync): merge origin/main before landing $UPSTREAM_TAG" origin main
  printf '%s\n' "$UPSTREAM_TAG" > .t3-fork/upstream-nightly
  git add .t3-fork/upstream-nightly
  if ! git diff --cached --quiet; then
    git commit -m "chore(sync): record upstream $UPSTREAM_TAG"
  fi
  push_sync_branch
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
  if ! land_sync_pr; then
    SYNC_FAIL_REASON="Origin could not merge $SYNC_BRANCH into main after retrying with a refreshed origin/main."
    echo "$SYNC_FAIL_REASON" >&2
    exit 1
  fi
fi

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
