# T3 Pretty feature brainstorm (2026-08-22)

> For maintainers. A ranked idea list, not a roadmap commitment.

Prompt: as many new features as we could think of — fun and not-necessarily-fun,
but helpful and productive — ranked into a top ten from most useful to least.

Grounding: this list was written against the documented feature set
(`docs/user/`, `docs/internals/glossary.md`) so it avoids re-proposing things
that already exist (skills, subagents, apps/MCP, checkpoints and revert,
auto-PRs, usage review, storage inventory, world scenery, T3 Connect remote
access, pairing, keybindings, permission modes). Where an idea might overlap
something undocumented, it says so.

## The long list

Productivity first, then the fun ones.

1. **Turn-finished and approval-needed notifications everywhere** — desktop
   push + mobile push when a turn completes, fails, or blocks on a permission
   prompt, with approve/deny quick actions inline in the notification.
2. **Mission control board** — a kanban across all projects and threads:
   running / awaiting approval / done / failed, with bulk actions (retry,
   archive, open PR). Built for people driving many agents at once.
3. **Scheduled and recurring turns** — server-side cron prompts: "weekdays
   09:00, run the dependency-update recipe on repo X". The event-sourced
   server makes this a new command, not a new subsystem.
4. **Diff review mode with inline comments** — review a turn's checkpoint diff
   like a PR: comment on lines, then send all comments as one steering
   message into the thread. Tightens the most common loop.
5. **Thread forking / branch-from-checkpoint** — fork a thread at any message
   or checkpoint into a new thread and worktree, to explore an alternative
   approach without losing the original.
6. **Full-text search across threads** — FTS over messages, activities, and
   diffs across all projects. No documented equivalent today.
7. **PR/CI status rail in the sidebar** — threads with an open PR show live
   check status and review state; one click to open. Closes the loop that
   auto-PRs start.
8. **Token and cost budgets per thread** — set a budget, warn at 80%,
   auto-pause at 100%. Extends usage review from reporting to guardrails.
9. **Conflict radar across parallel worktrees** — warn when two active
   threads' diffs touch the same files, before the merge conflict happens.
10. **Provider A/B arena** — send one prompt to two providers in parallel
    worktrees, compare the diffs side by side, keep the winner. Showcases the
    five-adapter architecture.
11. **Read-only share links** — share a live, scoped, view-only link to one
    thread with a teammate, instead of full pairing.
12. **"Why is it stuck" diagnostics** — one panel showing pending approvals,
    queued commands, last activity, and process state, with nudge/kill
    actions, for when an agent goes silently quiet.
13. **Daily digest / standup** — morning summary across threads: what merged,
    what's blocked, what needs review, delivered in-app and to mobile.
14. **Recipes (parameterized prompt templates)** — saved prompt + provider +
    permission mode + skills, one click to launch; variables like `$BRANCH`.
15. **Offline outbox on mobile** — compose follow-ups with no connection;
    they send when the server is reachable again.
16. **Switch provider mid-thread** — hand off a thread between providers with
    an auto-generated context note so the new agent isn't starting cold.
17. **Provider health and quota dashboard** — which providers are near
    rate limits, with failover suggestions.
18. **Voice input and audio briefings on mobile** — dictate prompts; get a
    spoken "what happened overnight" summary.
19. **Photo-to-prompt on mobile** — snap a screenshot of a bug, annotate it,
    attach it straight into a new thread.
20. **Auto thread titles and tags** — generated titles/tags so the sidebar
    stays navigable at 200 threads. Verify against current sidebar behavior
    first.
21. **One-click storage reclaim** — the storage inventory exists; add a
    "reclaim X GB safely" wizard with sane defaults.
22. **Thread time-lapse replay** — replay a turn's activity stream as a
    time-lapse. Postmortems, demos, and marketing clips from the same data.
23. **Sound cues** — subtle turn-complete / approval-needed sounds with
    per-project mute. Must be off by default; our users notice lying
    spinners, and they'd notice an annoying ding more.
24. **Scenery that reflects state** — world scenery reacts to real events:
    confetti on merge, rain when checks fail, calm when idle. On-brand for
    Pretty, and glanceable ambient status.
25. **Companion mascot** — a small creature that sleeps when agents are idle
    and celebrates merges. Pure joy, zero utility, keep it out of the render
    hot path (see the performance motion plans).
26. **Achievement stats** — "agents driven this week", "longest unattended
    turn", a year-in-review. Fun, shareable, cheap.

## Top ten, ranked most useful to least

Ranking criteria: how often it helps in a normal week, fit with the
remote-ready multi-surface architecture, and whether it compounds features we
already have (checkpoints, auto-PRs, usage review, pairing).

### 1. Turn-finished and approval-needed notifications

The single biggest multiplier for how people actually use the app: start an
agent, walk away, get pulled back exactly when needed. Mobile approve/deny
quick actions turn the phone into a remote control for permission prompts.
Touches contracts (notification events), server push, and all three clients —
which is exactly why it should be designed once, up front.

### 2. Mission control board

Our users drive fleets of agents. One glanceable board of
running/blocked/done across projects, with bulk actions, is the difference
between "three agents" and "thirty". It's a read-model view over state we
already project — no new source of truth.

### 3. Scheduled and recurring turns

"Agents while you sleep" is the natural next step after remote access. A
`thread.turn.schedule` command plus a server-side scheduler reactor fits the
event-sourced design cleanly, and pairs with notifications (#1) for the
morning review.

### 4. Diff review mode with inline comments

The most common real workflow is: agent works → human reviews diff → human
asks for changes. Inline comments that become one steering message make that
loop first-class inside the app instead of leaking it to a PR too early.

### 5. Thread forking / branch-from-checkpoint

Checkpoints already give every turn a hidden git ref. Exposing "fork from
here" turns them from an undo button into an exploration tool — try the
other approach without losing the current one. Small contract surface, big
behavioral win.

### 6. Full-text search across threads

Basic, unglamorous, and missed every day once a user has more than a few
dozen threads. SQLite FTS over the event store tables is well-trodden; the
main work is deciding what to index (messages, activities, diffs).

### 7. PR/CI status rail in the sidebar

Auto-PRs opened the loop; this closes it. A live check-status badge per
thread removes the constant tab-switch to the forge, and gives the board
(#2) a "merged" column for free later.

### 8. Token and cost budgets per thread

Usage review tells you what you spent; budgets stop you from overspending.
Warn + auto-pause is a small decider change with an outsized trust win,
especially for unattended and scheduled (#3) runs.

### 9. Conflict radar across parallel worktrees

The classic multi-agent footgun is two threads editing the same file. We
already compute turn diffs per checkpoint, so comparing touched-path sets
across active threads is cheap and prevents genuinely painful merges.

### 10. Provider A/B arena

Part productivity, part fun: run the same prompt through two providers in
parallel worktrees and pick the better diff. Genuinely useful for choosing a
model per task type, and it's the best possible demo of the five-adapter
architecture. Ranked last because it's a power feature, not a daily one.

## Notes

- Fun candidates worth doing once the top few land: state-reactive scenery
  (#24), sound cues (#23), time-lapse replay (#22), the mascot (#25).
- Everything here must respect the standing rules: no per-frame repaints,
  contracts first for anything crossing the wire, every surface (web,
  desktop, mobile) considered per feature, and every way in gets a way out.
