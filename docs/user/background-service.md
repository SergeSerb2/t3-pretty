# Running T3 Code in the background

On Linux and macOS, T3 Code can run as a service for your user so you do not need
to keep a terminal open.

The commands below use the public GitHub build. T3 Pretty Internal operators should
install from the [internal release path](../operations/public-release-and-github-mirror.md#internal-release-path)
before running the same `t3 service` commands.

## Manage the service

Run these commands on the machine that will host T3 Code.

Install the T3 Pretty CLI first (not `npx t3`, which is upstream T3 Code):

```sh
curl -fsSL https://github.com/SergeSerb2/t3-pretty/releases/latest/download/install.sh | sh
```

Then manage the service with the commands below:

| Task                            | Command                                                                                                         |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Install and start               | `t3 service install`                                                                                            |
| Inspect status and log location | `t3 service status`                                                                                             |
| Update or repair                | `npx --yes --package https://github.com/SergeSerb2/t3-pretty/releases/latest/download/t3.tgz t3 service update` |
| Stop and remove from startup    | `t3 service uninstall`                                                                                          |

`t3 service status` checks whether the service is installed and reports its log location. On Linux,
it also checks whether the service is running, enabled at startup, and allowed to keep running after
logout.

The service uses the same T3 Code version as the CLI you run. To install a nightly or an exact
version, use that version of the CLI:

```sh
npx t3@nightly service update
npx t3@1.2.3 service update
```

The install and update commands refuse to replace a newer service with an older version. Setup
through T3 Connect leaves a newer service unchanged. To downgrade, select the exact older version
and pass `--allow-downgrade`:

```sh
npx t3@1.2.3 service update --allow-downgrade
```

Stop it and remove it from startup:

```sh
t3 service uninstall
```

Uninstalling the service leaves your projects, threads, and settings intact.

Updating restarts T3 Code briefly. Let active agent work and terminal commands finish first.
If a remote update is already in progress, wait for it to finish before retrying a local update.

The service runs a small stable launcher. Exact T3 Code versions are installed separately, so a
failed remote candidate can return to the previous version without rewriting the service
definition. The launcher snapshots the database before a remote candidate starts, so database
updates roll back with the server version. An older launcher may require one local
`service update` before this is available.

To match a remote client's version, follow
[Updating T3 Code](./updating.md).

## Platform support

**Linux** uses a systemd user unit at `~/.config/systemd/user/t3pretty.service`. The service starts
when the machine boots and keeps running after you log out (lingering is enabled during install).
Setup checks the systemd user manager and enables lingering before installing a runtime or stopping
an existing service. If that requires administrator permission, setup stops with a recovery command.

**macOS** uses a launch agent at
`~/Library/LaunchAgents/com.sergeserb.t3pretty.service.plist`. It
starts when you log in, not when the Mac boots, and it stops when you log out; macOS has no
equivalent of Linux lingering for user agents. For a Mac that should stay reachable unattended,
turn on automatic login (System Settings → Users & Groups; unavailable while FileVault is on) and
keep the Mac from sleeping. Installing over SSH while nobody is logged in at the Mac's screen can
fail at the final start step; the service is still installed and will start at the next login.

Windows background services are not supported.

The internal flavor keeps the legacy `t3code.service` and
`com.t3tools.t3code.service.plist` names so both installations remain separate.

## Using It with T3 Connect

T3 Connect may offer to install the service during setup so the host stays reachable in the
background. This is only an onboarding shortcut: the service and T3 Connect are managed separately.

Signing out of T3 Connect does not stop or uninstall the service. Use `t3 service uninstall` when
you no longer want T3 Code to start in the background.

## Troubleshooting

Start with `t3 service status` on the host. It prints the log path and, on Linux,
checks whether the installed service is running, enabled, and allowed to survive
logout.

If it stops when your SSH session closes, check for `linger-disabled`. An
administrator can enable lingering with:

```sh
sudo loginctl enable-linger "$(id -un)"
```

Over SSH, allow sudo to prompt:

```sh
ssh -t your-server 'sudo loginctl enable-linger "$(id -un)"'
```

Then retry service setup as your normal user. Run only the `loginctl` command
with sudo; running T3 Code as root creates a separate installation and Connect
identity. Without administrator access, run `t3 serve` in a terminal and keep
that session open.

| Status problem                          | Next step                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `linger-unavailable`                    | Run `loginctl show-user "$(id -un)" --property=Linger` and check that systemd-logind is available.                             |
| `user-manager-unavailable`              | Run `systemctl --user status` in a login session for the service user; check your distribution's systemd user-session support. |
| `service-disabled` or `service-stopped` | Read the log and `systemctl --user status t3code.service`, then use the repair command printed by T3 Code.                     |

On macOS, check **System Settings → General → Login Items** if the service no
longer starts at login. If agent work cannot access Desktop, Documents, or
Downloads, it may need Full Disk Access for the Node executable listed in
`ProgramArguments` in
`~/Library/LaunchAgents/com.t3tools.t3code.service.plist`.

For failures after signing in to T3 Connect, see
[connection troubleshooting](./remote-access.md#t3-connect-troubleshooting).
