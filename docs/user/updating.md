# Keeping T3 Code in Sync

The T3 Code web or desktop app and the server it connects to work best when they use the same
version. If they do not match, T3 Code shows a warning with the right update option for that server.

## Where to Find the Update

You may see the warning in either of these places:

- above the message box in the current conversation
- **Settings** → **Connections**, beside the affected connection

Dismissing the conversation warning only hides that reminder for those two versions. It does not
update the server, and the version difference remains visible in Connections.

## Before You Update

Let active agent work and terminal commands finish first. Updating restarts the server, so the
connection will disappear briefly and work that is still running may be interrupted.

The update does not remove saved threads, settings, or project files.

## Choose the Action You See

| Action                     | What to do                                                                                                                                                                  |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Update server**          | Available for the T3 Code Linux background service. Select the button and leave T3 Code open while it prepares, tests, restarts, and reconnects.                            |
| **Update the desktop app** | Open the T3 Code desktop app on the machine that runs the server and install the app update there. Reopen it if needed.                                                     |
| **Copy update command**    | Copy the command, open a terminal on the server machine, stop the current T3 Code server, and relaunch it with the copied command and any startup options you normally use. |

The available action depends on how that server was started. T3 Code does not update connected
servers silently in the background.

An older background-service launcher may ask you to run the exact
`npx --yes --package https://github.com/SergeSerb2/t3-pretty/releases/download/public-v<version>/t3-<version>.tgz t3 service update`
command on the server machine. That one local update installs the
rollback support needed for later remote updates, including versions that change the database.

After selecting **Update**, the notice becomes a live status line: **Downloading…** while the new
version is fetched and verified, then **Restarting…** while the server restarts into it. The same
status appears in the conversation and in Connections, so navigating between them does not lose the
update. A failure remains visible with its error and an option to retry.

**Copy update command** gives you an `npx --yes --package <tarball> t3` command for this fork,
which relaunches the server directly at the matching version. Do not use `npx t3@<version>` — that
installs upstream T3 Code. Add whatever startup options you normally use.

If the server instead runs as the T3 Pretty background service, update the service on the host and
pin the same version:

```sh
npx --yes --package https://github.com/SergeSerb2/t3-pretty/releases/download/public-v<client-version>/t3-<client-version>.tgz t3 service update
```

`service update` installs the version of the CLI that invoked it, so updating from `t3.tgz`
(latest) only resolves the skew when your client happens to be on the latest release. The exact
version from the warning always works.

See [Running T3 Code in the Background](./background-service.md) for install, status, and removal
commands.

## After the Update

Keep the web or desktop app open while the server restarts. The update completes only after the
service launcher reports that exact update committed and the replacement server is ready to accept
commands. A rollback is reported immediately instead of waiting for a generic reconnect timeout.

If a step fails:

1. Retry the offered action once.
2. Make sure you updated the machine named in the warning, not only the device you are using.
3. For a command-line server, relaunch it with the copied `npx --yes --package <tarball> t3`
   command, using the client version shown in the warning.

## The Mobile App

The mobile app keeps itself current on its own. When it finds a new version, it downloads it in the
background and installs it automatically the next time you leave the app. Unsent drafts and queued
messages are saved before the restart. Only if the app stays open long enough that the update never
gets that chance does it ask whether to install right away; choosing **Later** is safe and keeps the
automatic install armed.

For remote connection setup and access troubleshooting, see [Remote Access](./remote-access.md).

## What's New Dialog

After an update, the app shows a What's New dialog the next time it opens, listing the changes in
the releases you skipped. Entries cover T3 Pretty features and the parent T3 Code changes
integrated with them. Builds that only contained internal maintenance are omitted when there is
something user-facing to show. Dismissing the dialog marks those releases as seen; it will not
reappear until the next update.

To browse the changelog at any time, open Settings → General → What's new, or run "What's new"
from the command palette. That list includes every release, including maintenance-only builds.
