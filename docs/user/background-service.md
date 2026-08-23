# Running T3 Code in the Background

On Linux and macOS, T3 Code can run as a background service for your user, so it is ready without
keeping a terminal open.

## Manage the Service

Install the T3 Pretty CLI first (not `npx t3`, which is upstream T3 Code):

```sh
curl -fsSL https://github.com/SergeSerb2/t3-pretty/releases/latest/download/install.sh | sh
```

Then install the service:

```sh
t3 service install
```

Check whether it is installed:

```sh
t3 service status
```

Update or repair it:

```sh
npx --yes --package https://github.com/SergeSerb2/t3-pretty/releases/latest/download/t3.tgz t3 service update
```

Stop it and remove it from startup:

```sh
t3 service uninstall
```

Updating restarts T3 Code briefly. Let active agent work and terminal commands finish first.
If a remote update is already in progress, wait for it to finish before retrying a local update.

The service runs a small stable launcher. Exact T3 Code versions are installed separately, so a
failed remote candidate can return to the previous version without rewriting the service
definition. The launcher snapshots the database before a remote candidate starts, so database
updates roll back with the server version. An older launcher may require one local
`service update` before this is available.

## Platform Support

**Linux** uses a systemd user unit at `~/.config/systemd/user/t3pretty.service`. The service starts
when the machine boots and keeps running after you log out (lingering is enabled during install).

**macOS** uses a launch agent at
`~/Library/LaunchAgents/com.sergeserb.t3pretty.service.plist`. It
starts when you log in, not when the Mac boots, and it stops when you log out; macOS has no
equivalent of Linux lingering for user agents. For a Mac that should stay reachable unattended,
turn on automatic login (System Settings → Users & Groups; unavailable while FileVault is on) and
keep the Mac from sleeping.

A few more macOS notes:

- Installing over SSH needs someone logged in at the Mac's screen to start the agent right away.
  Without that, the install command reports an error at the final start step, but the agent is
  fully installed and starts at the next login.
- macOS may show privacy prompts for protected folders such as Desktop, Documents, or Downloads,
  attributed to a bare `node` process, or deny access without a prompt. If agent work fails to
  read those folders, grant Full Disk Access to the node binary listed in the launch agent's
  `ProgramArguments`.
- The agent appears under System Settings → General → Login Items. If it was switched off there,
  or disabled with `launchctl disable`, macOS will not start it at login until you switch it back
  on.

**Windows** is not supported yet.

The internal flavor keeps the legacy `t3code.service` and
`com.t3tools.t3code.service.plist` names so both installations remain separate.

## Using It with T3 Connect

T3 Connect may offer to install the service during setup so the host stays reachable in the
background. This is only an onboarding shortcut: the service and T3 Connect are managed separately.

Signing out of T3 Connect does not remove the service. Use `t3 service uninstall` when you no
longer want T3 Code to start in the background.
