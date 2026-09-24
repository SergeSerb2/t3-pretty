#!/usr/bin/env bash
# Source from packaging scripts. Fresh hosted Macs (macos-large) do not ship
# `vp`; the former macos-release image did. Pin VP_HOME to ~/.vite-plus — the
# directory release scripts already put on PATH — then install Vite+ when vp
# is missing. Global CLIs installed later with npm (eas-cli) also go through
# this file so Vite+'s bin-link prompt cannot hang a TTY-less CI job.
#
# Windows Git Bash cannot exec the extensionless `vp` path (exit 126) even
# when `vp.exe` is next to it. Finding the PE is not enough: Git Bash may
# still get Permission denied on the agent-tree `.exe` (BK #2838). Launch
# `.exe` via `cmd.exe //c` (same as `.cmd`/`.bat`) and copy to a writable
# bin when that path cannot be executed. windows-release already ships
# official Vite+ under `C:\buildkite-agent\vite-plus` (`bin\vp.exe` and/or
# a versioned `1.0.0-rc.0\bin\vp.exe`). Do not reinstall into that prefix
# when it is not writable (BK #2834 Access denied).
#
# Tests set T3CODE_VITE_PLUS_INSTALLER to a controlled script so this block
# can run without hitting the network.

vite_plus_home() {
  printf '%s\n' "${VP_HOME:-${HOME}/.vite-plus}"
}

vite_plus_is_windows() {
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) return 0 ;;
  esac
  return 1
}

vite_plus_dir_writable() {
  local dir="$1"
  local probe
  mkdir -p "$dir" 2>/dev/null || return 1
  probe="${dir}/.t3-vp-write-$$"
  if ! (: > "$probe") 2>/dev/null; then
    return 1
  fi
  rm -f "$probe"
  return 0
}

# Prefer ~/.vite-plus, then a job temp, when the pinned agent prefix cannot
# be written (LocalSystem vs an admin-owned C:\buildkite-agent\vite-plus).
# Print every usable home so a copy can skip dest==src and try the next.
vite_plus_writable_homes() {
  local candidate locked
  locked="$(vite_plus_home)"
  for candidate in \
    "${HOME}/.vite-plus" \
    "${TMPDIR:-/tmp}/t3-vite-plus"; do
    if [[ "$candidate" == "$locked" ]]; then
      continue
    fi
    if vite_plus_dir_writable "$candidate"; then
      printf '%s\n' "$candidate"
    fi
  done
}

vite_plus_writable_home() {
  local candidate
  while IFS= read -r candidate; do
    printf '%s\n' "$candidate"
    return 0
  done < <(vite_plus_writable_homes)
  return 1
}

vite_plus_writable_bins() {
  local home
  while IFS= read -r home; do
    printf '%s\n' "${home}/bin"
  done < <(vite_plus_writable_homes)
}

vite_plus_writable_bin() {
  local bin
  while IFS= read -r bin; do
    printf '%s\n' "$bin"
    return 0
  done < <(vite_plus_writable_bins)
  return 1
}

# Agent vite-plus first (NSIS / buildkite-agent.exe style), then VP_HOME.
vite_plus_windows_search_roots() {
  local home
  home="$(vite_plus_home)"
  printf '%s\n' /c/buildkite-agent/vite-plus
  if [[ "$home" != /c/buildkite-agent/vite-plus ]]; then
    printf '%s\n' "$home"
  fi
}

# Git Bash reports `/c/.../bin/vp` and then fails execve without the .exe
# suffix. Copy a Windows PE that was saved extensionless, or chmod a shebang.
# In-place copy into a locked agent prefix fails with Access denied; fall
# back to a writable bin and print the path that can actually be exec'd.
vite_plus_windows_repair_cli() {
  local src="$1"
  local dest="${src}.exe"
  local magic writable
  [[ -f "$src" ]] || return 1
  if [[ -f "$dest" ]]; then
    printf '%s\n' "$dest"
    return 0
  fi
  magic="$(head -c 2 "$src" 2>/dev/null || true)"
  if [[ "$magic" == "MZ" ]]; then
    if cp "$src" "$dest" 2>/dev/null; then
      printf '%s\n' "$dest"
      return 0
    fi
    writable="$(vite_plus_writable_bin)" || return 1
    dest="${writable}/$(basename "$src").exe"
    mkdir -p "$writable" || return 1
    cp "$src" "$dest" || return 1
    printf '%s\n' "$dest"
    return 0
  fi
  if [[ "$magic" == "#!" ]]; then
    chmod +x "$src" || return 1
    printf '%s\n' "$src"
    return 0
  fi
  return 1
}

