# Project settings

Open **Settings → Projects** and select a project to change its preferences.

## Project icons

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

## Keep the default branch current

Enable **Automatically pull** to keep the default-branch checkout up to date with its configured
upstream.

T3 Code only pulls when it can fast-forward and the checkout has no changed files, untracked files,
or local commits. It skips checkouts on another branch or without an upstream. If a checkout has
local work, resolve it yourself before automatic pulls can resume. Pull failures do not prevent the
server from starting.

## Automations

A project's settings list its automations: the saved prompts T3 Code runs on a schedule, on an
in-app event, on a webhook delivery, when a git branch moves, or when you press **Run now**. Each
row shows the automation's status and either the time until its next run or **Paused**, and opens
its page.

**New automation** starts a thread that asks an agent to set one up with you; **Create manually**
opens the form instead. See [Automations](./automations.md) for triggers, run history, and what a
run is allowed to do. The section is on web and desktop; mobile can view and control existing
automations but not create them.
