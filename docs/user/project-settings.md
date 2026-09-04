# Customize a project icon

T3 Code selects a project icon automatically. It checks `t3.json`, common favicon and app icon
paths, and icon links in project HTML files. If it does not find an image, it chooses a built-in
emoji from the project name.

To generate icons with Grok or Codex:

1. Open **Settings** and select **General**.
2. Turn on **Auto-generate project icons**.

T3 Code then generates an icon for new projects and for existing projects that do not already have
a stored icon, including projects still using automatic detection. This uses your Grok or Codex
subscription. Claude, Cursor, and Kimi do not generate images. Projects with a chosen file, Lucide
icon, emoji, or previously generated icon are left alone.

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

Turn on **Automatically pull** in a project's settings to keep its default-branch checkout current.
T3 Code checks in the background and when the server starts. It uses the branch's configured
upstream and only performs a fast-forward pull when the checkout has no working-tree changes,
untracked files, or local commits.

The pull is skipped if the checkout is on another branch, has no upstream, or contains local work.
Pull failures do not prevent the server from starting.
