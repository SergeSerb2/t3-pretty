# Updating T3 Code

The app you use and the server running your agents can be on different machines.
When a server is behind your web or desktop app, an update notice appears in the
conversation and **Settings → Connections**. Update the machine named in that
notice.

The explicit URLs below are for the public GitHub build. T3 Pretty Internal uses
the [internal R2 release path](../operations/public-release-and-github-mirror.md#internal-release-path),
and its in-app update action selects that feed automatically.

## Before you update

Server updates restart the connection and can interrupt active agents and
terminal commands. Saved threads, settings, and project files remain.

**Settings → General → Continue threads after restarts** is off by default.
Enable it for each environment to resume supported active threads after an
update, crash, or machine restart. T3 Code must start again on that machine;
the setting does not enable automatic startup. Terminal commands may still be
interrupted, and threads without saved provider resume state need a new message.
If you previously enabled continuation for updates, enable this environment
setting once to allow recovery without a connected client.

## Update a connected server

The offered action depends on how the server runs:

| Action                     | What to do                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Update server**          | Keep the client open while it installs and reconnects. Supported background services update remotely. For a desktop-hosted server, this also closes and relaunches the desktop app on the host. |
| **Update the desktop app** | Update the desktop app on the machine running the server, then reopen it if needed.                                                                                                             |
| **Copy update command**    | Stop the command-line server on its host and relaunch with the copied command, keeping your usual startup options.                                                                              |

An older background-service launcher may ask you to run the exact
`service update` command below on the server machine. That one local update
installs the rollback support needed for later remote updates, including
versions that change the database.

**Copy update command** gives you an `npx --yes --package <tarball> t3` command
for this fork, which relaunches the server directly at the matching version.
Do not use `npx t3@<version>` — that installs upstream T3 Code. Add whatever
startup options you normally use.

For a T3 Pretty background service, run the matching version's CLI on the host
to update the service and pin it to that version:

```sh
npx --yes --package https://github.com/SergeSerb2/t3-pretty/releases/download/public-v<client-version>/t3-<client-version>.tgz t3 service update
```

Replace `<client-version>` with the version shown in the notice. `service update`
installs the version of the CLI that invoked it, so updating from `t3.tgz`
(latest) only resolves the mismatch when your client is on the latest release.
The exact version from the notice always works. An older service launcher may
require this local update before it supports remote updates and rollback.

See [Running T3 Code in the Background](./background-service.md) for install,
status, and removal commands.

For a foreground server, use the copied
`npx --yes --package <tarball> t3` command for `<client-version>`. Add `serve` if
you normally run without a browser, and preserve options such as `--host` or
`--tailscale-serve`. See [background services](./background-service.md) for
service management.

## If an update fails

Keep the client open until it reconnects or reports a failure. A failed service
update can roll back to the previous version. If the update still fails:

1. Retry the offered action once.
2. Check that you updated the server machine named in the warning, not only the device you are using.
3. For a command-line server, stop it and relaunch with the copied
   `npx --yes --package <tarball> t3` command, using the exact client version shown in the notice.

## Mobile updates

For remote connection setup and access troubleshooting, see [Remote Access](./remote-access.md).

Install App Store or Google Play releases as usual. The mobile app can also
download updates in the background and apply them when you next leave the app.
It saves drafts and queued messages before restarting. If you keep the app open
for a long time, it may ask to install immediately; choosing **Later** leaves the
update queued for the next suitable moment.

## What's New Dialog

After an update, the app shows a What's New dialog the next time it opens, listing the changes in
the releases you skipped. Entries cover T3 Pretty features and the parent T3 Code changes
integrated with them. Builds that only contained internal maintenance are omitted when there is
something user-facing to show. Dismissing the dialog marks those releases as seen; it will not
reappear until the next update.

To browse the changelog at any time, open Settings → General → What's new, or run "What's new"
from the command palette. That list includes every release, including maintenance-only builds.
