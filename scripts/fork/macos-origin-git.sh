#!/bin/bash
# Point the macos-release agent user at a file store for Origin HTTPS.
# Two macos-release agents share $HOME. Rewriting ~/.gitconfig on every
# pre-checkout races on ~/.gitconfig.lock and fails the job with:
#   error: could not lock config file /Users/m1-dev/.gitconfig: File exists
# Skip the write when the helper is already set. Serialize remaining writes.
# Buildkite's GitHub Actions checkout adapter still will not use this;
# Mac jobs clone through scripts/fork/checkout-origin.sh.
set -euo pipefail

origin_hosts=(
  "https://origin.cursor.com"
  "https://origin.cursor.com/git"
)

origin_cli_helper_ready() {
  local hostName current
  if [[ ! -x "${HOME}/.local/bin/origin" ]] && ! command -v origin >/dev/null; then
    return 1
  fi
  for hostName in "${origin_hosts[@]}"; do
    current="$(git config --global --get-all "credential.${hostName}.helper" 2>/dev/null || true)"
    printf '%s\n' "$current" | grep -Fq "origin credential-helper" || return 1
  done
  return 0
}

store="${ORIGIN_GIT_CREDENTIALS:-$HOME/.git-credentials}"
write_lock=""

cleanup() {
  if [[ -n "$write_lock" && -d "$write_lock" ]]; then
    rmdir "$write_lock" 2>/dev/null || true
  fi
}
trap cleanup EXIT

helpers_ready() {
  local hostName current
  [[ -s "$store" ]] || return 1
  for hostName in "${origin_hosts[@]}"; do
    current="$(git config --global --get-all "credential.${hostName}.helper" 2>/dev/null || true)"
    printf '%s\n' "$current" | grep -Fxq "store --file=${store}" || return 1
  done
  return 0
}

file_mtime() {
  stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || echo 0
}

remove_stale_gitconfig_lock() {
  local lock="$HOME/.gitconfig.lock"
  [[ -f "$lock" ]] || return 0
  if (( "$(date +%s)" - "$(file_mtime "$lock")" > 15 )); then
    echo "Removing stale $lock"
    rm -f "$lock"
  fi
}

acquire_write_lock() {
  local lock deadline mtime
  lock="${HOME}/.cache/t3-pretty-release/gitconfig.write.lock"
  mkdir -p "$(dirname "$lock")"
  deadline=$((SECONDS + 30))
  while ! mkdir "$lock" 2>/dev/null; do
    if (( SECONDS >= deadline )); then
      echo "Timed out waiting to write Origin git store helper." >&2
      exit 1
    fi
    mtime="$(file_mtime "$lock")"
    if [[ -d "$lock" ]] && (( "$(date +%s)" - mtime > 15 )); then
      echo "Removing stale gitconfig write lock"
      rmdir "$lock" 2>/dev/null || rm -rf "$lock"
      continue
    fi
    sleep 0.2
  done
  write_lock="$lock"
}

write_cli_helpers() {
  local hostName attempt
  for hostName in "${origin_hosts[@]}"; do
    attempt=0
    while true; do
      git config --global --unset-all "credential.${hostName}.helper" >/dev/null 2>&1 || true
      if git config --global "credential.${hostName}.helper" "!origin credential-helper"; then
        break
      fi
      attempt=$((attempt + 1))
      if (( attempt >= 8 )); then
        echo "Could not write Origin git CLI helper for ${hostName}." >&2
        return 1
      fi
      remove_stale_gitconfig_lock
      sleep 0.2
    done
  done
}

write_helpers() {
  local hostName attempt
  for hostName in "${origin_hosts[@]}"; do
    attempt=0
    while true; do
      git config --global --unset-all "credential.${hostName}.helper" >/dev/null 2>&1 || true
      if git config --global "credential.${hostName}.helper" "" \
        && git config --global --add "credential.${hostName}.helper" "store --file=$store"; then
        break
      fi
      attempt=$((attempt + 1))
      if (( attempt >= 8 )); then
        echo "Could not write Origin git store helper for ${hostName}." >&2
        return 1
      fi
      remove_stale_gitconfig_lock
      sleep 0.2
    done
  done
}

# An empty file still exists; git store then 128s on Origin HTTPS
# (`could not read Username`) because GIT_TERMINAL_PROMPT=0. Treat empty
# like missing and use the Origin CLI helper when it is available.
if [[ ! -s "$store" ]]; then
  # Interactive/dev machines can clone via `origin auth setup-git`. Buildkite
  # sets FORCE_COLOR+NO_COLOR, which makes that helper exit 255, so CI still
  # needs a non-empty file store when one exists.
  if origin_cli_helper_ready; then
    echo "Origin git CLI helper ready"
    exit 0
  fi
  if [[ -x "${HOME}/.local/bin/origin" ]] || command -v origin >/dev/null; then
    acquire_write_lock
    write_cli_helpers
    echo "Origin git CLI helper ready"
    exit 0
  fi
  echo "Missing or empty $store. Write an Origin HTTPS store (x-access-token JWT) first." >&2
  exit 1
fi

chmod 600 "$store"

if helpers_ready; then
  echo "Origin git store helper ready"
  exit 0
fi

acquire_write_lock
if helpers_ready; then
  echo "Origin git store helper ready"
  exit 0
fi

remove_stale_gitconfig_lock
write_helpers
echo "Origin git store helper ready"
