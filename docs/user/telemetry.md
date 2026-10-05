# Product usage data

The T3 Code server sends product usage events to PostHog, associated with a hashed account or
installation identifier. Events include the provider, model, reasoning effort, permission mode,
turn result, duration, and main-agent token totals when available.

Events do not include prompts, responses, file contents, authentication tokens, conversation IDs,
raw provider events, or child-agent output. Child-agent token use is excluded from the totals.

To disable collection, set `T3CODE_TELEMETRY_ENABLED=false` in the server's environment before
starting it. This stops product events from being recorded or sent.

## Optional agent monitoring

Agent monitoring helps you find recurring provider and tool failures across your T3 servers.
It is off by default and is configured on each server, including hosts you reach from desktop,
web, or mobile. Collection starts when you enable it; it does not upload old conversations.

To prepare a new Sentry destination, create a Sentry account or organization, then create a
Node.js project named `t3-pretty-agents`. Copy its client DSN from **Settings > Projects >
t3-pretty-agents > Client Keys (DSN)** into your server's secret configuration. A Sentry
management API token is not required for ingestion.

Open **Settings > General > Diagnostics > Agent monitoring** in desktop or web, or open a host under
**Settings > Connections** on mobile. Enter the project ingestion DSN and enable that host.
The saved choice covers every thread and takes effect without a restart.

Use **Enable on all saved hosts** to apply the same choice to your saved connections. This
device remembers the enrollment choice and applies it as offline hosts reconnect. Keep this
client open for pending enrollment; once a host saves its setting, collection continues even
when the client is closed. Older hosts show that a server update is required. Windows and WSL
are separate environments and need enrollment individually. Configure automatic enrollment
on one device to avoid competing choices from different clients.

The host list shows enrollment acknowledgements, local collection, delivery timestamps,
pending records, and failures. A saved setting is separate from a confirmed delivery. Refresh
a host after running an agent to check delivery. Use **Retry failed hosts** after resolving a
connection or permission problem.

Command-line and service launches can override the saved setting with
`T3CODE_AGENT_MONITORING_ENABLED` and `SENTRY_DSN`. Environment overrides are read at startup.
Omit the DSN to collect locally while preparing a destination.

In Sentry, use
Logs for lifecycle activity, Traces for completed operations, and Issues for reported provider
errors and failed tools or subagents. Filter by `t3.environment_id`, `t3.provider`, tool, or release
to compare hosts and versions. Match `t3.environment_id` to the Monitoring ID in the host list
to locate its local thread history. The identifier is hashed and remains stable for that
T3 server.

Monitoring retains status transitions, timing, provider/model identifiers, tool names, exit
codes, result sizes/counts, and reported token usage. It excludes prompts, command arguments,
responses, error messages, stack traces, file paths/content, URLs, and raw provider events.
Error codes and conversation identifiers are hashed. Summaries are generated from status
fields rather than agent text. Custom model/tool identifiers must pass the identifier filter;
avoid putting sensitive information in those identifiers.

Run `t3 agent-monitoring --base-dir /path/to/t3-home` for a local JSON summary of retained
outcomes, grouped failures, and pending delivery. The default home is used if you omit the flag.
The journal is `userdata/logs/agent-monitoring.sqlite` under that home. It keeps up to 20,000
observations. An outage retains pending records for retry; when the limit is exceeded, oldest
records are evicted and `droppedPendingCount` reports unexported losses. Delivery is at least
once. Accepted signals are checkpointed separately; an interrupted or lost acknowledgment can
still produce duplicate remote logs or spans. Local counts describe
retained observations, and `activeAgentCount` describes the last reported status rather than
proving that an agent is still alive.

The initial pilot covers activity reported through T3's committed agent events, including
reported subagents. Standalone terminal agents, unreported provider internals, client crashes,
host availability, and quality evaluation of agent answers are outside this pilot. Provider
turns are not treated as individual model requests, and usage retains its reported scope.

Disable the host or all saved hosts to stop collection and delivery. Stop automatic enrollment
on the controlling device before making independent host choices. If an environment override
forces monitoring on, remove it or set `T3CODE_AGENT_MONITORING_ENABLED=false` and restart. Existing
local and Sentry records remain subject to their respective retention settings. To remove the
local journal, stop that server before deleting the journal and its `-wal`/`-shm` siblings.
