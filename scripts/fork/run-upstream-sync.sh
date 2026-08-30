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
# Any truthy value (1, true, 2, 3) trips it, so force 0 unconditionally.
unset NO_COLOR || true
export FORCE_COLOR=0

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# Transient network failures (upstream ls-remote, Origin fetches, the pnpm
# registry) must not kill a four-hour sync slot on the first blip. Three
# attempts with a short backoff; the caller decides whether a final failure
# is fatal.
retry() {
  local attempt
  for attempt in 1 2 3; do
    "$@" && return 0
    (( attempt < 3 )) && sleep $(( attempt * 10 ))
  done
  return 1
}

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
  # A job killed mid-write leaves index.lock behind; the sync's concurrency
  # group serializes this checkout, so at job start any lock is stale and
  # would make every abort below fail silently, leaving MERGE_HEAD in place.
  # Remove it FIRST, resolved through git (in a linked worktree `.git` is a
  # file and a hardcoded .git/index.lock path exits 1 with ENOTDIR).
  rm -f "$(git rev-parse --git-path index.lock)" || true
  git merge --abort >/dev/null 2>&1 || true
  git rebase --abort >/dev/null 2>&1 || true
  git cherry-pick --abort >/dev/null 2>&1 || true
  git am --abort >/dev/null 2>&1 || true
  git reset --hard HEAD >/dev/null 2>&1 || true
  # An untracked leftover at a path a nightly adds makes `git merge` exit 2
  # before producing conflicts, which then fails every four-hour run
  # identically. Keep node_modules so the mobile publish can reuse installs.
  git clean -ffd -e node_modules >/dev/null 2>&1 || true
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
git config --unset-all remote.upstream.promisor || true
git config --unset-all remote.upstream.partialclonefilter || true

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
  retry origin_git push origin "$commit:refs/heads/$RESOLUTION_CACHE_BRANCH"
  echo "Checkpointed ${#entries[@]} resolution(s) to $RESOLUTION_CACHE_BRANCH."
}

report_blocked() {
  local status="${1:-1}"
  local tag="${UPSTREAM_TAG:-unknown}"
  node scripts/fork/origin-forge.mjs setup-ci
  local detail="${SYNC_FAIL_REASON:-The job exited ${status}.}"
  local body="The guarded four-hour T3 Pretty sync could not safely merge $tag.

${detail}

Inspect the failed Origin-connected CI run for this commit."
  node scripts/fork/origin-forge.mjs report-blocked \
    --upstream-tag "$tag" \
    --title "Upstream sync blocked: $tag" \
    --body "$body"
}

has_update=0
sync_landed=0

on_exit() {
  local status=$?
  trap - EXIT
  if [[ "$has_update" == 1 ]]; then
    checkpoint_resolutions || true
  fi
  # 143/130 mean the job was cancelled or superseded — not a blockage, and
  # the kill grace period is better spent on the checkpoint above. A landed
  # sync must never file a blocked report over a best-effort post-land step.
  if (( status != 0 && status != 143 && status != 130 )) && [[ "$sync_landed" != 1 ]]; then
    report_blocked "$status" || true
  fi
  exit "$status"
}
trap on_exit EXIT
# Buildkite cancels with SIGTERM (SIGKILL only after the grace period), and
# bash without a TERM trap dies WITHOUT running its EXIT trap — losing every
# completed resolution exactly when a timed-out backlog run needs them most.
trap 'exit 143' TERM INT

if git rev-parse --is-shallow-repository >/dev/null 2>&1 &&
  [[ "$(git rev-parse --is-shallow-repository)" == "true" ]]; then
  retry origin_git fetch --unshallow origin || retry origin_git fetch --update-shallow origin main
fi
retry origin_git fetch origin main
git checkout --force -B main origin/main

# `set -o pipefail` makes a failed command substitution fatal even mid
# pipeline, so capture the listing through retry and only then post-process.
list_upstream_nightly_tags() {
  git ls-remote --tags --refs upstream 'refs/tags/v*-nightly.*'
}
upstream_tag_listing=""
if ! upstream_tag_listing="$(retry list_upstream_nightly_tags)"; then
  echo "Could not list upstream nightly tags after 3 attempts." >&2
  exit 1
fi
latest_tag="$(printf '%s\n' "$upstream_tag_listing" |
  awk '{sub("refs/tags/", "", $2); print $2}' |
  sort -V |
  tail -n 1)"
if [[ -z "$latest_tag" ]]; then
  echo "No upstream nightly tag found." >&2
  exit 1
fi

retry git fetch --no-tags --no-filter --force upstream "refs/tags/$latest_tag:refs/tags/$latest_tag"
current_tag=""
if [[ -f .t3-fork/upstream-nightly ]]; then
  current_tag="$(tr -d '[:space:]' < .t3-fork/upstream-nightly)"
