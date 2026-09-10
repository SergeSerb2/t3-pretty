#!/usr/bin/env bash
# Source from packaging scripts. Fresh hosted Macs (macos-large) do not ship
# `vp`; the former macos-release image did. Pin VP_HOME to ~/.vite-plus — the
# directory release scripts already put on PATH — then install Vite+ when vp
# is missing.
#
# Tests set T3CODE_VITE_PLUS_INSTALLER to a controlled script so this block
# can run without hitting the network.

vite_plus_home() {
  printf '%s\n' "${VP_HOME:-${HOME}/.vite-plus}"
}

vite_plus_on_path() {
  export VP_HOME
  VP_HOME="$(vite_plus_home)"
  export PATH="${VP_HOME}/bin:${PATH}"
}

vp_is_official() {
  command -v vp >/dev/null || return 1
  local out
  out="$(vp --version 2>&1 || true)"
  [[ "$out" != *"npx vp"* ]]
}

install_vite_plus() {
  export CI="${CI:-true}"
  export VP_HOME
  VP_HOME="$(vite_plus_home)"
  if [[ -n "${T3CODE_VITE_PLUS_INSTALLER:-}" ]]; then
    bash "${T3CODE_VITE_PLUS_INSTALLER}"
    return
  fi
  curl -fsSL https://vite.plus | bash
}

ensure_vite_plus() {
  local purpose="${1:-to run this job}"
  vite_plus_on_path
  if vp_is_official; then
    return 0
  fi
  echo "vp is missing; installing Vite+ into ${VP_HOME}"
  if ! install_vite_plus; then
    echo "Vite+ install failed; vp is required ${purpose}." >&2
    return 1
  fi
  vite_plus_on_path
  if ! vp_is_official; then
    echo "vp is required ${purpose}." >&2
    return 1
  fi
}
