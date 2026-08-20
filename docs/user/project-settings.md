# Customize a project icon

T3 Code selects a project icon automatically. It checks `t3.json`, common favicon and app icon
paths, and icon links in project HTML files.

To generate icons with Grok or Codex:

1. Open **Settings** and select **General**.
2. Turn on **Auto-generate project icons**.

T3 Code then generates an icon for new projects and for existing projects that do not already have
a stored icon, including projects still using automatic detection. This uses your Grok or Codex
subscription. Claude, Cursor, Kimi, and OpenCode do not generate images. Projects with a chosen
file or a previously generated icon are left alone.

To choose a different icon:

1. Open **Settings** and select **Projects**.
2. Select the project.
3. Under **Project icon**, select **Choose file**.
4. Search for an image in the project, or select **Browse in Finder** (Explorer on Windows) to pick
   any image on your computer.

Images chosen from your computer are stored with T3 Code, not in the project repository, so you
don't need to commit them.

T3 Code supports SVG, PNG, ICO, JPEG, GIF, AVIF, and WebP files. A project-file path applies to
each checkout in the project group. An icon picked from your computer is stored on that machine and
appears on your connected clients.

To use automatic detection again, select **Automatic**.