vite_plus_windows_walk_bins() {
  local root="$1"
  local suffix="$2"
  local candidate version_dir
  [[ -d "$root" ]] || return 0
  for candidate in \
    "${root}/bin/${suffix}" \
    "${root}/current/bin/${suffix}"; do
    if [[ -e "$candidate" ]]; then
      printf '%s\n' "$candidate"
    fi
  done
  # Monolithic Vite+ layout: VP_HOME/<version>/bin/vp.exe
  for version_dir in "${root}"/*; do
    [[ -d "${version_dir}/bin" ]] || continue
    case "$(basename "$version_dir")" in
      bin | current | cache | data | config | state | package_manager) continue ;;
    esac
    candidate="${version_dir}/bin/${suffix}"
    if [[ -e "$candidate" ]]; then
      printf '%s\n' "$candidate"
    fi
  done
}

vite_plus_windows_list_cli() {
  local name="$1"
  local root="$2"
  local candidate
  while IFS= read -r candidate; do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
    fi
  done < <(
    vite_plus_windows_walk_bins "$root" "${name}.exe"
    vite_plus_windows_walk_bins "$root" "${name}.cmd"
  )
}

vite_plus_windows_list_extensionless() {
  local name="$1"
  local root="$2"
  local candidate
  while IFS= read -r candidate; do
    [[ -f "$candidate" ]] || continue
    if [[ -f "${candidate}.exe" || -f "${candidate}.cmd" ]]; then
      continue
    fi
    printf '%s\n' "$candidate"
  done < <(vite_plus_windows_walk_bins "$root" "$name")
}

vite_plus_resolve_cli() {
  local name="$1"
  local candidate repaired root
  if vite_plus_is_windows; then
    while IFS= read -r root; do
      while IFS= read -r candidate; do
        repaired="$(vite_plus_windows_make_launchable "$candidate" || true)"
        if [[ -n "$repaired" && -f "$repaired" ]]; then
          printf '%s\n' "$repaired"
          return 0
        fi
      done < <(vite_plus_windows_list_cli "$name" "$root")
    done < <(vite_plus_windows_search_roots)
    candidate="$(command -v "${name}.exe" 2>/dev/null || true)"
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      repaired="$(vite_plus_windows_make_launchable "$candidate" || true)"
      if [[ -n "$repaired" && -f "$repaired" ]]; then
        printf '%s\n' "$repaired"
        return 0
      fi
    fi
    candidate="$(command -v "${name}.cmd" 2>/dev/null || true)"
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      repaired="$(vite_plus_windows_make_launchable "$candidate" || true)"
      if [[ -n "$repaired" && -f "$repaired" ]]; then
        printf '%s\n' "$repaired"
        return 0
      fi
    fi
    while IFS= read -r root; do
      while IFS= read -r candidate; do
        repaired="$(vite_plus_windows_repair_cli "$candidate" || true)"
        if [[ -n "$repaired" && -f "$repaired" ]]; then
          repaired="$(vite_plus_windows_make_launchable "$repaired" || true)"
        fi
        if [[ -n "$repaired" && -f "$repaired" ]]; then
          printf '%s\n' "$repaired"
          return 0
        fi
      done < <(vite_plus_windows_list_extensionless "$name" "$root")
    done < <(vite_plus_windows_search_roots)
    return 1
  fi
  candidate="$(command -v "$name" 2>/dev/null || true)"
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  return 1
}

vite_plus_windows_path() {
  local path="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$path"
    return
  fi
  printf '%s\n' "$path"
}

vite_plus_cmd_exe() {
  local candidate
  candidate="$(command -v cmd.exe 2>/dev/null || true)"
  if [[ -n "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  for candidate in \
    /c/Windows/System32/cmd.exe \
    /c/WINDOWS/System32/cmd.exe \
    /c/Windows/SysWOW64/cmd.exe; do
    if [[ -x "$candidate" || -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

# Git Bash execve of a PE under the agent tree can still be 126
# (Permission denied) even when vp.exe exists (BK #2838). cmd.exe
# starts Windows binaries the same way we already launch .cmd/.bat.
vite_plus_spawn_cli() {
  local cmd="$1"
  shift
  local comspec
  case "$cmd" in
    *.exe | *.cmd | *.bat)
      if comspec="$(vite_plus_cmd_exe)"; then
        "$comspec" //c "$(vite_plus_windows_path "$cmd")" "$@"
        return
      fi
      ;;
  esac
  "$cmd" "$@"
}

vite_plus_cli_launchable() {
  local cmd="$1"
  local status=0
  local magic
  [[ -f "$cmd" ]] || return 1
  # Mocked Git Bash tests run on Linux. A real PE (MZ) cannot exec here
  # unless a fake cmd.exe is on PATH; accept it the same way a Windows
  # host will launch it via cmd.exe. Shebang fixtures still get a probe
  # so a 644 vp.exe is not treated as official (BK #2838).
  if [[ "$cmd" == *.exe ]] && ! vite_plus_cmd_exe >/dev/null; then
    magic="$(head -c 2 "$cmd" 2>/dev/null || true)"
    if [[ "$magic" == "MZ" ]]; then
      return 0
    fi
  fi
  # Only a successful --version is launchable. Git Bash 126/127 cannot
  # spawn the PE (BK #2838). The rust launcher can also start and then
  # fail with Access denied while writing a temp under the locked agent
  # prefix (BK #2834). Treating that non-zero as official left later
  # `vp i` on the same unwritable tree. Copy to a writable bin instead.
  vite_plus_spawn_cli "$cmd" --version >/dev/null 2>&1 || status=$?
  [[ "$status" -eq 0 ]]
}

vite_plus_windows_copy_cli() {
  local src="$1"
  local writable dest base
  base="$(basename "$src")"
  while IFS= read -r writable; do
    dest="${writable}/${base}"
    case "$src" in
      *.exe | *.cmd | *.bat) ;;
      *) dest="${writable}/${base}.exe" ;;
    esac
    # First writable bin is often ~/.vite-plus/bin. If src already lives
    # there, dest==src used to abort and never reach TMPDIR/t3-vite-plus.
    if [[ "$dest" == "$src" ]]; then
      continue
    fi
    mkdir -p "$writable" || continue
    if ! cp "$src" "$dest"; then
      continue
    fi
    chmod +x "$dest" 2>/dev/null || true
    printf '%s\n' "$dest"
    return 0
  done < <(vite_plus_writable_bins)
  return 1
}

# Prefer cmd.exe / in-place +x. If Git Bash still cannot spawn the
# agent-tree PE, copy into ~/.vite-plus/bin or a job temp — never write
# back into a locked C:\buildkite-agent\vite-plus (BK #2834).
vite_plus_windows_make_launchable() {
  local src="$1"
  local dest
  [[ -f "$src" ]] || return 1
  if vite_plus_cli_launchable "$src"; then
    printf '%s\n' "$src"
    return 0
  fi
  if chmod +x "$src" 2>/dev/null && vite_plus_cli_launchable "$src"; then
    printf '%s\n' "$src"
    return 0
  fi
  dest="$(vite_plus_windows_copy_cli "$src")" || return 1
  if vite_plus_cli_launchable "$dest"; then
    printf '%s\n' "$dest"
    return 0
  fi
  return 1
}

vite_plus_exec_cli() {
  local name="$1"
  shift
  local cmd
  cmd="$(vite_plus_resolve_cli "$name")" || {
    echo "${name} is not installed" >&2
    return 127
  }
  vite_plus_spawn_cli "$cmd" "$@"
}

vite_plus_bind_windows_cli() {
  local name="$1"
  vite_plus_is_windows || return 0
  case "$name" in
    vp) vp() { vite_plus_exec_cli vp "$@"; } ;;
    eas) eas() { vite_plus_exec_cli eas "$@"; } ;;
    *)
      eval "${name}() { vite_plus_exec_cli $(printf '%q' "$name") \"\$@\"; }"
      ;;
  esac
}

vite_plus_cli_available() {
  local name="$1"
  if vite_plus_is_windows; then
    vite_plus_resolve_cli "$name" >/dev/null
    return
  fi
  command -v "$name" >/dev/null
}

vite_plus_on_path() {
  local cmd cmd_dir
  export VP_HOME
  VP_HOME="$(vite_plus_home)"
  export PATH="${VP_HOME}/bin:${PATH}"
  if vite_plus_is_windows; then
    cmd="$(vite_plus_resolve_cli vp || true)"
    if [[ -n "$cmd" ]]; then
      cmd_dir="$(dirname "$cmd")"
      export PATH="${cmd_dir}:${PATH}"
    fi
    vite_plus_bind_windows_cli vp
  fi
}

vp_is_official() {
  local out cmd
  if vite_plus_is_windows; then
    cmd="$(vite_plus_resolve_cli vp)" || return 1
    case "$cmd" in
      *.exe | *.cmd | *.bat)
        # resolve already required a launchable path: --version 0,
        # cmd.exe spawn, or a writable copy. A locked-prefix PE whose
        # rust --version hits Access denied is copied first (BK #2834).
        return 0
        ;;
    esac
  elif ! command -v vp >/dev/null; then
    return 1
  fi
  # A failed exec (Git Bash 126) used to look official: empty output is not
  # the npm `npx vp` stub. Require a real version string.
  out="$(vp --version 2>&1)" || return 1
  [[ -n "$out" && "$out" != *"npx vp"* ]]
}

install_vite_plus() {
  local fallback
  export CI="${CI:-true}"
  export VP_HOME
  VP_HOME="$(vite_plus_home)"
  if vite_plus_is_windows && ! vite_plus_dir_writable "$VP_HOME"; then
    fallback="$(vite_plus_writable_home)" || return 1
    echo "VP_HOME ${VP_HOME} is not writable; installing Vite+ into ${fallback}"
    VP_HOME="$fallback"
    export VP_HOME
  fi
  if [[ -n "${T3CODE_VITE_PLUS_INSTALLER:-}" ]]; then
    bash "${T3CODE_VITE_PLUS_INSTALLER}"
    return
  fi
  curl -fsSL https://vite.plus | bash
}

ensure_vite_plus() {
  local purpose="${1:-to run this job}"
  local fallback
  vite_plus_on_path
  if vp_is_official; then
    return 0
  fi
  if vite_plus_is_windows && ! vite_plus_dir_writable "$(vite_plus_home)"; then
    fallback="$(vite_plus_writable_home)" || {
      echo "Vite+ install failed; ${VP_HOME} is not writable and no alternate prefix is available." >&2
      return 1
    }
    echo "vp is missing; ${VP_HOME} is not writable. Installing Vite+ into ${fallback}"
    export VP_HOME="$fallback"
    vite_plus_on_path
    if vp_is_official; then
      return 0
    fi
  else
    echo "vp is missing; installing Vite+ into ${VP_HOME}"
  fi
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

# After `npm install -g`, Vite+ may ask to symlink the new CLI into VP_HOME/bin.
# That [Y/n] prompt still appears under CI=true and hangs a TTY-less Buildkite
# job (hosted M4 iOS OTA, build 1883). Treat CI, Buildkite, or a non-TTY stdin
# as auto-link.
vite_plus_noninteractive() {
  [[ -n "${CI:-}" || -n "${BUILDKITE:-}" || ! -t 0 ]]
}

vite_plus_npm_global_bin() {
  command -v npm >/dev/null || return 1
  printf '%s\n' "$(npm prefix -g)/bin"
}

# Put `name` on PATH via VP_HOME/bin without prompting. Source is an explicit
# path, `command -v`, or npm's global bin.
vite_plus_link_bin() {
  local name="$1"
  local src="${2:-}"
  local bin dest
  bin="$(vite_plus_home)/bin"
  dest="${bin}/${name}"
  if [[ -x "$dest" || -f "${dest}.exe" || -f "${dest}.cmd" ]]; then
    return 0
  fi
  if [[ -z "$src" ]]; then
    src="$(command -v "$name" 2>/dev/null || true)"
  fi
  if [[ -z "$src" || "$src" == "$dest" ]] && command -v npm >/dev/null; then
    src="$(npm prefix -g)/bin/${name}"
    if [[ ! -e "$src" && -e "$(npm prefix -g)/bin/${name}.cmd" ]]; then
      src="$(npm prefix -g)/bin/${name}.cmd"
    fi
  fi
  if [[ ! -e "$src" || "$src" == "$dest" ]]; then
    echo "Could not find ${name} to link into ${bin}." >&2
    return 1
  fi
  mkdir -p "$bin"
  ln -sfn "$src" "$dest"
}

# Install a global npm CLI and make it visible on PATH. On CI / non-TTY, answer
# Vite+'s bin-link prompt and create the link ourselves if the shim never does.
vite_plus_install_global_cli() {
  local pkg="$1"
  local name="${2:-$1}"
  local npm_bin
  vite_plus_on_path
  if npm_bin="$(vite_plus_npm_global_bin)"; then
    export PATH="${npm_bin}:${PATH}"
  fi
  if vite_plus_cli_available "$name"; then
    vite_plus_bind_windows_cli "$name"
    return 0
  fi
  if ! command -v npm >/dev/null; then
    echo "npm is required to install ${pkg}." >&2
    return 1
  fi
  if vite_plus_noninteractive; then
    export CI="${CI:-true}"
    # Several Y answers cover extra bins from one package. Avoid `yes` under
    # pipefail: yes dies with SIGPIPE when npm closes stdin.
    printf 'y\ny\ny\ny\ny\n' | npm install -g "$pkg"
    vite_plus_link_bin "$name"
  else
    npm install -g "$pkg"
  fi
  if npm_bin="$(vite_plus_npm_global_bin)"; then
    export PATH="${npm_bin}:${PATH}"
  fi
  vite_plus_on_path
  if ! vite_plus_cli_available "$name"; then
    echo "${name} is missing after installing ${pkg}." >&2
    return 1
  fi
  vite_plus_bind_windows_cli "$name"
}
