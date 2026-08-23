# Surge Connect (T3 Connect-compatible)

> For maintainers. Using T3 Code? See [docs/user](../user/).

T3 Connect is the public build's deployment and user-facing name for the upstream protocol. Internal
builds use the same protocol with the fork-operated Surge Connect relay and branding. Technical API
routes, environment variables, types, and the `t3 connect` CLI stay unchanged for compatibility.
Each flavor uses one Clerk application for web, desktop, and mobile
authentication. The relay verifies two kinds of bearer credential: template JWTs generated from the
`t3-relay` template with the shared `t3-code-relay` audience, and Clerk OAuth tokens issued to the
CLI. `verifyRelayClientBearerToken` in `infra/relay/src/http/Api.ts` tries the template/session path
first and falls back to OAuth verification (`acceptsToken: "oauth_token"`), so the CLI's OAuth
credential works without a JWT template.

For the wider system diagram, see
[t3-code-connect-auth-flow.html](./t3-code-connect-auth-flow.html).

## Application Keys

The internal flavor operates its own Surge Connect relay (`https://relay.sergeserbinenko.com`, deployed by
`deploy-relay.yml` from `infra/relay/`) with a raised managed-tunnel limit — the parent's
production relay caps managed tunnels at 3 per user. The repository-root example file supplies the
checked-in public defaults, so fresh source builds do not need a private environment file:

```sh
vp run dev
```

`.env.example` carries the public T3 Connect identifiers. `.env.internal.example` carries the
internal Surge Connect identifiers. Select the internal flavor with `T3CODE_BUILD_FLAVOR=internal`;
the default is `public`. To target a different Clerk application or relay, override the values in a repository-root
`.env` or `.env.local` file:

```dotenv
T3CODE_CLERK_PUBLISHABLE_KEY=<publishable key>
T3CODE_CLERK_JWT_TEMPLATE=<JWT template name>
T3CODE_CLERK_CLI_OAUTH_CLIENT_ID=<public OAuth application client ID>
T3CODE_RELAY_URL=https://relay.example.com
```

The shared client loader projects these canonical values into framework-specific `VITE_*` and
`EXPO_PUBLIC_*` aliases. Existing aliases remain accepted as overrides for compatibility, but new
client configuration should use the canonical names.

The environment persists the relay URL and cloud user that own its active link. The web
reconciliation path only treats that link as enabled when both match the desktop's current build
and signed-in account. A linked desktop automatically replaces a stale relay or account link before
installing the current account, credential, issuer, and managed tunnel configuration.

Configuration precedence is:

1. Process or CI environment variables.
2. Repository-root `.env.local`.
3. Repository-root `.env`.
4. Checked-in defaults from `.env.example` (public) or `.env.internal.example` (internal flavor).

The Clerk publishable key, JWT template name, CLI OAuth client ID, and relay URL are public
identifiers, not secrets.
Web, desktop, mobile, and bundled server builds statically inject the values they consume during
their build step. A built artifact does not need an environment file at runtime. CI release builds
should set `T3CODE_CLERK_PUBLISHABLE_KEY`, `T3CODE_CLERK_JWT_TEMPLATE`,
`T3CODE_CLERK_CLI_OAUTH_CLIENT_ID`, and `T3CODE_RELAY_URL` before building. EAS preview and
production builds only need the Clerk publishable key, JWT template name, and relay URL in their EAS
environment.

The desktop main process also passes the relay URL, Clerk publishable key, and CLI OAuth client ID
to backends it manages over SSH. They are part of the remote runner signature, so changing builds or
relay configuration restarts a desktop-managed backend with a coherent control plane. A separately
running backend discovered over SSH remains external and keeps its own configuration.

Clerk must allow both Electron renderer origins, `t3code://app` and `t3code-dev://app`, on the
instance. Without them, Clerk rejects desktop bootstrap with `origin_invalid` and the client cannot
offer sign-in or account management. The production relay workflow reconciles these origins through
Clerk's Backend API before every deployment, preserving any web or extension origins already on the
instance. Self-hosted deployments that do not use that workflow must add the two values to the
instance's allowed origins themselves.

