# Install T3 Code

T3 Code runs coding agents on your computer and lets you control them from its
desktop, web, or mobile app. Set up the machine where the agents will work first.

This page installs T3 Pretty from the
[R2 feed](https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/).
GitHub Releases are not the install channel; the GitHub tag `desktop-r2-latest`
is only a pointer. The same feed is the
[internal release path](../operations/public-release-and-github-mirror.md#internal-release-path)
(Surge Connect, `~/.t3`).

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch T3 Code and configure providers afterwards.

## Command line

T3 Pretty's CLI is not `npx t3`; that command installs upstream T3 Code.

Install the T3 Pretty CLI on macOS or Linux:

```bash
curl -fsSL https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/install.sh | sh
```

On Windows, install it from the same T3 Pretty R2 feed in PowerShell:

```powershell
irm https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/install.ps1 | iex
```

Then start it:

```bash
t3
```

On macOS and Linux, this installs the `t3` binary to `~/.local/bin`. If your
shell reports `command not found` afterwards, that directory is not on your
`PATH` yet; the installer prints the line to add.

| Task                                             | Command                                                   |
| ------------------------------------------------ | --------------------------------------------------------- |
| Start the server and open the web app            | `t3`                                                      |
| Start the server without a browser               | `t3 serve`                                                |
| Keep it running in the background (macOS, Linux) | `t3 service install` ([details](./background-service.md)) |
| Move to the newest T3 Pretty release             | `t3 update`                                               |
| Remove it again                                  | `t3 uninstall`                                            |

Run `t3 help` or `t3 --help` for the full reference. To start in a new working
directory, use an explicit path such as `t3 ./my-project`. A bare directory name
is accepted only if it already exists.

If `t3` or `t3 start` reports an already running server, connect to that server
instead. Stop it before starting a replacement, or use a different `--base-dir`
for an independent server.

On a macOS or Linux machine that should stay reachable after logout, run
`t3 service install` and pair from another device, then turn on **Surge Connect**
under **Settings** → **Connections**.

### Intel Macs

There is no `t3` executable for Intel Macs (the desktop app is available). To
run a server there, build it from source with Node.js 24 and `vp`
([Install vp](https://github.com/pingdotgg/t3code#install-vp)):

```bash
git clone https://github.com/pingdotgg/t3code
cd t3code && vp i && vp run build:desktop
node apps/server/dist/bin.mjs
```

`t3 update` and the background service do not apply to a server run this way;
update it with `git pull` and a rebuild.

## Desktop app

Download today's tip from the
[R2 feed](https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/).
Do not install from old GitHub Release assets. The GitHub tag `desktop-r2-latest`
is only a pointer.

- macOS (Apple Silicon):
  [DMG](https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/T3-Code-0.0.41-nightly.20260914.1707002073-arm64.dmg)
- Windows (x64):
  [NSIS](https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/T3-Code-0.0.41-nightly.20260914.1707002055-x64.exe)
- Linux (x64):
  [AppImage](https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/T3-Code-x64.AppImage)
  and `.deb` from the same
  [R2 feed](https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/).

When those filenames go stale, read
[latest-mac.yml](https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/latest-mac.yml),
[latest.yml](https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/latest.yml),
and
[latest-linux.yml](https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/latest-linux.yml)
for the current tip. After the first install, the desktop app updates itself from
the same feed.

The Linux `.deb` updates itself like the other desktop builds. It asks for your
password to install each update. If your desktop has no password prompt, the
update fails. Download the new `.deb` from the R2 feed and install it the same
way. `winget`, Homebrew `t3-code`, and AUR `t3code-bin` install upstream T3 Code,
not this fork.

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

Install the T3 Pretty mobile app for iOS or Android through the distribution
channel for your build. The phone connects to a T3 Pretty server on another
machine. Follow [remote access](./remote-access.md) to link it through Surge
Connect or a pairing URL.

Nightly builds need the beta app. The store apps cannot connect to them. A Nightly build also
shows these links as QR codes in **Settings → General → Mobile app**.

- **iPhone and iPad:** join the [TestFlight beta](https://testflight.apple.com/join/XgaxaRtd).
- **Android:** join the [beta group](https://groups.google.com/g/t3-code-v2-beta). With the same
  Google account, open the [Google Play testing page](https://play.google.com/apps/testing/com.t3tools.t3code)
  and become a tester.

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
| Pi          | Install [Pi](https://pi.dev), then run `pi` once to finish its login or API-key setup.                                                                    |
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
a few hours.

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
