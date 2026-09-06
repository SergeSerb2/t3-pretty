# Remote access

Connect a phone, browser, or another desktop app to T3 Code running on a different
machine. That machine must stay running and reachable while you work.

## T3 Connect

T3 Connect makes an environment available to your other devices without setting
up router forwarding. In the desktop app on the host, open **Settings →
Connections**, sign in, and enable **T3 Connect** for that environment.

For a command-line host, run:

```bash
t3 connect
```

Follow the sign-in instructions. Setup offers a
[background service](./background-service.md); if you decline it, start the
server with `t3 serve`. Saving your sign-in alone does not make the machine
reachable.

## T3 Connect troubleshooting

Run `t3 connect` on the server machine to authorize it and optionally install the background service.
The authorization message means your sign-in was saved. The server must then start and establish its
relay link before the machine is reachable.

`t3 connect status` reports saved authorization and link configuration, not a live reachability
check. If the machine appears offline, run `t3 service status` on it and read the displayed log.
On Linux, a service that works while SSH is open but stops after logout usually has lingering
disabled. See [background service troubleshooting](./background-service.md#troubleshooting).

Relay errors include the returned reason and trace ID when available:

| Error                                                            | Next step                                                                                                                                                                   |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment_link_limit_exceeded` / managed tunnel limit reached | Unlink an unused environment in T3 Connect, then restart T3 Code on this machine.                                                                                           |
| `auth_invalid` / `invalid_bearer`                                | Run `t3 connect login`. If the stored credential was revoked, run `t3 connect logout`, then `t3 connect` and restart the server.                                            |
| Expired or invalid link proof                                    | Check the server's date and time, update T3 Code, and restart it. Include the reason and trace ID if it still fails.                                                        |
| HTTP 403 without a recognized error response                     | Check relay access and any proxy or firewall restrictions. Include the Cloudflare Ray ID if one was returned; an HTTP status alone does not identify the cause.             |
| HTTP 408, 429, or 5xx                                            | The server retries temporary failures during startup for up to ten minutes. Check network and relay availability; include the trace ID when reporting a persistent failure. |

Authorization and other permanent 4xx rejections stop the startup link attempt immediately.
After correcting them, restart the server. For the Linux background service, use
`systemctl --user restart t3code.service`; for a foreground server, stop it and run `t3 serve` again.
Keep the diagnostic message and trace ID when reporting a problem. Do not post authorization codes,
pairing URLs, or the contents of the secrets directory.

## Quick Pairing for a Running Server

If a server is already running on this machine, mint a fresh pairing token and QR code without restarting anything:

```bash
t3 pair
```

`t3 pair` finds the running server for that CLI flavor: public builds check `~/.t3-pretty`,
internal builds check `~/.t3`, and a command run inside a worktree checks its dev server. It issues
a one-time pairing token and prints the pairing URL as a QR code you can scan from your phone. Use
`--base-dir` when you intentionally need to target another state directory.

To publish and pair the running server through Tailscale Serve HTTPS, run:

```bash
t3 pair --tailscale
```

This publishes the server over Tailscale Serve HTTPS (configuring the mapping if needed — it persists until you run `tailscale serve --https=443 off`) and pairs through the `https://machine.tailnet.ts.net/` URL. Use `--tailscale-serve-port` for a different HTTPS port, `--ttl` to change the token lifetime, and `--base-dir` to target a specific data directory.

If no server is running, `t3 pair` says so and points you at `t3 serve` or `t3 connect`.

## Recommended Setup

Use a trusted private network that meshes your devices together, such as a tailnet.

That gives you:

- a stable address to connect to
- transport security at the network layer
- less exposure than opening the server to the public internet

## T3 Connect device mesh

Public builds call this service **T3 Connect** and use existing T3 accounts. The compatible internal
service appears as **Surge Connect** instead; the steps are identical.

The managed connection service provides an account-based mesh when you want to reach your environments without
manually sharing an address or pairing link with every device.

On the computer that hosts an environment:

1. Open **Settings** → **Connections**.
2. Under **T3 Connect**, select **Sign in to T3** and finish signing in.
3. Under **This environment**, turn on **T3 Connect**. The environment becomes available to the
   other devices signed in to the same account.

On a new device:

1. Open **Settings** → **Connections** and sign in to the same T3 account.
2. Find the host under **Remote Environments** and select **Connect**.

Over SSH, the CLI prints a browser link and accepts the returned authorization code, so you do not
need to forward an OAuth callback port.

In the desktop app, selecting **Connect** also makes the new device available through T3
Connect. Once both desktops participate, each app automatically keeps the full account mesh in its
connection list, including machines added later. Threads from every linked desktop are therefore
available in either app without repeating **Connect** on both sides.

The **Remote Environments** list shows one row per machine. When several environments publish from
the same machine (for example an installed app and a second server on one host), only the working
connections are shown while at least one is online, and offline duplicates collapse away instead of
cluttering the list. Saved direct LAN or Tailscale connections are no longer offered in the app —
connect through T3 Connect instead.

Settle and snooze still work when a linked machine is offline. The change is saved on this device
and applied on that machine as soon as T3 Connect can reach it again.

A headless server has no desktop connection list to synchronize, so it remains intentionally
one-way: desktop apps can add it from the mesh, but it does not gain their threads. Browser-only
clients also keep their explicitly saved connections.

If a host says **Relay offline**, open **Connections** on that host and enable T3 Connect there.
The desktop app repairs links left on an older relay or signed in to a different account before it
synchronizes the mesh. Managed SSH backends launched by the desktop app inherit that build's public
T3 Connect configuration instead of silently joining another relay deployment.

After updating, the desktop repairs an older missing host registration once when that host's local
T3 Connect setting is still on. A host deregistered later from **Manage account** stays off after the
account list refreshes; turn T3 Connect on once on that host to register it again. Older desktop
builds require turning T3 Connect off and back on manually.

Use **Manage account** on the T3 account row to inspect or change the signed-in account.
**Publish agent activity** is a separate setting for mobile notifications and Live Activities; it
does not need the T3 Connect tunnel to be on. The iOS Live Activity lists your threads by name —
what each one is doing, a live elapsed timer while it works, and how long anything blocked has been
waiting — with threads that need you first. Tap it to open the thread that needs attention, or the
first working thread. If the account row says **Unavailable**, that build does not include T3 Connect
configuration.

### Copy or Move a Thread to Another Environment

When two updated environments are connected to the same T3 Connect or Surge Connect account, open a
thread's menu and choose **Copy or move to connection…**. On mobile, open the thread settings sheet
first. Choose **Copy** or **Move**, pick the destination, then confirm.

**Copy** duplicates this thread's conversation and the project files onto the destination. The
original project and thread stay where they are.

**Move** relocates the whole project: every thread plus the project files. After the destination has
them, T3 removes the project from the source. Files on disk are deleted only when they live in that
machine's T3-managed projects folder — a repo you opened from elsewhere stays on disk.

The transfer dialog shows named stages while it works, then opens the destination copy of the
thread you started from.

Regular Git metadata is included for a normal repository. Dependency folders, generated build
caches, message attachments, and worktree-only Git metadata are skipped. Reinstall dependencies on
the destination before running the project. Compressed transfers larger than 96 MB are rejected.

Every thread in the project must be idle for a move (the selected thread must be idle for a copy).
Both environments must be online, and both servers must advertise transfer support. The first new
turn on the destination receives a bounded copy of the transferred conversation so the local
provider can continue with context even though provider sessions do not move between machines.

T3 Connect renews access credentials when needed without disconnecting a healthy
connection. Pull request diffs and provider settings keep working after the
previous credential expires. A failed renewal affects that request; it does not
disconnect an otherwise healthy conversation.

## Pair over a LAN or private network

Use direct pairing when the other device can reach the host's network address.

On a desktop host, open **Settings → Connections**, enable **Network access**,
then create a pairing link using an address the other device can reach. Changing
network access restarts the desktop app. You can turn it off in the same place.

T3 Pretty and T3 Pretty Internal can be installed side by side, but both production mobile apps
register `t3code://`. The app installed most recently receives pairing and deep links; open the
other app and use **Add Environment** when you need to target it explicitly.

Install the T3 Pretty CLI on the remote machine first — `npx t3` is upstream T3 Code:

```bash
curl -fsSL https://github.com/SergeSerb2/t3-pretty/releases/latest/download/install.sh | sh
```

For a command-line host, replace `<private-ip>` with the host's LAN or tailnet
address:

```bash
t3 serve --host <private-ip>
```

If a server is already running, generate a fresh link without restarting it:

```bash
t3 pair
```

Scan the QR code on your phone or paste the pairing URL into **Add environment**
in the receiving app. Connection settings are under **Settings → Connections**
on web and desktop and **Settings → Environments** on mobile. A loopback address
such as `127.0.0.1` reaches only the device opening the link.

Pairing authorizes that device for future connections. Use a fresh one-time link
for each new device; you do not need the original token to reconnect. Links
created in Settings can only be copied from the client that created them while
its Connections page stays open. If you leave or reload that page, create
another link to share.

### Tailscale HTTPS

Join both devices to the same tailnet. In the desktop app, enable **Tailscale
HTTPS** in **Settings → Connections**. Turn it off there to remove that route.

To start a command-line server with Tailscale HTTPS:

```bash
t3 serve --tailscale-serve
```

For an already-running server:

```bash
npx t3 pair --tailscale
```

The pairing link uses an address such as `https://machine.tailnet.ts.net/`.
The mapping created by `pair --tailscale` persists across restarts. Remove its
default-port mapping with:

```bash
tailscale serve --https=443 off
```

If that port is already in use, choose another with
`--tailscale-serve-port`. See `npx t3 pair --help` for other pairing options.

### Hosted web app

[app.t3.codes](https://app.t3.codes) needs an HTTPS endpoint. It connects directly
to your server; a hosted pairing link does not make an unreachable backend
reachable or convert HTTP to HTTPS.

For a plain HTTP LAN endpoint, use the direct pairing URL in a browser that can
open it, or pair from the desktop app. On mobile, an IP address entered without a
scheme uses HTTP, so include `https://` when your server uses HTTPS.

## Desktop-managed SSH

In the desktop app, open **Settings → Connections → Add environment**, choose
**SSH**, and enter a host or SSH alias such as `user@example.com`. T3 Code starts
or reuses a server there and opens the port forward for you. Projects, provider
credentials, and agent work stay on the remote machine.

The remote host needs a compatible [Node.js installation](./install.md#requirements)
and [provider setup](./install.md#providers). If launch cannot find Node or reports
an incompatible version, check it through a non-interactive SSH session:

```bash
ssh user@example.com 'sh -lc "command -v node && node --version"'
```

Configure your version manager for non-interactive shells if this differs from
your normal terminal. With nvm, setting a compatible default, such as
`nvm alias default 24`, can resolve the problem.

If SSH reconnecting fails after an app update, retry the launch once. Removing
the connection stops a server that T3 Code launched; a server that was already
running is left alone.

For Antigravity's Google callback on a remote host, see
[remote sign-in](./providers-antigravity.md#sign-in-from-a-remote-device).

## Manage or revoke access

On the host, **Settings → Connections** lets authorized administrators create
pairing links and revoke client sessions. Revoking an unused link prevents new
pairings; revoke a device's session to remove its existing access. Command-line
management is available through `npx t3 auth --help`.

A session with an open connection stays listed after its access credential
expires.

To remove an environment from T3 Connect, open your account menu's **T3 Connect**
page, or **Settings → T3 Connect** on mobile, and choose **Deregister**. This
revokes its cloud access and frees its host space even when the environment is
offline or has been wiped.

On a command-line host, `t3 connect unlink` disables exposure while retaining
your login; `t3 connect logout` also clears that login. Background-service
[removal](./background-service.md#manage-the-service) is separate.

Treat pairing URLs and authorization codes as passwords. Do not include them in
screenshots, logs, or bug reports.

Device-local connect and disconnect controls remain in **Settings → Connections** on web and
desktop or **Settings → Environments** on mobile.

## Automation webhooks

An [automation](./automations.md) with a webhook trigger gets its own URL, and whatever you paste it
into — GitHub, a CI job, Zapier — has to be able to reach the server that hosts the project. A
`localhost` or `127.0.0.1` address only works from that machine, so use the host you already reach
the server by: a Tailscale address for a machine on your tailnet, or the T3 Connect host for a
machine behind one. T3 Code warns you when the URL it shows you is loopback-only.

The token in that URL is the only thing protecting the automation, so treat it like a pairing token:
rotate it from the automation's page after pasting it into a third-party interface you no longer
trust, and again if it ever appears in a screenshot or a log. Rotating mints a new URL and kills the
old one immediately.

## T3 Connect troubleshooting

Run `t3 connect status` on the host to inspect saved authorization and link
configuration. It is not a live reachability check. If the environment appears
offline, run `t3 service status` and read the displayed log. If it disappears
when SSH closes, see [background-service troubleshooting](./background-service.md#troubleshooting).

| Error                                                     | Recovery                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment_link_limit_exceeded` or managed tunnel limit | Deregister an unused environment, then restart T3 Code on the host.                                                                         |
| `auth_invalid` or `invalid_bearer`                        | Run `t3 connect login`. If credentials were revoked, run `t3 connect logout`, then `t3 connect` again. Restart the server after signing in. |
| Expired or invalid link proof                             | Check the host's date and time, update T3 Code, then restart it.                                                                            |
| HTTP 403 without a recognized error                       | Check relay access, proxies, and firewall rules. Keep any Cloudflare Ray ID for a bug report.                                               |
| HTTP 408, 429, or 5xx                                     | Check network and relay availability. Startup retries temporary failures for up to ten minutes.                                             |

After fixing a permanent rejection, restart the host's server. On Linux, use
`systemctl --user restart t3code.service` for the background service. For a
foreground server, stop it and run `t3 serve` again with your usual options.
Include the diagnostic message and trace ID when reporting a persistent failure.

For a connection that still fails after linking, check the date and time on both
devices. For server version warnings, follow [Updating T3 Code](./updating.md).
