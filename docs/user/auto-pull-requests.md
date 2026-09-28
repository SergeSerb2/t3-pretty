# Automatic Pull Requests

T3 Code can ask the agent to open a pull request when it finishes a task. Turn it on once and every new task you start ends with a pushed branch and an open PR — no follow-up message needed.

## The PR Toggle

When you start a new task in a Git repository, the composer offers a **PR** control:

- **Web and desktop** – a **PR** chip in the composer footer. Click it to turn create-PR on or off. The chevron opens **Fix reviews & auto-merge**. On a narrow footer the same options live in the `⋯` menu.
- **Mobile** – a **PR** pill in the new-task composer toolbar, plus a **Merge** pill once create-PR is on

While create-PR is on, the first message of the task carries an instruction asking the agent to create a pull request after finishing the work. **Fix reviews & auto-merge** adds a second instruction: watch Auto Review and review comments, apply real fixes, and merge (or enable auto-merge) once required checks are green. It ignores Buildkite / PR deployment status. The instructions stay hidden from your chat transcript — you see only what you typed.

## Defaults

The toggles remember your choice separately for each workspace mode:

- **New worktree tasks** – create-PR on by default. Worktree tasks produce an isolated branch, so their work is expected to land as a pull request.
- **Local checkout tasks** – create-PR off by default.
- **Fix reviews & auto-merge** – off by default in every mode. Turning it on also turns create-PR on; turning create-PR off turns this off too.

Flip the toggles at any time; your choices for that mode are remembered on this device.

## What the Agent Does

When a task starts with the PR instruction, the agent finishes your requested work and then:

1. Creates a feature branch first if the task is on the repository's default branch — it never commits or pushes directly to `main`
2. Fetches the latest changes and merges (or rebases) the repository's default branch — usually `main` — into the task's branch, resolving conflicts
3. Reviews the branch diff and commits any remaining changes
4. **Pushes the branch to your remote** and **opens a pull request** against the default branch, following the repository's PR template if present

If **Fix reviews & auto-merge** is also on, the agent then stays with that PR: it applies real Auto Review and review-comment findings, dismisses invalid comments with a reason, and merges (or arms auto-merge) when required checks are green. It ignores Buildkite / PR deployment status and is done once auto-merge is armed or the PR is merged. It reports instead of guessing on security, auth, billing, or conflicting-intent questions.

Because this pushes to your remote, opens a PR, and can merge it, leave the toggles off for exploratory work you don't want published.

## Details

- The instruction rides only the **first** message of a task. Follow-up messages in the same thread never re-send it; to request a PR later, just ask the agent.
- Choosing **Implement in new thread** from a proposed plan carries the instruction into the implementation thread when the toggle is on.
- Tasks queued while offline capture the toggle's state at queue time. Editing a queued task keeps its original choice unless you flip the toggle while editing.