When any client-facing public value is absent, network-backed cloud actions, authentication, and
relay discovery are omitted or disabled. **Connections** keeps a noninteractive Surge Code account
row visible so the missing build configuration is explicit. The `t3 connect` command group is always
registered: when the CLI public values are absent, `makeCli` in `apps/server/src/bin.ts` registers a
hidden fallback `connect` command that reports the missing configuration instead of silently
vanishing from help. The bundled server still accepts runtime overrides for self-hosted or
operator-managed deployments.

For a hosted relay deployment, copy `infra/relay/.env.example` to `infra/relay/.env`. The relay
deployment reads `RELAY_DOMAIN`, `RELAY_API_ZONE_NAME`, `RELAY_TUNNEL_ZONE_NAME`,
`CLERK_PUBLISHABLE_KEY`, and `CLERK_JWT_AUDIENCE` through Effect `Config`. There are no checked-in
deployment defaults.
`vp run --filter t3code-relay deploy` invokes Alchemy from the relay directory, so Alchemy loads
`infra/relay/.env`. After a successful deployment, the wrapper updates the repository-root `.env`
with the deployed HTTPS relay URL. The relay still requires
`CLERK_SECRET_KEY` as an Alchemy secret. Never put `CLERK_SECRET_KEY` in a client application
environment or commit it to the repository.

The `prod` Alchemy stage owns the retained PlanetScale database. Non-production stages reference
that database and provision isolated PlanetScale branches, so deploy `prod` before creating a
personal developer stage.

## Headless CLI OAuth Application

The `t3 connect` commands authorize a headless environment with a separate Clerk OAuth application.
This uses an OAuth public client with PKCE, so the CLI stores no client secret.

In **Clerk Dashboard > OAuth applications**:

1. Create an OAuth application for the T3 CLI.
2. Enable the **Public** option so authorization-code exchange uses PKCE.
3. Add **both** allowed redirect URIs:
   - `http://127.0.0.1:34338/callback` for the loopback listener;
   - `https://app.t3.codes/connect/callback` for the hosted out-of-band flow. This is
     `connectCallbackUrl(DEFAULT_HOSTED_APP_URL)` from `packages/shared/src/connectAuth.ts`, so a
     custom `T3CODE_HOSTED_APP_URL` means `$T3CODE_HOSTED_APP_URL/connect/callback` instead.
     Omitting it breaks headless and SSH authorization.
4. Enable the `openid`, `profile`, and `email` scopes.
5. Set `T3CODE_CLERK_CLI_OAUTH_CLIENT_ID` in the repository-root `.env` file and release build
   environment to the generated public client ID.

