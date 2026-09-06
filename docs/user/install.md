# Install T3 Code

T3 Code runs coding agents on your computer and lets you control them from its
desktop, web, or mobile app. Set up the machine where the agents will work first.

This page installs the public T3 Pretty build from GitHub, with T3 Connect and
separate `~/.t3-pretty` state. Maintainers using T3 Pretty Internal should follow
the [internal release path](../operations/public-release-and-github-mirror.md#internal-release-path)
for the Surge Connect build instead.

## Requirements

Command-line use, SSH hosts, and WSL backends need Node.js 22.16+ (22.x), 23.11+
(23.x), or 24.10 and later. The native desktop app includes its server runtime.

You need an installed, authenticated provider before starting a thread. You can
launch T3 Code and configure providers afterwards.

## Run without installing

T3 Pretty's CLI is not `npx t3`; that command installs upstream T3 Code.

Install the T3 Pretty server (Node.js 22.16+ or 24.10+):

```bash
curl -fsSL https://github.com/SergeSerb2/t3-pretty/releases/latest/download/install.sh | sh
```

Then start it:

```bash
t3 serve
```

This starts the server and opens the local web app. Run `t3 --help` for
command-line options. On a machine that should stay reachable after logout, run
`t3 service install` and pair from another device, then turn on **T3 Connect**
under **Settings** → **Connections**.

## Desktop app

Download T3 Pretty for macOS, Windows, or Linux from
[GitHub Releases](https://github.com/SergeSerb2/t3-pretty/releases).

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Connections** to run agents and projects
there. Install Node.js and provider CLIs inside that distro. When the desktop app
runs the WSL backend, it installs the matching server runtime into
`~/.t3/wsl-runtime` inside the selected distro. The first launch after installing
or updating T3 Pretty may take a little longer while that release's runtime is
extracted. Later launches reuse the Linux-local copy so startup does not depend
on reading application files through `/mnt/c`. After a successful launch, T3
Pretty keeps the current runtime and one previous runtime for rollback and
removes older caches automatically. If a cached runtime stops working, T3 Pretty
launches from the application files under `/mnt/c` instead and reinstalls the
runtime on the next launch.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
npx t3 app
```

Pass a path to open another directory:

```bash
npx t3 app ../my-project
```

The command adds the directory as a project when needed, focuses the desktop
app, and opens a new thread. It does not launch the desktop app, open a browser,
or start a T3 Code server. A background server does not count as the desktop
app, and the command rejects SSH sessions because a remote shell cannot focus a
local desktop window. The CLI package and the running desktop app must both
include `t3 app` support. If the command cannot reach the app, start or update
the desktop app and try again.

## Mobile app

Install the T3 Pretty mobile app for iOS or Android through the distribution
channel for your build. The phone connects to a T3 Pretty server on another
machine. Follow [remote access](./remote-access.md) to link it through T3 Connect
or a pairing URL.

## Providers

T3 Code uses provider runtimes but does not bundle them. Install and authenticate each
provider's CLI, or use T3 Code's managed setup for Antigravity.

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | CLI                                                                                                        | Default binary     | Log in with                        |
| ----------- | ---------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------- |
| Codex       | [Codex CLI](https://developers.openai.com/codex/cli)                                                       | `codex`            | `codex login`                      |
| Claude      | [Claude Code](https://claude.com/product/claude-code)                                                      | `claude`           | `claude auth login`                |
| Cursor      | [Cursor CLI](https://cursor.com/cli)                                                                       | `cursor-agent`     | `agent login`                      |
| Grok Build  | [Grok Build CLI](https://x.ai/cli)                                                                         | `grok`             | `grok login`                       |
| Kimi Code   | [Kimi Code CLI](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/getting-started.html)               | `kimi`             | `kimi login`                       |
| Antigravity | [Official ACP agent](https://github.com/agentclientprotocol/registry/blob/main/antigravity-acp/agent.json) | Managed by T3 Code | **Sign in with Google** in T3 Code |

Codex, Claude, and Kimi are on by default. Cursor, Grok Build, and Antigravity are off by
default. Turn them on in **Settings** → **Providers** using each provider's card when you want to
use them.

For Antigravity, select the environment in provider settings, then install and sign in there.
The runtime and credentials stay on that environment, even when you use a phone or remote
browser. See [Antigravity setup](./providers-antigravity.md) for Google sign-in, remote callback
steps, and supported hosts.

Cursor is the one to watch: install Cursor CLI, which provides the `cursor-agent` binary that
T3 Code looks for, but authenticate with `agent login`, not `cursor-agent login`.

Grok models that support adjustable reasoning show a **Reasoning** control beside the model picker.
The available levels and default come from the installed Grok Build CLI, so they can vary by model
and CLI version.

Run CLI login commands on the machine running the T3 Code server, not on the device you browse
from. Antigravity uses its sign-in controls in T3 Code instead of a CLI login command.

### Binary Discovery

Each provider CLI must be on the server's `PATH`, or have an explicit binary path set in
**Settings** → the provider instance → **Binary path**. Use the explicit path when a version
manager or a non-standard install location keeps the CLI off the `PATH` of the shell that
started T3 Code.

Antigravity can use its managed runtime without a `PATH` entry. Its optional **Binary path**
overrides the managed runtime and must point to the official ACP executable.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, T3 Code does not display
their original values.

### When Auth Is Needed

Provider auth is required before you start a session with that provider, not before you start
T3 Code. You can install T3 Code, open it, and add providers afterwards. A provider that is not
authenticated shows its status and setup instructions in **Settings**.

For provider-specific setup and multi-account configuration, see
[Codex](./providers-codex.md), [Claude](./providers-claude.md),
[Kimi](./providers-kimi.md), and
[Antigravity](./providers-antigravity.md#accounts-and-removal).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from a phone, tablet, or another desktop.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating T3 Code](./updating.md): update the app and connected servers and understand version skew.
