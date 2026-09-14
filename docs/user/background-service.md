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

Self-contained builds install as a download from the T3 Code GitHub release
instead of through npm, so the machine running the service does not need
Node.js or npm once the CLI is on it. To get the CLI onto a machine without
Node, run the install script:

```sh
curl -fsSL https://t3.codes/install.sh | sh
```

On Windows, run `irm https://t3.codes/install.ps1 | iex` in PowerShell instead.

It places `t3` in `~/.local/bin` and reuses the same download when you later
run `t3 service install`. It follows the stable train by default; set
`T3CODE_CHANNEL=nightly` for nightlies, `T3CODE_VERSION` to pin an exact
version, or `T3CODE_RELEASE_BASE_URL` to download from a mirror.

`preview` is a third train that maintainers cut from unreleased branches to
exercise the release pipeline. Those builds can be broken, receive no fixes,
and are never offered as updates; the installer and `t3 update` only take you
there when you ask for the channel explicitly, and warn you when they do.

Once a self-contained `t3` is installed, `t3 update` moves the machine to a
newer one without npm: it downloads the newest release on the channel the
running `t3` came from, verifies it, and points the `t3` launcher at it. When
a background service is installed for the same T3 home it asks before
restarting it, since a restart interrupts running agent turns, terminals, and
remote clients; answer no and the service keeps the old version until you run
`t3 service update`. From a script there is no prompt, so pass `--yes` to
restart the service. A server you started by hand is never touched; the
command tells you it is still on the old version so you can restart it
yourself. Pass an exact version (`t3 update 0.0.41-preview.20260912.1595`) to
pin one, `--channel` to follow a different release train (moving onto preview from stable or nightly asks for confirmation), or
`--allow-downgrade` to move backwards.

`t3 uninstall` reverses the install script: it shows what it found (the
background service, the `t3` launcher, every downloaded version under
`~/.t3/runtime`), asks once, and removes them. Your projects, threads, and
settings under `~/.t3/userdata` are kept; delete that directory yourself if
you want them gone too. Pass `--yes` from a script.

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
| `restart-pending`                       | A newer version is installed but the service still runs the previous one. Run `t3 service restart`.                            |

On macOS, check **System Settings → General → Login Items** if the service no
longer starts at login. If agent work cannot access Desktop, Documents, or
Downloads, it may need Full Disk Access for the Node executable listed in
`ProgramArguments` in
`~/Library/LaunchAgents/com.t3tools.t3code.service.plist`.

For failures after signing in to T3 Connect, see
[connection troubleshooting](./remote-access.md#t3-connect-troubleshooting).
