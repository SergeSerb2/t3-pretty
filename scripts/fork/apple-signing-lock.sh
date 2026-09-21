#!/usr/bin/env bash

# The scheduled upstream sync runs mobile publishing inline, outside the
# Buildkite concurrency group shared by the normal macOS and iOS jobs. Both
# paths replace the user keychain search list, so they also need a host lock.
apple_signing_lockdir="/tmp/t3-pretty-ios-mobile.lock"
apple_signing_lock_held=0

apple_signing_process_started_at() {
  ps -p "$1" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

apple_signing_lock_initializing() {
  local modified now age
  modified="$(stat -f %m "$apple_signing_lockdir" 2>/dev/null || true)"
  if [[ ! "$modified" =~ ^[0-9]+$ ]]; then
    modified="$(stat -c %Y "$apple_signing_lockdir" 2>/dev/null || true)"
  fi
  [[ "$modified" =~ ^[0-9]+$ ]] || return 1
  now="$(date +%s)"
  age=$((now - modified))
  (( age >= 0 && age <= ${T3CODE_APPLE_SIGNING_LOCK_INIT_SECONDS:-2} ))
}

apple_signing_lock_holder_alive() {
  local pid recorded_start current_start cmd
  if [[ ! -f "$apple_signing_lockdir/pid" ]]; then
    apple_signing_lock_initializing
    return
  fi
  pid="$(tr -d '[:space:]' < "$apple_signing_lockdir/pid" || true)"
  if [[ ! "$pid" =~ ^[0-9]+$ ]] || ! kill -0 "$pid" 2>/dev/null; then
    apple_signing_lock_initializing
    return
  fi

  # New locks record process start time so PID reuse cannot preserve a stale
  # lock. Recognize old mobile-only locks by their command during rollout.
  recorded_start="$(cat "$apple_signing_lockdir/started-at" 2>/dev/null || true)"
  current_start="$(apple_signing_process_started_at "$pid")"
  if [[ -n "$recorded_start" ]]; then
    [[ "$recorded_start" == "$current_start" ]]
    return
  fi
  cmd="$(ps -p "$pid" -o command= 2>/dev/null || true)"
  case "$cmd" in
    *publish-mobile-release.sh* | *build-macos-dmg.sh*) return 0 ;;
  esac
  return 1
}

apple_signing_lock_acquire() {
  local deadline
  deadline=$((SECONDS + ${T3CODE_APPLE_SIGNING_LOCK_TIMEOUT_SECONDS:-900}))
  while ! mkdir "$apple_signing_lockdir" 2>/dev/null; do
    if apple_signing_lock_holder_alive; then
      if (( SECONDS >= deadline )); then
        echo "Timed out waiting for Apple signing on this Mac." >&2
        return 1
      fi
      echo "Waiting for Apple signing on this Mac..."
      sleep "${T3CODE_APPLE_SIGNING_LOCK_POLL_SECONDS:-10}"
      continue
    fi
    echo "Removing stale Apple signing lock at $apple_signing_lockdir"
    rm -f \
      "$apple_signing_lockdir/pid" \
      "$apple_signing_lockdir/pid.pending" \
      "$apple_signing_lockdir/started-at" \
      "$apple_signing_lockdir/started-at.pending"
    if ! rmdir "$apple_signing_lockdir" 2>/dev/null; then
      echo "Apple signing lock contains unexpected files; refusing to remove it." >&2
      return 1
    fi
  done
  printf '%s\n' "$$" > "$apple_signing_lockdir/pid.pending"
  mv "$apple_signing_lockdir/pid.pending" "$apple_signing_lockdir/pid"
  apple_signing_process_started_at "$$" > "$apple_signing_lockdir/started-at.pending"
  mv "$apple_signing_lockdir/started-at.pending" "$apple_signing_lockdir/started-at"
  apple_signing_lock_held=1
}

apple_signing_lock_release() {
  local pid
  [[ "$apple_signing_lock_held" == "1" ]] || return 0
  pid="$(tr -d '[:space:]' < "$apple_signing_lockdir/pid" 2>/dev/null || true)"
  if [[ "$pid" == "$$" ]]; then
    rm -f \
      "$apple_signing_lockdir/pid" \
      "$apple_signing_lockdir/pid.pending" \
      "$apple_signing_lockdir/started-at" \
      "$apple_signing_lockdir/started-at.pending"
    rmdir "$apple_signing_lockdir" 2>/dev/null || true
  fi
  apple_signing_lock_held=0
}
