# Install T3 Code

T3 Code is a web and desktop GUI for running coding agents on your machine.

## Requirements

Node.js `^22.16 || ^23.11 || >=24.10` on the machine that runs the T3 Code server.

At least one provider CLI, installed and authenticated. See [Providers](#providers) below.

## Run Without Installing

T3 Pretty's CLI is not `npx t3`. That command installs upstream T3 Code and talks
to a different Surge Connect relay.

Install the T3 Pretty server (Node.js 22.16+ or 24.10+):

```bash
curl -fsSL https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/install.sh | sh
```

Then start it:

```bash
t3 serve
```

Use `t3 --help` for the full CLI reference. On a machine that should stay
reachable after logout, run `t3 service install` and pair from another device,
then turn on **Surge Connect** under **Settings** → **Connections**.

## Desktop App

Download the latest release from
[GitHub Releases](https://github.com/pingdotgg/t3code/releases), or install from a package
registry.

Windows:

```bash
winget install T3Tools.T3Code
```

The Windows installer does not launch T3 Code automatically after replacing an existing
installation. Start it from the Start menu after Setup has closed.

macOS:

```bash
brew install --cask t3-code
```

Arch Linux:

Stable:

```bash
yay -S t3code-bin
```

Nightly:

```bash
yay -S t3code-nightly-bin
```

## Providers

T3 Code drives provider CLIs; it does not ship them. Install the CLI for each provider you want
to use, then authenticate it.

| Provider   | CLI                                                                                          | Default binary | Log in with         |
| ---------- | -------------------------------------------------------------------------------------------- | -------------- | ------------------- |
| Codex      | [Codex CLI](https://developers.openai.com/codex/cli)                                         | `codex`        | `codex login`       |
| Claude     | [Claude Code](https://claude.com/product/claude-code)                                        | `claude`       | `claude auth login` |
| Cursor     | [Cursor CLI](https://cursor.com/cli)                                                         | `cursor-agent` | `agent login`       |
| Grok Build | [Grok Build CLI](https://x.ai/cli)                                                           | `grok`         | `grok login`        |
| Kimi Code  | [Kimi Code CLI](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html) | `kimi`         | `kimi login`        |

Codex, Claude, and Kimi are on by default. Cursor and Grok Build are off by default; turn
them on in **Settings** → the provider's card when you want to use them.

Cursor is the one to watch: install Cursor CLI, which provides the `cursor-agent` binary that
T3 Code looks for, but authenticate with `agent login`, not `cursor-agent login`.

Run the login command on the machine running the T3 Code server, not on the device you browse
from.

### Binary Discovery

Each provider CLI must be on the server's `PATH`, or have an explicit binary path set in
**Settings** → the provider instance → **Binary path**. Use the explicit path when a version
manager or a non-standard install location keeps the CLI off the `PATH` of the shell that
started T3 Code.

### When Auth Is Needed

Provider auth is required before you start a session with that provider, not before you start
T3 Code. You can install T3 Code, open it, and add providers afterwards. A provider that is not
authenticated shows its status in **Settings** and fails at session start with the login command
to run.

For multi-account setups, see [Codex](./providers-codex.md), [Claude](./providers-claude.md), and
[Kimi](./providers-kimi.md).

## Next Steps

- [Permission modes](./permission-modes.md): how much T3 Code asks before acting
- [Remote access](./remote-access.md): connect from a phone, tablet, or another desktop
- [Keeping T3 Code in sync](./updating.md): client and server version skew
- [Running in the background](./background-service.md): Linux background service
