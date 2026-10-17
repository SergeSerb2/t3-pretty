# Install T3 Pretty

T3 Pretty runs coding agents on your computer. Use its desktop or web client there,
then connect from another device when you need remote access.
Set up the machine where the agents will work first.

## Get a public release

Open [T3 Pretty releases](https://github.com/SergeSerb2/t3-pretty/releases) and choose
**`public-v<version>`**. Use only the assets listed on that release. Its notes describe
which platforms it supports. Older nightly releases and `desktop-r2-latest` are part of
the internal release line and use a separate update feed.

Public desktop builds use T3 Connect, a separate app identity, and `~/.t3-pretty`
for their default data directory. Installers update through the public GitHub feed.
If your platform has no installer on that release, [build from source](#run-from-source).

## Requirements

Install and sign in to a provider before starting your first thread.
You can open T3 Pretty and configure providers afterwards in **Settings → Providers**.
The standalone CLI also needs Node.js and npm; Node.js 24 is the recommended source-build version.

## Command line

If the selected public release includes `install.sh` and `t3.tgz`, install its CLI
on macOS or Linux:

```sh
curl -fsSL https://github.com/SergeSerb2/t3-pretty/releases/latest/download/install.sh | sh
```

Check that the latest release is tagged `public-v<version>` before using this URL.
To pin a version, download its `t3-<version>.tgz` asset and install that file with npm.
This also works in Windows PowerShell:

```sh
npm install --global ./t3-<version>.tgz
t3
```

Replace `<version>` with the version you downloaded. npm may need a C++ build toolchain
for native dependencies. The macOS/Linux installer uses `~/.local/bin` by default;
follow its printed PATH instructions if `t3` is not found.
The command `npx t3` installs upstream T3 Code.

| Task                                         | Command                                                   |
| -------------------------------------------- | --------------------------------------------------------- |
| Start the server and open the web app        | `t3`                                                      |
| Start without a browser                      | `t3 serve`                                                |
| Keep a macOS/Linux host running after logout | `t3 service install` ([details](./background-service.md)) |
| Show pairing details                         | `t3 pair`                                                 |
| Show command help                            | `t3 --help`                                               |

Run provider login commands on the machine that hosts the server.
To connect remotely, follow [remote access](./remote-access.md), then enable
**T3 Connect** in **Settings → Connections** if you want relay access.

## Run from source

Install Git and Node.js 24 (`^24.13.1`), then install [Vite+](https://viteplus.dev/guide/):

```sh
# macOS or Linux
curl -fsSL https://vite.plus | bash
```

```powershell
# Windows PowerShell
irm https://vite.plus/ps1 | iex
```

Open a new terminal and run:

```sh
git clone https://github.com/SergeSerb2/t3-pretty.git
cd t3-pretty
vp i --frozen-lockfile
vp run dev
```

Open the full pairing URL printed by the command, including its token.
To build the CLI and its web client:

```sh
vp run --filter t3 build
node apps/server/dist/bin.mjs serve
```

To build and open the desktop app:

```sh
vp run build:desktop
vp run start:desktop
```

Source builds do not install an updater-managed application. Update the checkout to a
new public stable snapshot and rebuild when you want a newer version.

## Desktop app

Download the installer for your system from the selected
[public stable release](https://github.com/SergeSerb2/t3-pretty/releases).
Use the platform and architecture stated in its filename and release notes.
Homebrew `t3-code`, `winget`, and AUR `t3code-bin` refer to upstream T3 Code.

### The `t3` command

The desktop app includes the `t3` command-line tool. To run it from any
terminal, open **Settings → General → About** and choose **Install** next to
**t3 command**. On macOS and Linux it adds a `t3` link to a folder on your
`PATH`; on Windows it adds the app's command folder to your `PATH`. Open a new
terminal afterwards. **Remove** takes it off again. If you already have `t3`
from npm, it stays as it is.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Connections** to run agents and projects
there. Install the provider CLIs inside that distro. When the desktop app runs
the WSL backend, T3 Pretty installs its own matching server runtime into
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
t3 app
```

Pass a path to open another directory:

```bash
t3 app ../my-project
```

The command adds the directory as a project when needed, focuses the desktop
app, and opens a new thread. It does not launch the desktop app, open a browser,
or start a T3 Code server. A background server does not count as the desktop
app, and the command rejects SSH sessions because a remote shell cannot focus a
local desktop window. The CLI package and the running desktop app must both
include `t3 app` support. If the command cannot reach the app, start or update
the desktop app and try again.

## Mobile app

When a public release includes a signed Android `.apk`, download it from that
[public stable release](https://github.com/SergeSerb2/t3-pretty/releases) and install it
on your Android device. An `.aab` is an Android App Bundle for distribution tooling;
it does not install directly. Availability depends on the assets listed for that release.
This fork has no claimed public App Store or Google Play listing.

The mobile client connects to a T3 Pretty server on another machine.
Follow [remote access](./remote-access.md) to connect through **T3 Connect** or a direct
pairing URL. Use the client and server versions recommended in the release notes.

If the app crashes during launch, open Settings → Diagnostics on the next launch
that succeeds. It lists startup crashes from the last 7 days with the error and
component stack that store crash reports leave out. Copy the report and paste it
into a GitHub issue. Error messages can quote values from the app, so read it over
before sharing.

## Providers

T3 Code uses provider runtimes but does not bundle them. Install and authenticate each
provider's CLI, or use T3 Code's managed setup for Codex or Antigravity.

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider    | Install and authenticate                                                                                                                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude      | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| Cursor      | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build  | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| OpenCode    | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity | Install and sign in with Google from T3 Code's provider settings.                                                                                         |
| Pi          | Install [Pi](./providers-pi.md#set-up-pi) with Node.js 22.19 or newer, then run `pi` and `/login`.                                                        |
| Muse Code   | Install [Muse Code](https://dev.meta.ai/docs/muse-code) on the server, run `muse login`, then enable it in Settings → Providers.                          |

Codex and Claude are on by default. Cursor, Grok Build, and Antigravity are off
by default. Turn them on in **Settings** → **Providers** using each provider's card when you want
to use them.

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
from. When using the managed options, connect Codex with ChatGPT or sign in to Antigravity from
T3 Code instead of running a CLI login command.

### Binary Discovery

Each provider CLI must be on the server's `PATH`, or have an explicit binary path set in
**Settings** → the provider instance → **Binary path**. Use the explicit path when a version
manager or a non-standard install location keeps the CLI off the `PATH` of the shell that
started T3 Code.

Codex connected through ChatGPT and Antigravity can use their managed runtimes without a `PATH`
entry. Antigravity's optional **Binary path** overrides its managed runtime and must point to the
official ACP executable.

T3 Code warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** runs the installer that owns the CLI
(Homebrew, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or the
CLI's own update command when T3 Code cannot tell. Update a CLI installed with
mise through mise. Cursor and Antigravity update with T3 Code. Homebrew installs
compare against the version Homebrew offers, which can trail the npm release by
a few hours. By default, each machine installs these updates on its own; see
[Update providers](./updating.md#update-providers).

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, T3 Code does not display
their original values.

Keys that every agent on the machine should see belong in **Settings → Providers →
Global environment variables**. Saving them also writes the list to other T3
Connect environments you are connected to, so you set a key once and agents on
those machines can use it. A machine that joins later receives the secrets the
next time you save the list while it is connected.

### When an Agent Asks for a Key

An agent that needs an API key or token for its task can ask for it directly.
A masked prompt appears above the composer naming the variable, for example
`OPENAI_API_KEY`, and why the agent wants it. Paste the value and save, or
decline. The value is stored as a sensitive global environment variable and
handed to agent and terminal processes. It is never added to the conversation
or written to the thread history; the running agent loads it from a protected
file on the server rather than seeing it in chat. The prompt closes on its
own if the turn stops or you leave it unanswered for ten minutes. Edit or remove
the key later under **Settings → Providers → Global environment variables**.

### When Auth Is Needed

Provider auth is required before you start a session with that provider, not before you start
T3 Code. You can install T3 Code, open it, and add providers afterwards. A provider that is not
authenticated shows its status and setup instructions in **Settings**.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md),
[Antigravity](./providers-antigravity.md), [Pi](./providers-pi.md), and
[Muse Code](./providers-muse.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from a phone, tablet, or another desktop.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating T3 Code](./updating.md): update the app and connected servers and understand version skew.
