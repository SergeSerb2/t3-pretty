# Updating T3 Code

The app you use and the server running your agents can be on different machines.
When a server is behind your web or desktop app, an update notice appears in the
conversation and **Settings → Connections**. Update the machine named in that
notice.

The explicit URLs below are on the
[R2 feed](https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/).
GitHub Releases are not the update channel; the GitHub tag `desktop-r2-latest`
is only a pointer. In-app update actions select that feed automatically.

## Update everything at once

The update button at the bottom of the sidebar updates every connected machine
in one step. It updates outdated providers, then servers that are behind, then
the desktop app you are using. Servers move to the
version your desktop app is installing, or to your web app's version. A
background service stays on its current release channel. A remote desktop app
installs the latest release from its own channel. Hover the button to see what
it will update.

While it runs, the button widens to show progress. It names a machine that is
taking longer than usual, and offers **Retry** for a server that failed. Click
it to see every machine. The desktop app restarts once each server has started
its own restart, after a short countdown. Choose **Later** to keep working and
restart from the update button when you are ready. A server still restarting
finishes on its own, and the button keeps showing it after the desktop app
restarts.

Servers that need a manual update are not included. The confirmation lists
each machine it skips and why, such as a machine that is offline or needs a
manual update. Use the notice or **Settings → Connections** for those.

If a desktop app restarts on its old version, T3 Pretty tells you the update did
not apply. It does not install that version again on its own, even when another
device asks. Use the update button on that machine to retry.

The confirmation counts the running threads that the restarts will interrupt,
and how many can resume afterwards. See **Continue threads after restarts**
below.

## Before you update

Server updates restart the connection and can interrupt active agents and
terminal commands. Saved threads, settings, and project files remain.

**Settings → General → Continue threads after restarts** is on by default.
It resumes supported active threads after an update, crash, or machine
restart. Changes are saved to connected environments that support this setting;
update older servers first. If a supported environment was offline or has a
different value, use **Apply to all** in Settings after it connects.
T3 Code must start again on that machine;
the setting does not enable automatic startup. Terminal commands may still be
interrupted, and threads without saved provider resume state need a new message.
A thread that finished its turn to wait on a monitor, subagent, or background task
is woken and told that this work stopped. A background shell, such as a dev server,
does not wake it; the thread learns about it with your next message.
A thread is not resumed while it waits for your approval, answer, or secret, or
while it is archived, snoozed, or settled. After three automatic resumes in a row,
the thread waits for your next message.

Updates from the previous orchestration system preserve conversation transcripts but cannot carry
every kind of runtime history forward. Read [Threads from older T3 Code versions](./thread-migration.md)
before continuing an important older thread.

## When versions don't match

A client and server must speak the same orchestration protocol. If they do not, the connection is
refused rather than running half-upgraded:

- An app newer than the server is blocked before connecting, with a notice telling you to update
  T3 Code on the machine named in the notice.
- A server newer than your app refuses the connection with an update message.

Update the side the notice names, then reconnect.

## Update a connected server

The offered action depends on how the server runs:

| Action                     | What to do                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Update server**          | Keep the client open while it installs and reconnects. Supported background services update remotely. For a desktop-hosted server, this also closes and relaunches the desktop app on the host. |
| **Update the desktop app** | Update the desktop app on the machine running the server, then reopen it if needed.                                                                                                             |
| **Copy update command**    | Run the command on the named host to update the detected global npm install, then restart the server with your usual options.                                                                   |
| **Copy relaunch command**  | Stop the command-line server on its host and relaunch with the copied command, keeping your usual subcommand and options. This does not update an installed `t3` command.                       |

For an installed T3 Pretty CLI, run the update on the host:

```sh
t3 update <client-version>
```

Replace `<client-version>` with the version shown in the notice. The command
asks before restarting the background service; if you decline, run
`t3 service restart` when you are ready. For a server you started by hand,
stop it and start it again afterwards with your usual subcommand and options,
such as `--host` or `--tailscale-serve`.

An older installed CLI or background-service launcher may instead require one
local update using the matching version's T3 Pretty CLI:

```sh
npx --yes --package https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/t3-<client-version>.tgz t3 service update
```

That local update installs the rollback support needed for later remote
updates, including versions that change the database. `service update` installs
the version of the CLI that invoked it.

The feed publishes
[`t3.tgz`](https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/t3.tgz)
as latest, and `t3-<version>.tgz` when that CLI build was uploaded. `t3.tgz`
only resolves a version mismatch when your client is on the latest release. If
the exact tarball is not on the feed, install from
[`install.sh`](https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/install.sh)
and then run `t3 service update`.

See [Running T3 Code in the Background](./background-service.md) for install,
status, and removal commands.

If you run the server with `npx` rather than an installed `t3`, there is nothing
to update on the host. Stop the server and relaunch it with the copied
`npx --yes --package <tarball> t3` command for `<client-version>`, preserving
the same subcommand and options. Add `serve` if you normally run without a
browser. Do not use `npx t3@<version>` — that installs upstream T3 Code.

## If an update fails

Keep the client open until it reconnects or reports a failure. A failed service
update can roll back to the previous version. If the update still fails:

1. Retry the offered action once.
2. Check that you updated the server machine named in the warning, not only the device you are using.
3. For a command-line server, stop it and relaunch with the copied
   `npx --yes --package <tarball> t3` command, using the exact client version shown in the notice.

Only one server can use a T3 home directory at a time. If startup reports that
another server owns it, stop that server before retrying, or use a separate home
directory and pair with the running server.

## Update providers

**Settings → Providers** shows provider updates for the selected environment.
**Update all** updates every outdated provider on every connected environment
at once. Hover it to see which providers it will update. Providers that only
offer a manual update command are not included.

## Mobile updates

To update an environment from your phone, open **Settings → Environments** and
select it. **Check for updates** finds the latest release on that environment's
current release channel. Keep the app open while the environment updates and
reconnects. Hosts that cannot update remotely show instructions for updating on
the machine instead.

The same page lets you refresh provider status and update supported providers.
These controls require a connected environment and permission to operate it.
Provider update checks and restart continuation preferences are in
**Settings → Maintenance**. If provider update checks are disabled, enable them
there before refreshing to find newer versions. The same setting controls whether
T3 Code downloads model catalog updates, so with it off new models may not appear
until you enable it and refresh provider status.

For remote connection setup and access troubleshooting, see [Remote Access](./remote-access.md).

Install App Store or Google Play releases as usual. The mobile app can also
download updates in the background and apply them when you next leave the app.
It saves drafts and queued messages before restarting. If you keep the app open
for a long time, it may ask to install immediately; choosing **Later** leaves the
update queued for the next suitable moment.

## What's New Dialog

After an update, the app shows What's New the next time it opens: a short list of what
changed since you last used it, grouped as New, Improvements, and Fixes. Notes that
appeared in more than one build are listed once. Dismissing the dialog marks those
updates as seen; it will not reappear until the next update.

To browse the full history, open Settings → General → What's new, or run "What's new"
from the command palette.
