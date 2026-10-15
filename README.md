# T3 Pretty

T3 Pretty gives coding agents a desktop, web, and mobile client with landscape themes and frosted glass.
It uses your existing provider subscriptions and is based on [T3 Code](https://github.com/pingdotgg/t3code).

This public repository contains stable source snapshots cut manually by Serge.
It does not sync upstream or receive automatic internal updates. Internal development and pull requests
stay on the independent, private Cursor Origin repository. New public versions appear only when Serge cuts them.

Download installers from the [public stable releases](https://github.com/SergeSerb2/t3-pretty/releases).
Use releases tagged `public-v<version>`; older nightly releases and `desktop-r2-latest` belong to the internal lineage.
Public installers use their own app identity, data directory, and GitHub update feed.
Internal installations continue to use their existing R2 feed and Surge Connect.

Install the public CLI after a public stable release is available:

```sh
curl -fsSL https://github.com/SergeSerb2/t3-pretty/releases/latest/download/install.sh | sh
```

To build this source snapshot, install Node.js as specified in `package.json`, then run:

```sh
vp i
vp run dev
```

Builds default to the public flavor. The snapshot's `.t3-fork/public-release.json` records its public
version and exact Origin source commit. Public releases build only from that snapshot.

Read the [user guides](docs/user/install.md) for provider setup, remote connections, and daily use.

The initial source tree is retained from the former mirror until Serge cuts the first public stable version. This repository policy change is not a stable release.
