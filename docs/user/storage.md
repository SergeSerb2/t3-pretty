# Storage

Settings → Storage shows disk use for **managed worktrees** on each connected environment: the
isolated checkouts T3 Code creates for threads. Project folders you opened yourself are never
counted and never deleted from here.

Disconnected or offline environments are left alone. Opening Storage does not reconnect them, and
older servers that do not advertise storage inventory are not probed — update that server, then
reopen the page.

## What the totals include

The headline is allocated on-disk bytes for:

- **Active worktrees** — threads that currently keep a managed checkout
- **Archived worktrees** — archived threads that still keep a checkout on disk
- **Orphan checkouts** — folders under the environment's managed worktrees directory that no thread
  owns, usually left behind after a crash or a manual delete

Shared checkouts are counted once, even when several threads point at the same path.

## Cleanup

- **Remove clean settled worktrees** unlinks settled or archived threads whose working tree is
  known to be clean, then deletes the folder if nothing else still uses it. Threads remain and
  return to the project checkout.
- **Remove all settled worktrees** does the same for every settled or archived worktree that is
  safe to remove, including trees with uncommitted or unread changes. Dirty files cannot be
  recovered.
- **Delete archived threads with worktrees** permanently deletes those archived threads and their
  managed checkouts.
- **Remove orphan checkouts** deletes leftover folders under the managed worktrees directory only.

A thread that is still waiting on you, or that you pinned active, is not treated as removable.
Missing git status is treated as unsafe, never as a clean tree.

On web and desktop, **Open** reveals the managed worktrees folder in your editor. On mobile, Storage
is **Environment Storage**, separate from **Client Storage**, which only clears this device's
offline cache.
