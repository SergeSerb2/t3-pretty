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

<<<<<<< HEAD
To generate icons with Grok or Codex:

1. Open **Settings** and select **General**.
2. Turn on **Auto-generate project icons**.

T3 Code then generates an icon for new projects and for existing projects that do not already have
a stored icon, including projects still using automatic detection. This uses your Grok or Codex
subscription. Claude, Cursor, and Kimi do not generate images. Projects with a chosen file, Lucide
icon, emoji, or previously generated icon are left alone.

Choose an icon, emoji, or image to make the project easier to recognize. The choice applies to
every checkout in the project group and appears on connected clients.

To choose a different icon or emoji:

1. Open **Settings** and select **Projects**.
2. Select the project.
3. Next to **Project icon**, select **Choose icon**.
4. Search the full Lucide icon set and choose a color, or switch to **Emoji** and choose or paste
   an emoji.

To use an image instead, select **Choose file**. Search for an image in the project, or select
**Browse in Finder** (Explorer on Windows) to pick any image on your computer. Images chosen from
your computer are stored with T3 Code, not in the project repository, so you don't need to commit
them.

T3 Code supports SVG, PNG, ICO, JPEG, GIF, AVIF, and WebP files. A project-file path applies to
each checkout in the project group. An icon picked from your computer is stored on that machine and
appears on your connected clients.

To use automatic detection again, select **Automatic**.
=======
Choose an icon, emoji, or image from the project to make it easier to recognize. The choice applies
to selected checkouts in the project group and appears on connected clients. Choose **Automatic** to
let T3 Code detect an icon again.
>>>>>>> v0.0.39-nightly.20260907.1332

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
