<p align="center">
  <img src="assets/pretty/t3-pretty-mark.png" alt="T3 Pretty" width="96" />
</p>

# Your agents. Your subscriptions. A calmer workspace.

T3 Pretty brings coding agents into one desktop, web, and mobile workspace.
Landscape themes, frosted glass, and a focused chat keep long coding sessions easy to follow.
Run agents on your computer, then connect from another device with **T3 Connect** or a direct pairing URL.

Built on [T3 Code](https://github.com/pingdotgg/t3code), with support for providers such as
Codex, Claude Code, Cursor, and OpenCode. Provider access uses your own accounts and subscriptions.

[Get a public release](https://github.com/SergeSerb2/t3-pretty/releases) ·
[Install and set up](docs/user/install.md) · [Connect remotely](docs/user/remote-access.md)

## Start with a stable release

Choose a release tagged **`public-v<version>`** and use the assets listed there.
Each release states which desktop installers and Android packages it includes.
If your platform has no listed artifact, use the source setup below.
An Android `.apk` installs on a device; an `.aab` is for distribution tooling.
This fork does not claim an App Store or Google Play listing.

If that public release includes `install.sh` and `t3.tgz`, install its CLI on macOS or Linux
with Node.js and npm available:

```sh
curl -fsSL https://github.com/SergeSerb2/t3-pretty/releases/latest/download/install.sh | sh
```

Then run `t3`. See the [install guide](docs/user/install.md) for Windows, provider login,
and source builds. Public builds use T3 Connect and their own app identity and desktop data directory.
Older nightly assets and `desktop-r2-latest` belong to the internal release line.

## Run from source

Install Node.js **24** as specified in [package.json](package.json), Git, and
[Vite+](https://viteplus.dev/guide/) (`vp`). Install `vp` first:

```sh
# macOS or Linux
curl -fsSL https://vite.plus | bash
```

```powershell
# Windows PowerShell
irm https://vite.plus/ps1 | iex
```

Open a new terminal, then:

```sh
git clone https://github.com/SergeSerb2/t3-pretty.git
cd t3-pretty
vp i --frozen-lockfile
vp run dev
```

Open the full pairing URL printed by the dev command. Install and sign in to a provider
on the machine that will run your agents, then enable it in **Settings → Providers**.
For the desktop app, run `vp run build:desktop`, then `vp run start:desktop`.

## Open source, with a deliberate release pace

This repository contains stable source snapshots cut manually by Serge.
Internal development stays on Cursor Origin; public snapshots arrive when a stable version is ready.
There is no automatic public mirror. Each snapshot records its version and source commit in
`.t3-fork/public-release.json`.

T3 Pretty is a fork of **T3 Code**, created by Theo, Julius, and the T3 Code contributors.
It is not an official T3 Code distribution. The code remains available under the
[MIT License](LICENSE); upstream attribution and third-party notices remain in the source.
