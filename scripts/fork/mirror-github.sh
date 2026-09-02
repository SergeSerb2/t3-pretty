#!/usr/bin/env bash
set -euo pipefail

# One-way Origin -> GitHub mirror. Run from an Origin checkout at main.
: "${GITHUB_MIRROR_REPO:?set GITHUB_MIRROR_REPO to owner/repo}"
: "${GITHUB_MIRROR_SSH_KEY:?set GITHUB_MIRROR_SSH_KEY to the dedicated deploy key}"
[[ "$GITHUB_MIRROR_REPO" == "SergeSerb2/t3-pretty" ]] || { echo "refusing unexpected GitHub mirror repo: $GITHUB_MIRROR_REPO" >&2; exit 1; }
archive_branch="archive/pre-origin-migration-2026-08-23"
release_tag_pattern="${GITHUB_MIRROR_TAG_PATTERN:-^v[0-9]+\.[0-9]+\.[0-9]+($|-)}"

branch="$(git branch --show-current)"
[[ "$branch" == main || "${BUILDKITE_BRANCH:-}" == main ]] || { echo "mirror must run on main (or detached Buildkite main)" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "refusing to mirror a dirty checkout" >&2; exit 1; }

key_file="$(mktemp)"
trap 'rm -f "$key_file"' EXIT
umask 077
printf '%s\n' "$GITHUB_MIRROR_SSH_KEY" >"$key_file"
chmod 600 "$key_file"
export GIT_SSH_COMMAND="ssh -i $key_file -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

if git remote get-url github >/dev/null 2>&1; then
  git remote set-url github "git@github.com:${GITHUB_MIRROR_REPO}.git"
else
  git remote add github "git@github.com:${GITHUB_MIRROR_REPO}.git"
fi
git fetch github main --prune
git fetch github "refs/heads/$archive_branch:refs/remotes/github/$archive_branch" 2>/dev/null || true
local_tip="$(git rev-parse HEAD)"
github_tip="$(git rev-parse --verify refs/remotes/github/main 2>/dev/null || true)"
archive_tip="$(git rev-parse --verify "refs/remotes/github/$archive_branch" 2>/dev/null || true)"

if [[ -n "$github_tip" ]]; then
  if [[ -n "$archive_tip" ]]; then
    if [[ "$(git rev-parse --is-shallow-repository)" == true ]]; then
      git fetch --unshallow origin
    fi
    git merge-base --is-ancestor "$github_tip" "$local_tip" || {
      echo "GitHub main diverged from Origin; refusing mirror" >&2; exit 1;
    }
  else
    # Preserve the pre-mirror GitHub tip exactly once before replacing main.
    git push --no-thin --force-with-lease="refs/heads/$archive_branch:" github "$github_tip:refs/heads/$archive_branch"
  fi
fi

if [[ -n "$github_tip" ]]; then
  git push --no-thin --force-with-lease="refs/heads/main:$github_tip" github "$local_tip:refs/heads/main"
else
  git push --no-thin github "$local_tip:refs/heads/main"
fi
tag_refs=()
while IFS= read -r tag; do
  [[ "$tag" =~ $release_tag_pattern ]] && tag_refs+=("refs/tags/$tag:refs/tags/$tag")
done < <(git for-each-ref --format='%(refname:strip=2)' refs/tags)
if (( ${#tag_refs[@]} )); then
  git push --no-thin github "${tag_refs[@]}"
fi