Both CLI flows start at the hosted `/connect` page (`buildConnectAuthorizeRequestUrl` in
`packages/shared/src/connectAuth.ts`), which waits for a Clerk session and then forwards the request
to Clerk's `/oauth/authorize`. The CLI never opens `/oauth/authorize` directly: a signed-out browser
sent there goes through Clerk's sign-in redirect, which drops the authorize query parameters and
fails the flow with `unsupported_response_type` or an empty `state` (#5051). The loopback flow marks
the request with a `port` fragment parameter so the hosted page asks Clerk to redirect the
authorization code straight to `http://127.0.0.1:<port>/callback`; the out-of-band flow omits it and
uses the hosted `/connect/callback` page instead. The CLI derives Clerk's frontend API URL from the
publishable key and calls only the `/oauth/token` endpoint directly. The relay is not involved in
the OAuth handshake; it only validates the issued Clerk bearer token when the CLI manages an
environment link.

The connect command group is:

```sh
t3 connect            # default: onboarding
t3 connect login
t3 connect link       # --publish-only
t3 connect status     # --json
t3 connect publish    # --disable
t3 connect unlink
t3 connect logout
```

`t3 serve` is a separate top-level command, not a connect subcommand.

`t3 connect login` opens the Clerk authorization flow and stores the CLI credential without enabling
cloud exposure. `t3 connect link` installs the pinned managed `cloudflared` binary when needed,
authorizes when needed, and records durable intent to expose the environment. It works without a
running T3 server. The next `t3 serve` or `t3 start` reconciles the relay link and launches the
managed tunnel. `t3 connect unlink` records disabled intent immediately, stops a reachable running
connector, and attempts to revoke the relay-side environment record. It retains the stored CLI
authorization so `t3 connect link` can re-enable exposure without another browser flow. `t3 connect
logout` performs the same cleanup and removes the stored CLI authorization.

The background service has an independent lifecycle. Connect setup may offer to install it, but
logout leaves it running; manage it with `t3 service status`, `install`, `update`, and `uninstall`.

### Headless and SSH authorization

The loopback OAuth callback listener binds to port `34338`. That path only works when a browser on
the same machine can reach it, so `authorizeCli` in `apps/server/src/cli/connect.ts` automatically
selects the out-of-band flow when `--headless` is passed or when it detects SSH through
`SSH_CONNECTION` or `SSH_TTY`. The out-of-band flow prints the hosted `/connect` authorization URL
and accepts a pasted authorization code, so no port is involved.

Port forwarding is therefore optional, not required. Forward the port only if you specifically want
the loopback flow over SSH:

```sh
ssh -L 34338:127.0.0.1:34338 <host>
```

## JWT Template

In **Clerk Dashboard > JWT templates**, create a template with:

| Setting | Value                        |
| ------- | ---------------------------- |
| Name    | `t3-relay`                   |
| Claims  | `{ "aud": "t3-code-relay" }` |

Set `T3CODE_CLERK_JWT_TEMPLATE=t3-relay` in the repository-root `.env`, and set
`CLERK_JWT_AUDIENCE=t3-code-relay` in `infra/relay/.env`. Define `CLERK_JWT_TEMPLATE` and
`CLERK_JWT_AUDIENCE` in the production relay deployment environment as well. The stable `aud` value
is shared by production and non-production relay stages. The client-facing `T3CODE_RELAY_URL` still
selects the concrete relay deployment, but changing that URL does not require a JWT template change.

## Desktop OAuth Redirect Allowlist

The desktop app opens OAuth in the system browser and returns to the app with a custom URL scheme.
In **Clerk Dashboard > Native applications**, enable the Native API and add these entries under the
mobile SSO redirect allowlist:

```text
t3code-dev://app/
t3code://app/
```

Local desktop development uses `t3code-dev://app`, while packaged builds use `t3code://app`. Add both
origins to every Clerk instance used by desktop clients. This matches the production relay workflow
and keeps an instance usable by development and packaged renderers without an `origin_invalid`
bootstrap failure. `@clerk/electron` owns the native request adapter, encrypted Clerk token
persistence, external-browser OAuth transport, and callback delivery for initial sign-in and
linked-account flows.

There is currently no Dashboard UI for `allowed_origins`. With `CLERK_SECRET_KEY` present in the
shell environment, run the same idempotent reconciler used by the production workflow:

```sh
vp run --filter t3code-relay configure-clerk
```

The reconciler reads the current array, adds any missing desktop origins, and only then updates the
instance, so existing web and extension origins remain intact.

Never put `CLERK_SECRET_KEY` in the desktop app, a client-facing environment file, or a build
artifact.

## Desktop Passkeys

The production macOS bundle ID is `com.t3tools.t3code`. To enable native passkeys:

1. Create an explicit macOS App ID for `com.t3tools.t3code` in the Apple Developer portal and enable
   **Associated Domains**.
2. Create a compatible macOS provisioning profile for that App ID and the certificate used to sign
   the distributed app.
3. In Clerk's Native API settings, add an iOS app with the same Apple Team ID and bundle ID. This is
   also the configuration point for Electron/macOS passkeys.
4. Confirm Clerk serves `https://<frontend-api>/.well-known/apple-app-site-association` and that
   `webcredentials.apps` contains `<TEAM_ID>.com.t3tools.t3code`.
5. Set the local or CI signing configuration described below.

For a local signed build, add these values to `.env.local` or export them before invoking the
desktop artifact command:

```dotenv
T3CODE_APPLE_TEAM_ID=ABC1234567
T3CODE_MACOS_PROVISIONING_PROFILE=/absolute/path/to/t3code.provisionprofile
# Optional: comma-separated override when Clerk's RP ID differs from the Frontend API hostname.
T3CODE_CLERK_PASSKEY_RP_DOMAINS=example.clerk.accounts.dev,clerk.example.com
```

When `T3CODE_CLERK_PASSKEY_RP_DOMAINS` is absent, the build derives the RP domain from
`T3CODE_CLERK_PUBLISHABLE_KEY`. Signed macOS builds fail early if the Team ID, provisioning profile,
or RP-domain configuration is missing. The generated main-app entitlements include every configured
`webcredentials:<domain>` entry; helper apps keep Electron's minimal default entitlements.

The normal `dev:desktop` launcher is unsigned and cannot complete macOS passkey ceremonies. For
renderer HMR, build and install a signed app first, run the renderer dev server, then launch the
installed app executable with `VITE_DEV_SERVER_URL` and `T3CODE_PORT` set. Rebuild the signed app
after native dependency, main-process, preload, entitlement, provisioning, or signing changes;
renderer-only changes can reuse the installed app.

For the default development ports, run `pnpm dev:web` in one terminal and launch the installed
binary from another:

```sh
VITE_DEV_SERVER_URL=http://127.0.0.1:5733 \
T3CODE_PORT=13773 \
  "/Applications/T3 Code (Alpha).app/Contents/MacOS/T3 Code (Alpha)"
```

After changing Associated Domains, bump the build version before rebuilding; macOS may otherwise
reuse stale Shared Web Credentials metadata for the same app/version pair.

Verify the installed bundle before testing:

```sh
codesign --verify --deep --strict "/Applications/T3 Pretty.app"
codesign -d --entitlements :- "/Applications/T3 Pretty.app"
```

The current mobile UI uses Clerk's native authentication view. If a future mobile browser OAuth
flow uses a custom redirect URI, add that exact URI to the same allowlist.

## Sign-in Surfaces

Signed-in users manage the selected Connect service under **Connections**. Public builds label the
service T3 Connect and the account T3; internal builds label them Surge Connect and Surge Code. The
page begins with a persistent account row: signed-out users get a sign-in action, while signed-in
users see their account and a **Manage account** action. The settings sidebar also renders
`T3ConnectSidebarSignIn` while signed out and `T3ConnectSidebarAvatar` while signed in. All account
controls are gated on cloud public configuration; an unconfigured build keeps the Connections row
visible and explains why managed connections are unavailable. Desktop renders the same web bundle, so it
has these controls too. The waitlist enrollment flow from the private beta was removed when Connect
went GA; sign-up is open unless a Clerk restriction below is enabled.

## Desktop Mesh Reconciliation

Relay environment membership is account-authoritative, while the connection catalog remains local
to each client. A signed-in desktop whose primary environment has an active managed tunnel bridges
those models: after successful discovery it reconciles all other account environments into
`RelayConnectionTarget` entries, updates labels, and removes relay-owned entries no longer present.
Direct, SSH, and platform-managed entries are never overwritten by this reconciliation.

Discovery refreshes environments and their statuses when credentials change or the application
returns to the foreground. The desktop's bounded live-refresh cadence only refreshes account
membership: mesh reconciliation does not need to probe every environment endpoint once per minute.
The previous list is retained during an in-flight refresh; only an authoritative successful list
mutates the catalog.
Clicking **Connect** on desktop first saves the requested remote target and then enables the local
managed link if necessary, making the relationship reciprocal. An explicitly disabled local link
is not re-enabled in the background.

Headless servers and browser-only clients do not run the desktop reconciler. A headless server can
be discovered and added by desktops but has no client catalog to populate, which keeps that
connection one-way by construction.

## Restricting Sign-ups: Known-User Allowlist

For a closed deployment where all permitted users are known in advance, restrict sign-up to
permitted email addresses or domains:

1. In **Clerk Dashboard > Restrictions > Allowlist**, add each permitted email address or email
   domain.
2. Enable the allowlist and save.
3. Alternatively, enable **Restricted mode** when all new users must be explicitly invited or
   manually created.

Do not enable an empty allowlist: it blocks all new sign-ups.

Clerk allowlists control who can sign up. They do not revoke an existing user's active cloud
access. To remove an already-created user's access, ban that user in Clerk so their active
sessions are ended and future sign-ins are rejected.
