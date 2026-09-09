# Project settings

Open **Settings → Projects**. The project and machine pickers start at **All projects** and
**All machines**.

Change the default model, workspace, automatic pull, agent browser access, or actions for projects that inherit those values.
Select an individual project to override a default. Reset its row to inherit again. Changing a
default preserves explicit project overrides. Workspace preferences in `t3.json` take precedence
over machine defaults when the project has no explicit workspace override.

Select a machine to limit edits to it. **All machines** writes defaults to connected machines;
offline machines keep their previous values. Mixed values are indicated when selected machines
or checkouts disagree. Browser access changes apply when an agent session next starts.

Project grouping has a client-wide default across machines, with individual checkout overrides.
Shared actions apply to inheriting projects; editing a project's actions creates an independent list.
Reset that list to use shared actions again. Existing project actions are preserved.

Project names, icons, removal, and importing actions from a checkout remain project-specific.
When there are several checkouts, the checkout picker selects which actions and grouping to edit.

## Project icons

Choose an icon, emoji, or image from the project to make it easier to recognize. The choice applies
to selected checkouts in the project group and appears on connected clients. Choose **Automatic** to
let T3 Code detect an icon again.

## Keep the default branch current

Enable **Automatically pull** to keep the default-branch checkout up to date with its configured
upstream.

T3 Code only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume. Pull failures do not prevent the
server from starting.

Starting a **New worktree** thread also fast-forwards the base branch when the worktree begins
from origin. The branch only moves when it is behind, and a checkout of it with changed files stays
untouched.

## Automations

A project's settings list its automations: the saved prompts T3 Code runs on a schedule, on an
in-app event, on a webhook delivery, when a git branch moves, or when you press **Run now**. Each
row shows the automation's status and either the time until its next run or **Paused**, and opens
its page.

**New automation** starts a thread that asks an agent to set one up with you; **Create manually**
opens the form instead. See [Automations](./automations.md) for triggers, run history, and what a
run is allowed to do. The section is on web and desktop; mobile can view and control existing
automations but not create them.
