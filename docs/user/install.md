# Install T3 Code

T3 Code is a web and desktop GUI for running coding agents on your machine.

This page installs the public T3 Pretty build from GitHub, with T3 Connect and
separate `~/.t3-pretty` state. Maintainers using T3 Pretty Internal should follow
the [internal release path](../operations/public-release-and-github-mirror.md#internal-release-path)
for the Surge Connect build instead.

## Requirements

Node.js `^22.16 || ^23.11 || >=24.10` on the machine that runs the T3 Code server.

At least one provider CLI, installed and authenticated. See [Providers](#providers) below.

## Run Without Installing

T3 Pretty's CLI is not `npx t3`; that command installs upstream T3 Code.

Install the T3 Pretty server (Node.js 22.16+ or 24.10+):

```bash
curl -fsSL https://github.com/SergeSerb2/t3-pretty/releases/latest/download/install.sh | sh
```

Then start it:

```bash
t3 serve
```

Use `t3 --help` for the full CLI reference. On a machine that should stay
reachable after logout, run `t3 service install` and pair from another device,
then turn on **T3 Connect** under **Settings** → **Connections**.

## Desktop App

Download T3 Pretty for macOS, Windows, or Linux from
[GitHub Releases](https://github.com/SergeSerb2/t3-pretty/releases).

### Windows Subsystem for Linux

When the desktop app runs a WSL backend, it installs the matching server runtime into
`~/.t3/wsl-runtime` inside the selected distro. The first launch after installing or updating T3
Code may take a little longer while that release's runtime is extracted. Later launches reuse the
Linux-local copy so startup does not depend on reading application files through `/mnt/c`. After a
successful launch, T3 Code keeps the current runtime and one previous runtime for rollback and
removes older caches automatically. If a cached runtime stops working, T3 Code launches from the
application files under `/mnt/c` instead and reinstalls the runtime on the next launch.

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

Grok models that support adjustable reasoning show a **Reasoning** control beside the model picker.
The available levels and default come from the installed Grok Build CLI, so they can vary by model
and CLI version.

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