fi
# The resolver uses previous_tag..origin/main to recover the fork's
# intent for conflicted paths. Fresh clones do not have the
# previous tag ref even though its commit is in main's history, and
# upstream occasionally prunes old nightly tags — that only costs
# history context, never the sync.
if [[ -n "$current_tag" && "$current_tag" != "$latest_tag" ]]; then
  retry git fetch --no-tags --no-filter --force upstream "refs/tags/$current_tag:refs/tags/$current_tag" ||
    echo "warning: previous nightly tag $current_tag is no longer fetchable; continuing without its history context."
fi

export UPSTREAM_TAG="$latest_tag"
export PREVIOUS_UPSTREAM_TAG="$current_tag"
export REUSED_SYNC_RESOLUTION=false

if [[ "$current_tag" == "$latest_tag" ]] &&
  git merge-base --is-ancestor "$latest_tag^{commit}" HEAD; then
  echo "Fork already contains $latest_tag."
  exit 0
fi

branch="automation/upstream-${latest_tag//[^0-9A-Za-z._-]/-}"
export SYNC_BRANCH="$branch"
has_update=1

# Restore checkpointed per-file resolutions first: a run that failed
# or timed out mid-merge reruns only the files that never finished.
load_resolution_cache() {
  if origin_git fetch origin "refs/heads/$RESOLUTION_CACHE_BRANCH:refs/remotes/origin/$RESOLUTION_CACHE_BRANCH" 2>/dev/null; then
    git archive "origin/$RESOLUTION_CACHE_BRANCH" | tar -x -C "$SYNC_RESOLUTION_CACHE_DIR"
  fi
}

# Homebrew's node no longer ships corepack, and a bare `corepack enable`
# exited 127 on every scheduled sync. Prefer the pinned pnpm that vite-plus
# already manages on macos-release, then corepack, then a one-off pnpm.
regenerate_lockfile() {
  local pnpm_version managed_pnpm
  pnpm_version="$(node --print "require('./package.json').packageManager.split('@').pop()")"
  managed_pnpm="${HOME}/.vite-plus/package_manager/pnpm/${pnpm_version}/pnpm/bin"
  if [[ -x "${managed_pnpm}/pnpm" ]]; then
    PATH="${managed_pnpm}:${PATH}" pnpm install --lockfile-only --no-frozen-lockfile
  elif command -v corepack >/dev/null; then
    corepack enable
    corepack pnpm install --lockfile-only --no-frozen-lockfile
  else
    npx --yes "pnpm@${pnpm_version}" install --lockfile-only --no-frozen-lockfile
  fi
}

# Always write the durable integration report. Clean merges make no
# model request; conflict merges use Sol/xhigh and record every
# parent change intentionally omitted to protect T3 Pretty.
resolve_current_merge() {
  local merge_status="$1"
  local lockfile_conflicted=false
  local path

  # The fork owns its release and security automation. Keep those files
  # pinned to fork main instead of allowing an upstream tag to rewrite
  # workflows or requiring a broadly scoped personal token.
  git rm -r -f --ignore-unmatch -- .github/workflows
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

  # Remember whether the generated lockfile conflicted before the resolver
  # stages its completed resolution.
  while IFS= read -r -d '' path; do
    if [[ "$path" == "pnpm-lock.yaml" ]]; then
      lockfile_conflicted=true
    fi
  done < <(git diff --name-only --diff-filter=U -z)
  if [[ "$lockfile_conflicted" == "false" ]] && (( merge_status != 0 )) &&
    [[ -z "$(git diff --name-only --diff-filter=U)" ]] &&
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
  if [[ "$lockfile_conflicted" == "true" ]]; then
    # Retried: a registry 5xx here used to fail the run after the model had
    # already paid for the entire resolution.
    retry regenerate_lockfile
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
  # Not a plain pipe: grep -q exits on the first match, rev-list takes
  # SIGPIPE, and pipefail then reports 141 — reading "same line" as
  # "different lines" exactly when the match comes early.
  grep -qx "$b" < <(git rev-list --first-parent "$a") && return 0
  grep -qx "$a" < <(git rev-list --first-parent "$b") && return 0
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
  # `|| true` inside the substitution: with pipefail a branch tip lacking
  # the marker file would otherwise kill the whole run, not skip the branch.
  candidate_tag="$(git show "origin/$local_name:.t3-fork/upstream-nightly" 2>/dev/null | tr -d '[:space:]' || true)"
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
    # An explicit lease: a bare --force-with-lease needs the remote-tracking
    # ref and is rejected with "stale info" whenever the fetch above flaked
    # or a fresh workspace never had the ref. An empty expectation means
    # "the branch must not exist yet", which is exactly what we observed.
    retry origin_git push "--force-with-lease=refs/heads/$SYNC_BRANCH:$remote_head" \
      origin "HEAD:refs/heads/$SYNC_BRANCH"
  fi
}

