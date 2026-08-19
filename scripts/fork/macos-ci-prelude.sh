#!/usr/bin/env bash
# Source at the start of macos-release GHA-importer steps.
# The importer often omits GITHUB_PATH / GITHUB_ENV, so PATH and secrets
# persist through this file instead.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:${HOME}/.vite-plus/bin:${HOME}/.local/bin:${PATH}"
_t3_ci_env="${RUNNER_TEMP:-${GITHUB_WORKSPACE:-${HOME}}}/t3-pretty-ci.env"
if [[ -f "$_t3_ci_env" ]]; then
  # shellcheck disable=SC1090
  . "$_t3_ci_env"
fi

# Persist a scalar for this step and later prelude-sourced steps. Writes
# GITHUB_ENV only when the importer set that file.
t3_persist_env() {
  local name="$1"
  local value="$2"
  mkdir -p "$(dirname "$_t3_ci_env")"
  if [[ -f "$_t3_ci_env" ]]; then
    grep -v "^export ${name}=" "$_t3_ci_env" > "${_t3_ci_env}.tmp" || true
    mv "${_t3_ci_env}.tmp" "$_t3_ci_env"
  fi
  printf 'export %s=%q\n' "$name" "$value" >> "$_t3_ci_env"
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    {
      printf '%s<<__T3_CI_ENV_EOF__\n' "$name"
      printf '%s\n' "$value"
      printf '__T3_CI_ENV_EOF__\n'
    } >> "$GITHUB_ENV"
  fi
  printf -v "$name" '%s' "$value"
  export "$name"
}
