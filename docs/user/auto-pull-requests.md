# Automatic Pull Requests

T3 Code can ask the agent to open a pull request when it finishes a task. Turn it on once and every new task you start ends with a pushed branch and an open PR — no follow-up message needed.

## The PR Toggle

When you start a new task in a Git repository, the composer offers a **Create PR when done** toggle:

- **Web and desktop** – **Create PR when done** in the composer footer's `⋯` menu; the `⋯` button shows a dot while it is on
- **Mobile** – a **PR** pill in the new-task composer toolbar

While the toggle is on, the first message of the task carries an instruction asking the agent to create a pull request after finishing the work. The instruction itself stays hidden from your chat transcript — you see only what you typed.

## Defaults

The toggle remembers your choice separately for each workspace mode:

- **New worktree tasks** – on by default. Worktree tasks produce an isolated branch, so their work is expected to land as a pull request.
- **Local checkout tasks** – off by default.

Flip the toggle at any time; your choice for that mode is remembered on this device.

## What the Agent Does

When a task starts with the PR instruction, the agent finishes your requested work and then:

1. Creates a feature branch first if the task is on the repository's default branch — it never commits or pushes directly to `main`
2. Fetches the latest changes and merges (or rebases) the repository's default branch — usually `main` — into the task's branch, resolving conflicts
3. Reviews the branch diff and commits any remaining changes
4. **Pushes the branch to your remote** and **opens a pull request** against the default branch, following the repository's PR template if present

Because this pushes to your remote and creates a PR on your Git hosting provider, leave the toggle off for exploratory work you don't want published.

## Details

- The instruction rides only the **first** message of a task. Follow-up messages in the same thread never re-send it; to request a PR later, just ask the agent.
- Choosing **Implement in new thread** from a proposed plan carries the instruction into the implementation thread when the toggle is on.
- Tasks queued while offline capture the toggle's state at queue time. Editing a queued task keeps its original choice unless you flip the toggle while editing.