push_sync_branch

retry node scripts/fork/origin-forge.mjs setup-ci
pr_body_path="${CACHE_ROOT}/t3-pretty-upstream-sync.md"
write_sync_pr_body() {
  printf '%s\n\n' \
    'Automated four-hour integration of the newest parent T3 Code nightly into T3 Pretty.' \
    'Clean merges are retained directly. Text conflicts are resolved through CLIProxyAPI with gpt-5.6-sol at xhigh reasoning under the T3 Pretty preservation contract.'
  printf 'The complete conflict-resolution audit for `%s` is committed in `.t3-fork/upstream-sync-report.md`.\n' "$UPSTREAM_TAG"
  if grep -q "fork-side fallback" .t3-fork/upstream-sync-report.md 2>/dev/null; then
    printf '\n%s\n' 'Some conflicted files took the deterministic fork-side fallback because no model resolution was available; the committed report lists every parent change it omitted.'
  fi
}
write_sync_pr_body > "$pr_body_path"
retry node scripts/fork/origin-forge.mjs ensure-pr \
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

# Origin's merge queue can land the PR after merge-pr's polling window gave
# up, and a post-merge CLI field regression can misreport a finished merge.
# Before treating a merge failure as real, check whether HEAD already
# reached origin/main — retrying a landed merge duplicates PRs and files a
# false blocked report.
sync_already_landed() {
  origin_git fetch origin main >/dev/null 2>&1 || true
  git merge-base --is-ancestor HEAD origin/main 2>/dev/null
}

if land_sync_pr || {
  sync_already_landed &&
    echo "Origin reported a merge failure, but HEAD is already contained in origin/main; the sync landed."
}; then
  sync_landed=1
else
  echo "Origin merge failed; merging origin/main and retrying once."
  origin_git fetch origin main
  # Treat the existing integration report as the base for this merge:
  # without REUSED_SYNC_RESOLUTION the resolver formats a fresh report
  # from the retry merge alone, so a clean (or marker-only) origin/main
  # merge would replace the upstream integration record with "no text
  # conflicts" and the durable report would misdescribe the tree.
  export REUSED_SYNC_RESOLUTION=true
  merge_ref origin/main "chore(sync): merge origin/main before landing $UPSTREAM_TAG" origin main
  printf '%s\n' "$UPSTREAM_TAG" > .t3-fork/upstream-nightly
  git add .t3-fork/upstream-nightly
  if ! git diff --cached --quiet; then
    git commit -m "chore(sync): record upstream $UPSTREAM_TAG"
  fi
  push_sync_branch
  write_sync_pr_body > "$pr_body_path"
  retry node scripts/fork/origin-forge.mjs ensure-pr \
    --base main \
    --head "$SYNC_BRANCH" \
    --title "chore(sync): merge upstream $UPSTREAM_TAG" \
    --body-file "$pr_body_path"
  if land_sync_pr || {
    sync_already_landed &&
      echo "Origin reported a merge failure, but HEAD is already contained in origin/main; the sync landed."
  }; then
    sync_landed=1
  else
    SYNC_FAIL_REASON="Origin could not merge $SYNC_BRANCH into main after retrying with a refreshed origin/main."
    echo "$SYNC_FAIL_REASON" >&2
    exit 1
  fi
fi

# The sync's success contract ends when the merge lands on main. Everything
# below is follow-up delivery with its own recovery path (the merge push
# triggers desktop and mobile jobs, and the OTA coverage mark re-releases
# anything stranded), so a failure here must not repaint a landed sync as
# blocked.
node scripts/fork/origin-forge.mjs delete-branch --head "$SYNC_BRANCH" ||
  echo "warning: could not delete $SYNC_BRANCH on Origin; the merged branch can be removed manually."

# Dispatch desktop preflight if the merge push is missed. Mobile no
# longer has an imported workflow; if this integration changed
# mobile paths, publish from this macos-release job. The script
# flocks /tmp/t3-pretty-ios-mobile.lock so a follow-up ios-mobile
# push job cannot overlap eas update or a local IPA.
node scripts/fork/origin-forge.mjs dispatch --workflow fork-release.yml --ref main ||
  echo "warning: fork-release dispatch failed; the merge push's own build covers the desktop preflight."
if [[ "$mobile_release_needed" == "true" ]]; then
  echo "Upstream integration changed mobile-relevant paths; publishing OTA/TestFlight from this Mac."
  T3CODE_MOBILE_SKIP_PATH_FILTER=1 \
    T3CODE_MOBILE_UPDATE_MESSAGE="Upstream sync $UPSTREAM_TAG" \
    bash scripts/fork/publish-mobile-release.sh ||
    echo "warning: the inline mobile publish failed; the merge push's mobile jobs and the OTA coverage mark re-release it."
else
  echo "The upstream integration changed no mobile-relevant paths; skipping mobile release."
fi
