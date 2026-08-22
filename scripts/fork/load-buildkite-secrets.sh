#!/usr/bin/env bash
# Load named Buildkite cluster secrets into the current shell, GITHUB_ENV when
# that file exists, and a workspace env file the macos-release importer can
# source later. Source this script:
#   . scripts/fork/load-buildkite-secrets.sh EXPO_TOKEN
#
# Do not interpolate secrets.* in the workflow YAML. The importer resolves
# those before any step and one failed secret get kills the job.
# Executed as a program this file fail-closes. Sourced, it inherits the
# caller options so `set -u` does not leak into an unsuspecting parent.
if [[ "${BASH_SOURCE[0]-}" == "${0-}" ]]; then
  set -euo pipefail
fi

_t3_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ci-env.sh
. "${_t3_here}/ci-env.sh"
unset _t3_here

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:${HOME}/.vite-plus/bin:${HOME}/.local/bin:${PATH}"

# Missing agent is not a hard fail. File-backed secrets still load. An early
# `exit 0` would skip ~/.config/t3-pretty and leave later steps empty.
if ! command -v buildkite-agent >/dev/null; then
  echo "buildkite-agent is not on PATH; leaving existing environment in place."
fi

ci_env="$(t3_ci_env_path)"

append_export() {
  local name="$1"
  local value="$2"
  mkdir -p "$(dirname "$ci_env")"
  if [[ -f "$ci_env" ]]; then
    grep -v "^export ${name}=" "$ci_env" > "${ci_env}.tmp" || true
    mv "${ci_env}.tmp" "$ci_env"
  fi
  printf 'export %s=%q\n' "$name" "$value" >> "$ci_env"
}

for name in "$@"; do
  value="${!name:-}"
  if [[ -z "$value" ]] && command -v buildkite-agent >/dev/null; then
    value="$(buildkite-agent secret get "$name" 2>/dev/null || true)"
  fi
  if [[ -z "$value" ]]; then
    for candidate in \
      "${HOME}/.config/t3-pretty/${name}" \
      "/opt/homebrew/var/buildkite-agent/secrets/${name}"; do
      if [[ -f "$candidate" ]]; then
        # Keep PEM newlines (APNs). Strip CRs and one trailing newline.
        value="$(tr -d '\r' < "$candidate")"
        value="${value%$'\n'}"
        break
      fi
    done
  fi
  if [[ -z "$value" ]]; then
    echo "cluster secret $name is not available on this agent"
    continue
  fi
  printf -v "$name" '%s' "$value"
  export "$name"
  append_export "$name" "$value"
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    {
      printf '%s<<__T3_BK_SECRET_EOF__\n' "$name"
      printf '%s\n' "$value"
      printf '__T3_BK_SECRET_EOF__\n'
    } >> "$GITHUB_ENV"
  fi
done
