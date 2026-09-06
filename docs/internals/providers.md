# Provider constraints

Orchestration records intent and state without knowing which provider runs a thread. Provider
protocols, account ownership, permissions, and capabilities belong at the
[adapter boundary](../../apps/server/src/provider/Services/ProviderAdapter.ts). Normalize there
instead of spreading provider checks through reactors and clients.

A driver kind identifies an integration; an instance identifies one configuration and account
lifecycle. Route work by instance, so two accounts using the same driver do not share mutable
session or catalog state.

## T3 Pretty provider set

[`builtInDrivers.ts`](../../apps/server/src/provider/builtInDrivers.ts) registers six drivers:
`codex`, `claudeAgent`, `cursor`, `grok`, `kimi`, and `antigravity`. T3 Pretty intentionally
includes its Kimi integration and does not register the parent OpenCode provider.

Cursor, Grok, and Kimi share
[`AcpSessionRuntime.ts`](../../apps/server/src/provider/acp/AcpSessionRuntime.ts). Cursor's picker
catalog merges the ACP `cursor/list_available_models` list with `cursor-agent --list-models`, so
models advertised by the CLI are not dropped when ACP omits them or one model fails schema decode.
Kimi opts into `clientCapabilities.terminal`, allowing Kimi 0.37+ to run shell, glob, and grep
through [`AcpTerminalHost.ts`](../../apps/server/src/provider/acp/AcpTerminalHost.ts) in the session
working directory. Other ACP drivers leave the capability off unless they explicitly pass
`clientCapabilities.terminal: true`.

## Process and account isolation

### Parent OpenCode context

> T3 Pretty removed the OpenCode provider. These constraints describe parent T3 Code behavior and
> are retained for upstream-sync context; they are not active T3 Pretty provider behavior.

Parent T3 Code's managed OpenCode chat uses one server per thread. Its MCP registrations are
directory-scoped, while the `t3-code` MCP connection is thread-scoped. Sharing a chat server
between threads in one directory would let them replace each other's connection. Catalog and
text-generation work can share the parent instance-owned `OpenCodeServerOwner.ts` helper, which
closes after an idle period. External OpenCode servers remain externally owned and can require an
external restart to pick up configuration changes.

OpenCode also stores persistent approval grants per directory. Automatic full-access replies use
`once` so they cannot widen a supervised thread's permissions on a shared external server. This is
implemented by the parent `OpenCodeAdapter.ts`.

Antigravity separates account profiles per instance while sharing installed executables across the
environment. It forces file-based credential storage because the native macOS keychain entry would
otherwise be shared across instances. The launch environment removes ambient Google credentials,
so an instance cannot silently use another account or billing project.
See [profile isolation](../../apps/server/src/provider/antigravityAuthSupport.ts).

The [Antigravity installer](../../apps/server/src/provider/AntigravityInstallation.ts) outlives
client connections and provider-instance rebuilds. Releases are immutable, with an atomic pointer
selecting the version for new processes. Running processes hold leases on their version. Updates
and removal must respect those leases instead of replacing executables under a running agent.

## Setup must not happen as a health-check side effect

Opening a provider session can start MCP servers, run hooks, or launch a login browser.
[Grok probes](../../apps/server/src/provider/Layers/GrokProvider.ts) avoid authentication and
session creation for this reason. Antigravity likewise reserves authenticated catalog sessions for
explicit setup or model refresh; background checks use initialization only.

[Antigravity sign-in](../../apps/server/src/provider/AntigravityAuth.ts) belongs to the initiating
T3 Pretty auth session. The client carries the return URL back to the environment because the
provider's loopback listener may be on another machine. Forward only the callback for the owned
pending flow; a successful callback HTTP request is not proof that provider authentication
finished. The native process owns token exchange and storage.

Antigravity sign-out closes admission to new processes and stops existing processes before
clearing account metadata. Otherwise a helper or resumed session could retain the old account.
Cached model lists do not establish current access, and an authoritative empty catalog must clear
the old list.

Antigravity text-generation helpers deny tool requests, but native hooks and MCP configuration can
run before the prompt. They reject profiles with such configuration before launch. Prompt
instructions and tool denial do not create a native sandbox.
See [helper constraints](../../apps/server/src/textGeneration/AntigravityTextGeneration.ts).

## Protocol traps

Codex async questions arrive as notifications and are answered with a new user message. There is
no pending RPC response to send. Blocking questions still use the request/response path. The
[adapter](../../apps/server/src/provider/Layers/CodexAdapter.ts) distinguishes them; the
[decider](../../apps/server/src/orchestration/decider.ts) records an async answer and its user
message together.

An async question can outlive the turn or a server restart. The engine reads that request's
durable activity before resolving it because the in-memory command snapshot omits old activities.
Do not infer that a request has disappeared merely because it is outside the recent window.

Capabilities must describe what the provider can actually do. Antigravity can capture workspace
checkpoints but cannot roll back its conversation. The
[checkpoint boundary](./overview.md#turn-completion-and-checkpoints) therefore rejects revert
before touching files. Native permission and question option IDs must also survive normalization;
a display label is not necessarily a valid reply.

## Attachments and stored history

Attachments live outside the project workspace.
[ProviderService](../../apps/server/src/provider/Layers/ProviderService.ts) puts their
environment-local paths in turn input and lets adapters choose native input formats. A path in the
prompt does not grant filesystem access. Keep provider sandbox and approval rules in force;
copying uploads into the project to bypass them changes that boundary.

File attachments introduced a replay compatibility limit. Image-only clients cannot decode
file-bearing messages, and an image-only server can fail the entire environment's startup when
replaying one such event. Rollouts and downgrades must account for persisted history as well as
current client support.

Model classification has its own [manifest constraints](./model-manifest.md). Assistant-reference
handling is documented under [citations](./assistant-citations.md).
