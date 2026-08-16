# Workspace layout

> For maintainers. Using T3 Code? See [docs/user](../user/).

A pnpm workspace driven by [vite-plus](https://vite.plus) (`vp`). See [scripts.md](./scripts.md) for
the task commands.

## apps

- `apps/server` (`t3`): the execution runtime and the published CLI. Owns orchestration, provider
  drivers, checkpointing, VCS, terminals, filesystem access, auth, and the HTTP + WebSocket surface.
  Also serves the built web app.
- `apps/web` (`@t3tools/web`): React + Vite UI. Consumes the shared client runtime and adds routing,
  components, and web-specific platform layers. Route components are code-split by the TanStack
  router plugin (`autoCodeSplitting` in `vite.config.ts`); only the chat routes stay in the entry
  chunk since one of them renders on every cold start. Settings, usage, pull requests, pairing, and
  the Electron Clerk root (`src/electronClerkRoot.tsx`, which carries all of clerk-js) load as
  `/assets/*` chunks on first use.
- `apps/desktop` (`@t3tools/desktop`): Electron shell. Supervises a desktop-scoped `t3` backend,
  loads the web bundle over the `t3code://` protocol, and owns SSH-managed remote environments.
  In packaged builds `t3code://app/*` is served straight from `apps/server/dist/client` on disk
  (`ElectronProtocol.ts`: `net.fetch(file:)`, extension-less paths fall back to `index.html`,
  hashed `/assets/*` get immutable caching for the V8 code cache); only `/api/`, `/oauth/` and
  `/.well-known/` proxy to the backend, and in development everything still proxies to Vite. The
  main window therefore opens as soon as the primary backend has a start config instead of
  waiting for its HTTP readiness; the renderer retries its session bootstrap until the backend
  listens and the main process pushes `desktop:backend-ready` (`DesktopBridge.onLocalBackendReady`)
  so the connection layer re-reads the local topology at once. WSL-only mode keeps the
  "Connecting to WSL" splash and opens the window on readiness, since its bootstrap is hidden
  until preflight passes. `main.cjs` bundles `effect`, `@effect/platform-node` and
  `electron-updater` (see `deps.alwaysBundle` in `apps/desktop/vite.config.ts` and
  `DESKTOP_BUNDLED_DEPENDENCY_NAMES` in `scripts/build-desktop-artifact.ts`), so they are not
  staged into the asar.
- `apps/mobile` (`@t3tools/mobile`): Expo/React Native client. Same client runtime composition as
  web, different platform layer and UI.
- `apps/marketing` (`@t3tools/marketing`): Astro marketing site.

## packages

- `packages/contracts` (`@t3tools/contracts`): shared Effect Schema definitions. RPC group,
  orchestration commands/events/read model, auth scopes, environment descriptors, settings.
- `packages/shared` (`@t3tools/shared`): framework-agnostic utilities used by server and clients
  (`DrainableWorker`, git and source-control helpers, relay auth and signing, DPoP, semver, logging,
  observability, and more).
- `packages/client-runtime` (`@t3tools/client-runtime`): connection lifecycle, authorization, RPC
  session, environment registry, and Atom-based domain state shared by web and mobile. See its
  [README](../../packages/client-runtime/README.md).
- `packages/ssh` (`@t3tools/ssh`): SSH config parsing, auth prompts, command execution, and the
  tunnel/environment manager behind desktop-managed SSH environments.
- `packages/tailscale` (`@t3tools/tailscale`): Tailscale CLI wrapper, including the
  `ensureTailscaleServe` / `disableTailscaleServe` serve lifecycle the server drives.
- `packages/effect-acp` (`effect-acp`): Effect client and agent implementation of the Agent Client
  Protocol, used by ACP-speaking provider drivers.
- `packages/effect-codex-app-server` (`effect-codex-app-server`): Effect client for the
  `codex app-server` JSON-RPC protocol.

## infra

- `infra/relay` (`t3code-relay`): the hosted T3 Connect relay, deployed with Alchemy. Handles
  environment discovery, cloud-side records, and mobile notifications. It is not in the hot path;
  after connect, client traffic goes directly to the environment. See
  [t3-connect.md](./t3-connect.md).

## Other top-level directories

- `scripts/`: workspace tooling run through `vp run`. Dev runner, desktop artifact builds, release
  helpers, mobile static checks and showcase capture, update-manifest merging.
- `assets/`: brand and app icon sources per channel (`dev`, `nightly`, `prod`).
- `patches/`: pnpm patches for pinned upstream dependencies.
- `oxlint-plugin-t3code/`: repo-specific lint rules.
- `experiments/`: throwaway prototypes. Not part of the shipped build.
- `docs/`: this documentation tree.

## Import conventions

`@t3tools/shared` and `@t3tools/client-runtime` use explicit subpath exports with no barrel index and
no root export. Import the narrow path (`@t3tools/shared/DrainableWorker`,
`@t3tools/client-runtime/state/threads`) rather than the package root. Files that are not exported
are implementation details. `@t3tools/contracts` does export a root alongside `./settings` and
`./relay`.
