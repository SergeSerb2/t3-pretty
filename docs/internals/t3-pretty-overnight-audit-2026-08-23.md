# T3 Pretty overnight audit — 2026-08-23

This ledger records the original cross-surface audit snapshot of web, desktop,
mobile, server, Connect, relay, provider adapters, release automation, and
shared runtime code. It separates changes that were safe to make without a
product decision from findings that need an explicit tradeoff.

During wrap-up on 2026-08-24, the fork's main branch had been force-rewritten.
The PR was therefore integrated conservatively onto that refreshed main:
current-main behavior wins at overlapping or structurally ambiguous changes,
and retired OpenCode, canvas, and desktop-capture paths remain retired. The
final PR diff is the source of truth for which compatible audit fixes survived
that integration; the detailed implemented list below describes the original
audit snapshot rather than claiming that every item remains in the PR.

## Safety boundary

- The work lives only in the isolated
  `codex/overnight-audit-20260823` worktree. The developer's dirty checkout and
  live T3 userdata were not modified.
- No application, service, provider, tunnel, browser, simulator, dev server,
  updater, or unrelated process may be stopped, restarted, or signalled while
  this audit continues.
- A test in the original audit supplied synthetic PID `1` to the OpenCode
  server-process finalizer. On POSIX, negating that PID produced
  `kill(-1, signal)`, which can broadcast to unrelated processes. Work stopped
  immediately. Refreshed main subsequently retired OpenCode; the final PR does
  not restore either that runtime or the lifecycle test, and the test was not
  executed again.
- Verification after that incident is limited to source inspection,
  formatting, linting, and compile-only checks. No integrated client or
  lifecycle verification has been performed.

## Fixes implemented in the original audit snapshot

### Server, providers, networking, and shared runtime

- Reject malformed or oversized persisted thread-search tuple keys instead of
  throwing while client state initializes.
- Retry an authentication-blocked client connection when an update restart
  nudges reconnect, without retrying permission or configuration failures.
- Convert synchronous Tailscale spawn failures into the package's typed error
  channel.
- Bound Tailscale status JSON at 16 MiB and diagnostic output at 64 KiB while
  continuing to drain every stream. Serve commands now drain stdout as well as
  stderr, preventing an unexpected CLI banner or error flood from blocking the
  child on a full pipe.
- Launch the SSH tunnel's remote command through the remote login shell so the
  provider environment matches an interactive remote session.
- Stream-discard HTTP readiness bodies inside each probe's deadline instead of
  materializing arbitrary successful responses after the timer had ended.
  Readiness failure diagnostics now bound text and nested cause depth and
  detect cycles/getter failures before retaining them for retry/timeout logs.
- Resolve a repository's advertised remote HEAD before falling back to a
  guessed `main` branch.
- Retain at most the latest one MiB of each SSH command stream while continuing
  to drain the child, preserving trailing structured launch results without
  allowing verbose remote output to grow memory indefinitely. Failure stdout
  and stderr are both credential-redacted and reduced to a short diagnostic.
- Bound SSH config and known-hosts reads before allocation, stop recursive
  includes and glob expansion at finite budgets, and retain at most 4096
  contract-sized discovered hosts. Oversized aliases are ignored before they
  can enter desktop IPC state.
- Keep SSH config, known-hosts, and askpass-helper reads on one opened handle
  through the byte-limit check, including a growth probe so a replaced or
  appended file cannot bypass the ceiling between stat and read. Linked
  worktree `.git` pointers and synchronous pre-ready Electron settings now use
  the same bounded-handle principle rather than a stat/read path race.
- Bound generated remote bootstrap state reads: port markers stop at 64 bytes,
  POSIX and Windows default-runtime JSON stops at 64 KiB, and Windows runner
  metadata stops at one MiB. Windows diagnostics now seek into only the final
  256 KiB of a server log, retain the final 80 lines, and emit at most 64 KiB
  instead of allocating the complete accumulated log.
- Validate remote launch ports with the shared 1-65535 contract, cap decoded
  pairing credentials at 64 KiB, and close managed SSH tunnels eight at a time
  during manager teardown instead of starting an unbounded cleanup fan-out.
- Treat the live T3 runtime file as the ownership check before POSIX or Windows
  SSH cleanup signals a persisted PID. A reused or corrupt state PID is now
  discarded without signalling it; successful launches persist the actual
  verified server PID instead of a package-runner wrapper, while failed-start
  cleanup only signals the PID captured by that same launch invocation.
- Release a cached SSH password after its environment has been disconnected
  and remote cleanup has finished, including failure paths, instead of retaining
  secret-bearing strings for every historical target until desktop shutdown.
- Install browser API CORS as global router middleware using the current Effect
  HTTP API instead of returning the obsolete router value.
- Preserve abort semantics while measuring directory size.
- Bound OpenCode server stdout and stderr diagnostic tails and keep draining
  both streams after readiness, preventing pipe backpressure and unbounded
  diagnostic retention.
- Frame Codex App Server stdout as raw UTF-8 bytes under a 128 MiB per-record
  ceiling instead of repeatedly joining an unterminated string. The incremental
  framer preserves split multibyte text and CRLF, retains one geometric buffer
  rather than one object per provider write, releases exceptional large
  buffers after decode, and terminates the protocol with a typed size error on
  overflow. Current pending requests fail with that same reason; stdout write
  failures now terminate the protocol too, and calls racing or following
  termination cannot enter the pending map and wait forever.
- Apply the same raw-byte framing and 128 MiB compatibility ceiling to the
  shared ACP transport used by Cursor, Grok, and Kimi. An unterminated provider
  line can no longer grow the decoder without bound; overflow, stdin failure,
  clean stdout end, and stdout writer failure now terminate the protocol and
  settle pending extension requests. Calls racing termination fail with the
  same typed reason instead of entering a closed outgoing queue and hanging.
  Raw notifications now use a live pub-sub observer, so the normal callback-only
  server path no longer retains every notification for the session lifetime.
- Bound the ACP and Codex App Server transport queues with lossless producer
  backpressure instead of allowing decoded messages and outgoing requests to
  accumulate without limit. Optional Codex raw request/notification streams
  are now bounded live observers rather than always-retained duplicate queues,
  and ACP buffers at most the newest 256 typed notifications during the short
  handler-registration window. A prematurely completed Codex stdout sink now
  terminates the protocol and releases pending writers instead of silently
  leaving the bounded outgoing queue without a consumer. ACP and Codex schema
  error diagnostics now inspect at most 4096 issue nodes iteratively, so a deep
  or very wide malformed record cannot overflow the reporter's stack while the
  protocol is trying to fail safely.
- Apply the same lossless 512-event backpressure boundary to every canonical
  provider event path: Codex, Claude, Cursor, Grok, Kimi, OpenCode, and the
  shared ACP session runtime. Claude steering retains at most 32 prompts before
  its SDK consumer catches up. Slow ingestion now slows the owning provider
  instead of multiplying full runtime events in server memory.
- Validate Codex user-input questions against the canonical count, option,
  identity, per-field, and aggregate text budgets before registering a pending
  callback. Valid free-form questions no longer disappear for lacking preset
  options; malformed or oversized requests receive an immediate protocol error
  instead of waiting forever on an event no client can decode.
- Fingerprint cumulative ACP plans with two constant-memory rolling hashes
  instead of serializing and retaining another complete plan string. Core ACP
  plans stop at the runtime's 256-step ceiling, and Cursor/xAI extension
  question, option, todo, and phase collections are rejected at the same
  runtime-event limits before mapping or publishing them.
- Normalize ACP session configuration menus before retaining or returning them:
  descriptors and per-descriptor choices stop at 128, aggregate choices at
  2048, and retained text at one MiB using the shared model-capability budgets.
  Oversized ids/values and unknown metadata are discarded, presentation text
  is clipped to its canonical field limits, and first-in-order options are
  preserved. Invalid-value checks scan in place and return a 16-value bounded
  preview instead of `flatMap`-allocating and joining the complete provider
  menu into an error.
- Bound Cursor and xAI private ACP question identifiers, question/option text,
  and Cursor model-discovery lists at the runtime/client contracts before
  mapping. Cursor per-model configuration menus reuse the normalized ACP menu
  boundary; Grok retains at most 128 live effort choices and maps at most 1024
  first-in-order discovered models with bounded ids and labels. Partitioning
  pending xAI prompt completions during cancellation is now linear rather than
  repeatedly spreading growing arrays.
- Replace the provider-maintenance coordinator's permanent per-install-root
  semaphore map with the shared ref-counted keyed lock. Current and waiting
  commands still share one permit, while interruption and the final caller now
  remove the idle entry instead of retaining every historical maintenance key.
- Bound OpenCode cleanup abort calls to five seconds so a stalled external SDK
  endpoint cannot hold session, unexpected-exit, or race-loser teardown open
  forever. OpenCode SDK failures now retain only an 8 KiB structural diagnostic
  and never JSON-serialize an arbitrary response body or invoke its `toJSON`
  hook before truncation. Diagnostic tails now select from the incoming chunk
  before concatenation, and whitespace trimming scans the source before copying,
  so an oversized line is not duplicated just to retain its final 64 KiB or
  first 8 KiB.
- Remove OpenCode's write-only local turn history, which duplicated tool parts
  but was never read for snapshots or rollback. Streaming part/message maps are
  cleared when a turn becomes idle, fails, or is interrupted; an accepted
  interrupt immediately returns the session to ready, while a stale turn id no
  longer aborts either the current turn or an already-idle provider session.
  User-input questions, options, identifiers, titles, permission patterns,
  errors, and resume session ids are normalized at the runtime-contract
  boundary, with answer lookup sharing the same bounded id. Permission details
  are assembled under a fixed scan/character budget, and pending maps retain
  only identifiers plus the bounded question subset they actually need before
  terminal turn states release them. Returned session ids and retry/error text
  are validated or bounded before they enter persistent session state; malformed
  interaction ids and non-array question/answer payloads are ignored without
  terminating the event pump.
- Build Claude's short tool and unknown-message labels from at most eight
  shallow scalar fields under fixed character budgets. Presentation no longer
  JSON-serializes an arbitrary SDK tool payload, calls its `toJSON` hook, or
  materializes every property before truncating the label to 400 characters.
- Bound Claude's Todo/Task plan state, dependency lists, workflow scan, workflow
  fingerprints, task identities, hook diagnostics, and persisted-file reports
  before they enter canonical events. Completed task notifications release
  their retained agent/workflow correlation state, provider task registries
  have finite cardinality, and malformed workflow arrays stop after a fixed
  scan budget rather than traversing an arbitrary SDK payload.
- Normalize Claude user-input questions and options before registering a
  pending callback. Normal question-text ids keep their existing SDK-compatible
  behavior; oversized ids use a bounded client key that is translated back to
  the exact provider question on reply. Malformed, duplicate, or over-budget
  requests are denied immediately instead of poisoning the event stream.
  Terminal-result error classification scans only a finite prefix and retains
  a contract-sized user diagnostic instead of joining an arbitrary SDK array.
  Session, message, resume, and native-log identities must fit the shared entity
  boundary exactly; invalid identities are ignored rather than clipped into
  potentially colliding persisted keys.
- Harden OpenCode process-group cleanup: invalid, broadcast, and synthetic
  targets are rejected; cleanup only signals while the original child is
  still alive, including a second liveness check before escalation so a
  recycled PID cannot target an unrelated process group.
- Bound authenticated browser OTLP trace bodies to 4 MiB, avoid retaining or
  logging rejected trace payloads, log only aggregate span counts, and stop a
  stalled collector forward after ten seconds. Null and non-object JSON bodies
  now produce a safe zero-span diagnostic instead of crashing the request.
- Release outbound HTTP response bodies before rejecting them: OTLP collector
  replies, T3 Connect relay and token replies, pairing probes, usage-rate
  downloads, Bitbucket redirects and declared-oversized JSON, and rejected
  marketplace tarballs now consume at most one chunk and then cancel the unread
  remainder on early exits. Those paths no longer retain a response/socket
  until remote EOF, and their existing request deadlines still bound a peer
  that never sends its first byte.
- Bound trace structure before serialization as well as bytes after it: local
  and OTLP attributes now have finite depth, keys, and collection width; spans
  retain finite attributes/events/links; browser OTLP decoding caps resource,
  scope, and record counts; identifiers, timestamps, status text, and exit
  causes are bounded. Adversarial getters become a stable placeholder, and a
  trace conversion failure can no longer escape `Span.end` into app behavior.
- Bound on-demand trace diagnostics to the newest 32 MiB across the active file
  and rotations, reading newest-first and retaining only complete records when
  a file tail is truncated. Older paths are still opened to distinguish absent
  history from an incomplete result, and the diagnostics UI now reports the
  finite-read warning without falsely claiming every partial result was an I/O
  failure.
- Mirror the trace and process diagnostics producer budgets in their wire
  contracts: paths, detail text, log-level maps, summary/recent arrays, process
  rows, descendant PID lists, commands, statuses, and error messages are all
  finite. Trace metadata is normalized before returning so an extreme config
  path or read error cannot make an otherwise bounded diagnostics RPC fail to
  encode.
- Validate trace file size, rotation count, batch window, and OTLP export
  interval environment values as positive integers before observability starts;
  rotation count is capped at the same 100 files diagnostics can enumerate, so
  a typo cannot create a tight timer or an effectively unbounded rotation loop.
- Disable automatic HTTP request spans for WebSocket-ticket and signed-asset
  routes so bearer capabilities in their query/path cannot be persisted to the
  local trace files or delegated OTLP sink. Ordinary server routes remain
  traced. Signed-asset request logging is disabled too because its capability
  lives in the path even after query stripping.
- Hash relay proof identifiers before using them in replay-guard filenames and
  reject every secret-store name outside the internal URL-safe alphabet before
  filesystem access, closing traversal through signed `jti` and nonce claims.
  Safe legacy guard names are checked alongside hashed names during the upgrade
  window; unsafe claim text is never used as a path.
- Cap each OpenCode CLI stdout/stderr capture at 8 MiB, stop provider probes
  after 30 seconds, and preserve interruption/defects instead of turning
  cancellation into an ordinary failed health check.
- Keep settings-driven provider watchers alive after one provider refresh
  fails, while still propagating interruption. Latest-only provider/settings
  signals now use one-slot sliding channels instead of unbounded queues.
- Cap individual provider NDJSON records at the strictest configured byte
  ceiling and evict inactive stream sinks during retention passes so old files
  are no longer permanently exempt from reclamation.
- Bound Codex and Claude text-generation process streams and retain
  ACP/OpenCode streamed text in byte-bounded chunk buffers instead of repeated
  whole-string concatenation. Codex's structured output is now read through
  one handle with a one-MiB ceiling, so concurrent file growth cannot bypass a
  prior size check. Every provider rejects oversized structured output, and
  CLI failure details are reduced to a four-thousand-character diagnostic.
- Read canvas workspace images through a same-handle ten-MiB-plus-one probe
  before base64 conversion, so a huge file with an image extension is rejected
  without first being fully allocated.
- Validate inline canvas images as canonical base64 capped at 14 million
  characters and ten MiB decoded before any image-byte allocation. Canvas
  origin metadata, state/event collections, selection lists, diagnostics, and
  agent image paths now compose within the existing 1024-node/256-op document
  limits instead of reopening unbounded derived wire surfaces.
- Preserve cancellation of the initial HTTP configuration fetch instead of
  starting a WebSocket fallback during teardown, and cap relay status fan-out
  at six concurrent environments.
- Bound persisted connection targets, profiles, credentials, and remote DPoP
  tokens to 1024 records per kind. Connection labels, identifiers, URLs,
  secrets, thumbprints, and token expiry values now have finite shared-runtime
  schemas before browser, desktop, or mobile storage encodes them.
- Bound every shared entity identifier and ISO timestamp, desktop-backend
  bootstrap path/host/token/telemetry URL, relay-client status field, and
  marketplace-list response. Persisted connection credentials now reuse the
  same finite connection-ID schema as targets and profiles.
- Bound preview wire titles, URLs, diagnostics, process/host metadata, server
  epochs, rendered viewport edges and pixel area before clients retain them.
  Shared connection errors now truncate remote detail and trace identifiers in
  their constructors, so typed failures cannot keep an arbitrarily large
  response alive after the request settles.
- Bound background-activity cwd scopes, network labels, per-report scope count
  and aggregate key characters, TTLs, lease snapshots, and active-scope keys at
  the shared contract. The server now shares the 1-120 second lease policy and
  retains at most 256 active leases globally in addition to its existing
  16-per-RPC-client churn guard.
- Bound storage-inventory paths, titles, branches, display names, error
  diagnostics, collection counts, and aggregate string characters at the wire
  contract. Filesystem browse responses now share the canonical project-path
  ceiling, cap entry names and result counts, retain the producer's truthful
  truncation bit across rolling upgrades, and bound structured error fields.
- Reject lifecycle-outbox JSON beyond 16 MiB before parsing or after encoding,
  retain at most 65,536 queued entries, and bound its timestamps and identifiers.
  Bearer descriptor caching now removes expired entries and evicts oldest
  entries beyond 1024 rather than retaining every contacted environment.
- Cap opaque thread-detail page cursors at 4096 characters on both request and
  response contracts, with the same preflight in the server decoder, so
  malformed input is rejected before base64 and JSON allocation at the
  keyset-pagination boundary.
- Bound editor launch paths and project search requests/results at their wire
  contracts. Content search now clips a long source line around its first
  match, remaps and caps ranges, rejects oversized paths, and stops at finite
  per-result and aggregate line/path/range budgets while truthfully reporting
  truncation.
- Make the complete turn-start command envelope finite: user text now shares
  the provider's 120,000-character ceiling, both attachment forms stop at
  eight items, and title, branch, path, proposed-plan, and aggregate skill-ID
  metadata have explicit limits. Inline images must carry MIME-matching,
  canonical base64 whose decoded size fits the ten-MiB image contract; the
  validator scans iteratively rather than running a regex across multi-megabyte
  payloads, and compact ASCII data URLs keep the 128-MiB WebSocket budget
  calculable.
- Bound shared remote-pairing URLs, backend hosts, credentials, and labels
  before trimming, URL normalization, or hash-parameter propagation. The web
  hosted-pairing reader now delegates to that shared implementation instead of
  maintaining a second unbounded parser, and token stripping drops an
  oversized hash rather than accidentally retaining it.
- Bound relay configuration, link, token-exchange, discovery, health, mint,
  device, activity, and delivery schemas using canonical credential, subject,
  proof-thumbprint, OAuth-scope, secure-URL, timestamp, and diagnostic ceilings.
  Relay bearer and DPoP HTTP headers now have scheme-compatible finite limits,
  and environment HTTP errors, link state, and runtime status no longer expose
  unbounded strings or unknown response payloads.
- Reject oversized relay JWTs, DPoP proofs and claims, Clerk publishable keys,
  and pasted Connect authorization blobs before base64 or JSON decoding. P-256
  JWK coordinates and decoded Clerk hostnames now have protocol-sized ceilings,
  and malformed errors retain only bounded diagnostics.
- Read at most one MiB from server settings and refuse to write a sparse
  settings document beyond the same UTF-8 byte ceiling. Full settings and
  patch contracts now share finite limits for provider instances, custom
  models, paths, URLs, launch arguments, secrets, model options, global and
  per-thread skill selections, marketplace sources, and subagent model pins,
  so an oversized remote patch is rejected before it is merged or broadcast.
- Isolate thread-lifecycle outbox drains per environment so one stalled remote
  cannot block every other environment. Persistence mutation locks are keyed
  the same way, so one stalled initial store read cannot block other
  environments. Initial durable loads are serialized with same-environment
  enqueues, transient load failures remain retryable, and later successful loads
  merge disk and memory instead of overwriting commands created during recovery.
- Preserve cancellation through shell and thread HTTP snapshot loaders instead
  of treating teardown as a socket-fallback opportunity. Flush the latest shell
  snapshot when its scope closes, covering hidden-document debounce and cache
  eviction; the finalizer first interrupts every producer and the prior writer
  so an older save cannot land after the final value.
- Coalesce relay-discovery wakeups into one trailing refresh, keep connectivity
  publication independent of a slow sweep, and prune fingerprints for deleted
  environments. Bound registry metadata loads, startup work, relay removal,
  and scope teardown to eight concurrent environments.
- Stream marketplace tarball downloads into a byte-counted 64 MiB collector,
  cancel immediately at the cap, apply the 30-second deadline to both headers
  and the full body, and limit multi-source refresh fan-out to four.
- Add opt-in early cancellation to the byte-bounded stream collector. Process
  pipes retain their existing drain-after-cap behavior, while HTTP callers can
  now stop downloading discarded bytes as soon as the retained prefix is full.
- Align full project-list responses with the server index ceiling: at most
  25,000 entries and 16 MiB of aggregate path text cross the wire. The server
  truncates at either budget, while newer web/mobile decoders reject an older
  or hostile host's unbounded listing before building and sorting its client
  file-tree index.
- Bound Bitbucket calls end to end: 30-second deadlines include redirects and
  body reads, JSON/error/diff responses stop at 8 MiB, request and pull-request
  body inputs stop at 1 MiB, and detail pagination fails after 20 pages rather
  than following a hostile cursor forever. Authenticated request, response,
  and decode failures now retain only payload-free diagnostic causes.
- Bound T3 Connect OAuth token responses to 64 KiB and 30 seconds, cancel the
  response at the cap, and replace request/schema failures that could retain
  authorization codes, refresh tokens, or newly issued tokens with stable
  secret-free reasons.
- Serialize telemetry flushes, hard-cap configured batches and buffers, drain
  responses under a ten-second request deadline, use exponential failure
  backoff up to one minute, and bound shutdown flushing to two seconds. Failed
  requeues remain capped and authenticated payloads are no longer logged.
- Stream cloudflared downloads under a 128 MiB ceiling and five-minute
  deadline before checksum verification; declared-oversized and non-success
  responses explicitly release their HTTP bodies, streamed overflows cancel
  early, and download failures no longer retain custom signed asset URLs in
  diagnostics.
- Require signed asset URLs resolved by web and mobile to retain the selected
  environment's origin. A malformed or hostile `relativeUrl` containing a
  network-path or absolute off-origin URL can no longer redirect asset traffic
  to an unrelated host.
- Retain at most 64 KiB from any one cloudflared diagnostic line while
  continuing to drain later bytes and lines. Truncated raw output is omitted
  rather than partially redacted, so a connector cannot grow the split-line
  buffer indefinitely or expose a credential fragment cut at the cap.
- Keep the cloudflared exit supervisor in the managed-endpoint runtime scope,
  outside the connector scope it closes during restart. A naturally exited
  connector can now release its child and output observer before reconciling a
  replacement instead of interrupting the supervisor responsible for that
  reconciliation and leaving the desired tunnel stranded.
- Bound relay agent-activity publishes to 15 seconds and relay unlink responses
  to 64 KiB/15 seconds. Relay diagnostics now show at most the origin and omit
  authenticated HTTP causes, while the unlink decoder cannot retain bearer
  tokens or response bodies.
- Keep managed-environment health and credential-mint requests inside the
  relay's outer request deadline. Their eight-second operation timeout now has
  one second to return the typed offline/timeout result before the nine-second
  request envelope emits a generic 504. Responses are buffered through a
  64 KiB byte-counted stream inside that same deadline; declared or chunked
  overflow cancels the unread Fetch body and becomes the existing typed
  request failure before the generated client can call unbounded
  `Response.text()`.
- Order device and Live Activity target reads by recent registration and cap
  them at the existing 128-device wire contract. Publish diagnostics are
  accumulated only to that same boundary while all selected users still
  receive their delivery work, rather than flattening the full fan-out before
  slicing. Stale database rows can no longer turn an otherwise successful list
  or activity publish into a response-encoding failure or a history-sized
  transient result allocation.
- Order linked-environment listings by recent activity and cap them at the
  existing 1,024-environment response contract, preventing stale retained links
  from making the entire Settings/Connect listing unencodable.
- Limit per-user agent-activity reads and per-thread fallback scans to the
  existing 128-row activity contract. Aggregation already displays five rows;
  this prevents abandoned database history from turning each publish or mobile
  snapshot into an unbounded decode pass.
- Extend the activity-row maintenance sweep beyond recent terminal rows: any
  activity untouched for 30 days is now removed regardless of phase. Running
  or waiting rows from an environment that disappeared were already hidden
  after their display TTL but previously remained in PostgreSQL forever; a
  returning environment recreates the row on its next publish.
- Index delivery-attempt timestamps and prune records older than 30 days from
  the relay maintenance cron. Signed delivery jobs expire after ten minutes,
  so the retained month remains diagnostic history rather than replay state and
  the APNs audit table no longer grows for the life of the deployment.
- Index credential revocation timestamps and prune relay environment
  credentials 30 days after revocation. Active rows are excluded by the SQL
  predicate; repeated rotation or relinking no longer retains unusable token
  hashes and public-key copies for the lifetime of the deployment.
- Bound signed APNs queue jobs to 64 KiB and constrain their identifiers,
  routing fields, tokens, timestamps, notification copy, deep links, and
  signatures before verification. Queue input can no longer pass structural
  decoding only to overflow the relay's indexed persistence columns or retain
  a platform-sized nested payload during signature verification. Producers
  sanitize Live Activity alert copy and validate the complete signed envelope
  before calling the queue sender, so a future oversized field regression
  fails locally instead of creating a permanently undecodable queued job.
- Acknowledge or retry each APNs queue message explicitly before Alchemy's
  batch-level acknowledgement runs. Processing now continues after a poison
  job, successful neighbors remain acknowledged, and only the failed message
  consumes retries or reaches the dead-letter queue; the ten-message batching
  and configured retry delay remain intact.
- Bound relay schema-error trace enrichment to 32 top-level attributes,
  1,024-character strings, and 16 same-type primitive array entries. Arbitrary
  defect causes are no longer schema-encoded, recursively flattened, or sent
  to Axiom, preventing a database/upstream error from invoking payload
  serialization hooks, overflowing recursive traversal, or creating an
  unbounded high-cardinality span.
- Shorten unfinished APNs source-job claims to two minutes, inside the queue's
  five 30-second retries and the signed job's ten-minute lifetime. An
  interrupted consumer can now reclaim work before dead-lettering instead of
  remaining in flight until the job expires; ambiguous APNs delivery retry
  semantics remain deferred below. External `apns-id` response headers are
  clipped to the audit table's 128-character diagnostic column.
- Read APNs response bodies through an 8 KiB byte-counted stream and cancel at
  overflow instead of materializing arbitrary response text. Normal Apple error
  JSON remains intact; oversized proxy/upstream replies become the existing
  typed read-response failure and never enter delivery diagnostics.
- Clip upstream APNs reason text and `apns-id` headers to the relay response
  contract before returning or retaining them. A bounded-but-nonstandard APNs
  or proxy response can no longer make an otherwise valid publish result fail
  response encoding. The delivery-attempt persistence boundary independently
  clips APNs reasons and transport errors to 4 KiB and APNs ids to the backing
  128-character column, so direct or future callers cannot retain arbitrary
  diagnostics either. Fail-open delivery-time state rechecks now attach only
  redacted causes to queue warnings instead of logging raw database defects.
- Align relay-specific cloud-user, environment, thread, device, app-version,
  bundle, managed-resource, and timestamp schemas with the PostgreSQL columns
  that persist them. The auth boundary now rejects an oversized Clerk/DPoP
  subject before it becomes a principal, so a schema-valid request can no
  longer fail later as a database-width error. Environment labels are trimmed
  and capped both on write and on legacy-row reads so list responses remain
  encodable.
- Cap reported iOS major versions at a future-safe product ceiling before they
  reach PostgreSQL's signed integer column, and require relay timestamps to be
  canonical UTC ISO strings. Environment-signed activity can no longer persist
  a lexically future invalid timestamp that sorts ahead of real activity and
  evades age-based cleanup indefinitely.
- Hash relay replay identifiers only when they exceed the PostgreSQL key
  columns, preserving deterministic replay detection without rejecting a
  standards-valid proof or surfacing a width error. This applies at the replay
  service boundary to both JWT IDs and caller-defined namespaces, so the
  environment-link path no longer attempts to persist a raw public key in the
  128-character thumbprint column.
- Keep every Live Activity and notification payload within APNs' 4 KiB byte
  ceiling. Live Activity builders retain the full aggregate when possible,
  then drop trailing rows, preserve a compact first row, or finally retain only
  the aggregate count for pathological content. Notifications retain routing
  metadata unless even compact metadata cannot fit, and every outbound APNs
  request has a final byte validation before signing or network I/O. One
  15-second deadline covers both the APNs request and its bounded response-body
  read, so a stalled peer cannot pin a delivery worker indefinitely.
- Bound warm-isolate APNs provider-token and parsed signing-scalar caches to the
  eight most recently used keys. Scalar cache keys are now full fingerprints
  rather than raw private-key PEM strings, and evicted/reset scalar bytes are
  overwritten before release, so key rotation no longer retains every historic
  credential for the isolate lifetime.
- Order agent-awareness link-user reads by recent activity and cap both generic
  and public-key-qualified fan-out queries at 1,024 users. Per-user target reads
  and returned diagnostics were already capped; this closes the remaining
  unbounded database allocation before publish fan-out begins.
- Remove the unused generic-user and environment-public-key listing services,
  persistence branch, queries, and test-mock surface. Agent-awareness uses the
  bounded delivery-user query, while connector authorization verifies the
  linked user's exact key directly; the dead methods instead selected broad
  environment rows and, for keys, built an unbounded JavaScript set with no
  production caller.
- Validate and canonicalize the relay API zone, managed-endpoint zone, and
  optional public-domain override as DNS names during deployment configuration.
  Managed-endpoint URL construction now validates both fresh and persisted
  hostnames, so whitespace-only, path-bearing, empty-label, or overlong values
  fail before Cloudflare resources or client-facing HTTP/WebSocket origins are
  derived from malformed configuration.
- Query managed-endpoint DNS records with Cloudflare's exact-name automation
  filter instead of its intentionally unspecified human `search` parameter,
  and request/retain at most 100 matching DNS records or tunnels. A large zone
  can no longer hide the existing exact record behind unrelated search hits
  and send provisioning into a duplicate-create recovery loop. Nested provider
  not-found inspection is iterative, cycle-safe, getter-safe, and stops after
  16 causes rather than recursively walking an arbitrary SDK error graph.
- Delete the unreachable web client-tracing runtime. It had no imports or
  callers but retained a second OTLP runtime, mutable scope/generation state,
  and one-second export-loop configuration that could only drift from the
  tracing path the application actually wires.
- Bound authenticated relay link/reconcile responses to one MiB and their full
  request lifetimes to 15 seconds. Declared oversized bodies fail before a
  read; otherwise the collector cancels at the cap, validates UTF-8 before JSON
  decoding, and returns stable diagnostics rather than retaining or reflecting
  credential-bearing HTTP failures. Shutdown tunnel deletion uses the same
  bounded response path and deadline, keeps the stored connector token after a
  bounded-read failure, and has a focused regression test (authored but not run
  during the static-only safety pass).
- Apply the pairing probe's 2.5-second deadline to its full 64 KiB descriptor
  read, not only response headers, and cap the downloaded LiteLLM pricing table
  at 16 MiB inside its existing ten-second refresh deadline. Provider-update
  npm metadata is likewise capped at 64 KiB inside its four-second deadline.
  Analytics batch requests now release the response after at most one chunk
  instead of draining an arbitrary upstream body inside their deadline.
- Mirror the native resource monitor's finite protocol boundaries in the shared
  schemas: external roots, process arrays and strings, request/error text, and
  32-snapshot history chunks are all capped before entering server state. The
  receiver serializes history reads, includes semaphore wait and command write
  in the 15-second deadline, and rejects cumulative history above 3600
  snapshots or 20,000 retained entries; sample-now deadlines now cover command
  writes too.
- Stream public static, Brotli, and SPA fallback files instead of allocating a
  whole `Uint8Array` per request, while preserving cache, encoding, content
  type, fallback, and HEAD semantics.
- Enforce the existing client contract of at most eight turn attachments at the
  wire schema boundary, so non-UI callers cannot send an unbounded attachment
  array.
- Reserve pairing-link scopes inside the same atomic consume operation, so a
  request for unauthorized scopes cannot burn a valid one-time grant. Seeded
  and persistent grants now share the same subset check before decrement.
- Record an accepted DPoP proof and schedule its expiry as one uninterruptible
  commit, retaining the `jti` for the full replay window even when the token
  exchange or protected operation later fails. WebSocket cookie fallback now
  accepts only absent native origins, the server's normalized same origin, or
  the two T3 desktop schemes; cross-origin browser cookies cannot open a socket.
- Cap environment authorization scope arrays at the complete eight-scope
  vocabulary, preventing duplicate-heavy wire or persisted values from growing
  without changing any valid permission set.
- Bound authentication credentials, identifiers, subjects, OAuth scopes, and
  client presentation metadata at the wire and persistence schemas. Request
  metadata is truncated before storage, compact session tokens must have
  exactly two segments and fit the credential budget, and oversized bootstrap
  credentials are rejected before database lookup.
- Reject fractional sidebar-settlement settings, non-finite or out-of-policy
  background-activity durations, negative auth stream revisions and token
  lifetimes, negative relay JWT timestamps, and negative authorization
  revocation/relay status counters at the canonical schemas. Auth and
  authorization error constructors now retain only bounded diagnostics instead
  of creating values their own wire codecs reject.
- Limit active pairing-link and client-session queries to 1025 rows and fail
  explicitly above the 1024-entry response/snapshot contract instead of
  materializing or silently truncating an unbounded credential list. Publishing
  bulk session removals now uses 16 workers instead of one fiber per session.
- Acquire both auth change subscriptions before loading the access snapshot, so
  pairing and client-session mutations during snapshot I/O are buffered and
  replayed instead of leaving the management UI stale until reconnect.
- Generation-fence relay access-token acquisition against cache reset and hold
  the persistent clear inside the same cache critical section, preventing a
  sign-out race from saving an old account token back to memory or SecureStore.
- Add monotonic UTF-16 terminal-buffer offsets and a buffer generation to the
  shared client runtime. Web and mobile can now append the exact suffix across
  the 512 KiB rollover boundary and reset only after a true overrun or terminal
  restart.
- Bound terminal thread/session identifiers, cwd/worktree paths, environment
  maps, labels, timestamps, PIDs, sequences, history, output chunks, and error
  text at the shared wire schema. The server splits oversized PTY output on a
  surrogate-safe boundary before publication and normalizes labels/errors to
  the same limits, so one provider-sized write cannot poison every attached
  client.
- Serialize client terminal writes per environment/thread/session across web
  and mobile so asynchronous RPC settlement cannot reorder keystrokes or paste
  data. Inputs above the 65,536-character wire ceiling are split inside that
  same FIFO command, without separating UTF-16 surrogate pairs, so a large
  paste is delivered in order instead of failing schema encoding wholesale.
- Enforce one MiB workspace-file read and write ceilings in both the wire
  contract and server, reject UTF-8 writes by encoded byte length, and resolve
  existing parents and targets canonically before writing so stable symlink
  escapes cannot leave the workspace. Directory browsing now stops after 200
  matching entries and reports that the result was truncated instead of
  materializing an arbitrarily large directory. Preview reads now fill through
  short OS reads, probe growth on the same descriptor, and report the final
  descriptor size instead of presenting an incomplete prefix as a complete
  file.
- Bound workspace content-search paths, per-line excerpts, match ranges,
  fallback diagnostics, result counts, and aggregate line/path/range budgets.
  Oversized source lines retain a 64 KiB window around the real match and
  remap highlight offsets; UTF-8 byte offsets are converted in one string pass
  without allocating and decoding a new prefix for every range. Budget
  exhaustion returns `truncated: true` instead of building a response its own
  WebSocket schema refuses.
- Bound instruction and skill documents, frontmatter, metadata, marketplace
  caches, tarball bytes, archive entries, and marketplace refresh concurrency.
  A shared bounded reader avoids allocating the remainder of oversized files;
  materialized skill documents and ownership markers now use its same-handle
  limit check so concurrent growth cannot turn a bounded read into a trusted
  truncated document or allocate a hostile marker. Installed-skill enumeration
  now stops at the shared 4096-item wire ceiling, so an oversized store cannot
  produce a snapshot that its own RPC contract refuses to encode.
- Retain at most one MiB of terminal history, restore only a four MiB persisted
  tail, and cap server trace diagnostic records, strings, recent lists,
  distinct aggregates, log levels, and rotated-file enumeration. Diagnostic
  log-level counting now treats keys such as `__proto__` as data rather than
  inherited object properties.
- Bound `t3.json`, project VCS configuration, favicon-source inspection, and
  favicon hashing reads. Oversized project configuration now falls back safely
  without first loading the full file.
- Align Bun and Node WebSocket inbound frames at a finite 128 MiB and make Bun
  close a peer that exceeds the same backpressure ceiling. The ceiling now
  accommodates eight compact maximum-size image data URLs, a worst-case
  JSON-escaped 120,000-character prompt, all other bounded turn metadata, and
  roughly 4.5 MiB of remaining transport headroom; the previous 16 MiB limit
  rejected valid multi-image turns. Bound startup
  commands at 256, preview-automation requests at 64 per client, and inactive
  canvas state at 128 threads.
- Apply that same 128 MiB ceiling while Node collects HTTP request bodies and
  at Bun's listener, before HttpApi schema decoding. HTTP orchestration dispatch
  accepts the same maximum turn envelope, while chunked requests that omit
  `Content-Length` can no longer grow without bound.
- Give `/mcp` a tighter 16 MiB cross-runtime reader and a clear 413 response.
  The largest T3 tool request is a canonical 14,000,000-character Canvas image,
  leaving 2,777,216 bytes for its JSON-RPC envelope and other bounded fields;
  preview screenshots are responses and do not consume this inbound budget.
  Generic MCP request IDs and capability metadata remain spec-open, so this is
  an explicit transport policy rather than a universal schema-derived maximum.
- Reject bootstrap FD records above 64 KiB before Node readline can retain an
  unterminated line, and reject MCP bearer tokens above 128 characters before
  UTF-8 allocation and SHA-256 hashing. Desktop-host telemetry now scans byte
  chunks before NDJSON framing and fails a record above 4 MiB, preventing an
  invalid host stream from growing the server decoder without limit.
- Serialize provider start, persisted-session recovery, and stop lifecycles per
  thread across MCP credential preparation and adapter startup. Concurrent
  restarts can no longer revoke or overwrite the credential an earlier adapter
  is still consuming, and credential issuance now atomically replaces the
  thread's prior token instead of exposing a revoke-then-issue race. Idle
  lifecycle-lock entries are released after the last waiter.
- Replace Cursor, Kimi, and Grok's permanent per-thread semaphore registries
  with ref-counted keyed locks that delete idle entries without splitting
  exclusion between current and queued users. Approval and question callbacks
  register before publishing their request, then remove pending entries on
  every success, cancellation, interruption, or publication-failure path.
- Keep Kimi's ACP notification consumer in the session scope so it survives
  the request fiber that started the session, matching Cursor and Grok.
  Claude permission callbacks now handle already-aborted signals and detach
  their abort listeners after normal, cancelled, or interrupted settlement.
- Remove all OpenCode part, emitted-text, and completion state when its owning
  message is removed. Codex now forgets terminal child-agent registry and
  receiver-turn entries and retains at most 65,536 characters for an
  incomplete or completed stderr fragment.
- Read Codex, Claude, Cursor, Kimi, and Grok attachment files only through the
  contract's 10 MiB image ceiling plus one detection byte, rejecting a file
  that grew or was replaced after its metadata was accepted instead of
  allocating and base64-encoding it in full.
- Bound provider-runtime plan steps, user-input questions and options, opaque
  usage/answer maps, workflow phases, tool references, authentication output,
  and file-persistence reports at the canonical event schema. User-input
  response maps and project-script update arrays now have finite command
  limits too, while script identifiers, names, commands, and preview URLs are
  bounded before they enter project events or the database. Provider cost and
  elapsed-time values must also be finite, nonnegative, safe numbers; Claude
  omits invalid SDK values before constructing the event.
- Give approval args, resolutions, and user-input answers a cycle-safe JSON
  budget covering depth, node count, key count, and aggregate string text.
  Request details and decisions share finite diagnostic limits; the central
  provider service truncates those presentation fields and replaces an
  oversized opaque payload with an explicit truncation marker before logging,
  persistence, or publication.
- Bound provider-session cwd, model, title, and error fields, normalize errors
  at the Claude, OpenCode, and Codex-session producers, and ignore an invalid
  oversized legacy cwd during persisted-session recovery instead of reviving
  it into a new provider process.
- Bound persisted/synchronized scenery photo identifiers, descriptions,
  colors, photographer text, and URL strings at the orchestration wire schema.
  This complements the web client's same-origin Unsplash authorization guard:
  old valid URLs remain readable, while an arbitrary-size URL cannot poison a
  snapshot or settings surface.
- Limit review previews to the first 32 untracked files and 120,000 retained
  characters across their patches. Git may report tens of thousands of tiny
  paths within its existing output-byte ceiling; previously the server could
  launch a diff for every path and retain up to 80 KiB for each result before
  joining them, turning one review refresh into gigabytes of work.
- Recheck working-tree review expansion through a one-MiB-plus-one bounded
  handle read after canonical/type validation, closing the stat/read growth
  race that could otherwise allocate an arbitrarily enlarged diff file.
- Carry the review producer ceilings into the shared RPC contract: repository
  paths and refs, the two preview sources, retained patch text, hashes/titles,
  and both one-MiB expanded file bodies now have explicit decode limits. An
  oversized or incompatible peer response can no longer enter client review
  state merely because the local producer normally emits bounded values.
- Bound VCS remote snapshots to 256 contract-sized names and URLs. The Git
  producer now preserves the first valid remotes, reports truncation when its
  64-KiB command capture or result budget is exhausted, and discards oversized
  optional push URLs instead of producing a response its own wire schema cannot
  encode.
- Make Git ref pagination's 200-row ceiling symmetric across decoded requests,
  direct internal calls, and encoded results. Stacked-action file selections
  and the fixed four-phase progress event now also carry explicit collection
  budgets instead of relying only on the WebSocket frame limit.
- Cap the fixed source-control discovery snapshot at 16 VCS drivers and 16
  hosting providers. Today the producers emit only two and four respectively;
  the wire contract no longer accepts an arbitrary peer-authored collection.
- Include the already-implemented SSH remote-open target discovery in server
  config snapshots, with editor and target collection caps, DNS-sized host
  validation, a five-second fallback, and concurrent editor/SSH discovery.
  Web clients can now receive the tailnet or mDNS target their remote-editor
  resolver was already built to consume.
- Read Git Trace2 hook events incrementally from one scoped file handle instead
  of rereading the complete growing trace file after every filesystem event.
  Partial UTF-8 sequences survive chunk boundaries, concurrent notifications
  are serialized, and an unterminated trace record cannot retain more than one
  MiB while later valid records continue to be processed.
- Keep only the 256 most recently used pull-request host identities, drop
  expired entries on access, and refresh LRU order on a cache hit so repository
  churn cannot grow the signed-in-viewer cache for the lifetime of the server.
  Pull-request label matching now uses a set instead of repeatedly scanning the
  same row labels for every requested label filter.
- Bound environment labels and versions plus repository-identity remote names,
  URLs, canonical keys, paths, and display metadata at the shared wire schema.
  Repository discovery retains at most 256 remotes and discards oversized
  entries before redaction and normalization; friendly host-label probes retain
  only a contract-sized prefix while continuing to drain their output.
- Parse workspace-file listings in one pass and stop at 100,000 paths while
  setting the existing `truncated` flag. The prior split/filter pipeline could
  allocate millions of tiny strings from a valid 16 MiB `git ls-files` result
  before clients had any chance to narrow the list.
- List persisted provider-session bindings with the directory's existing bulk
  query instead of first listing every thread ID and then issuing one query per
  row. Corrupt-list recovery retains the prior best-effort per-row fallback,
  now at bounded concurrency, so the normal path removes the N+1 database work
  without making a damaged legacy row take down active-session discovery.
- Bound provider-registry cache reads, snapshot hydration, persistence, startup
  reconciliation, manual refreshes, and post-update verification to small
  worker pools. A settings file may define up to 128 instances, but registry
  startup or Refresh Providers no longer launches filesystem, CLI, and network
  work for all of them simultaneously.
- Retain at most 512 recently updated repository status snapshots and refresh
  recency when an existing repository changes, preventing VCS reads across
  abandoned workspaces from growing the server cache for its full lifetime.
  Background-policy checks for multi-device VCS demand now use eight workers
  instead of launching every check simultaneously.
- Bound the GitHub CLI cooldown, shared source-control rate-limit generations,
  and GraphQL quota snapshots to small LRU host sets, normalize host keys to the
  DNS ceiling, delete expired cooldowns, and prune expired GraphQL windows.
  One-off Enterprise remotes no longer leave quota/tombstone keys resident for
  the full server lifetime while active hosts retain their cooldown behavior.
- Own pull-request stale-while-revalidate refresh fibers with the service
  scope. A caller can still receive a stale cached answer immediately, but
  layer teardown now interrupts and awaits any slow forge refresh instead of
  letting it mutate an obsolete cache after the service has been replaced.
- Release terminal thread locks after the final active or queued caller, using
  the same ref-counted keyed lock as provider adapters so thousands of old
  thread IDs no longer leave semaphores resident forever. Subprocess polling
  and terminal shutdown cleanup now use eight workers instead of fanning out
  across every open session simultaneously.
- Coalesce queued relay agent-awareness publications per thread so a slow
  network cannot accumulate every intermediate domain event for the same
  conversation. Retain only the 4096 most recently published thread-state
  identities for deduplication instead of every thread seen since startup.
  Five-second confirmation timers now belong to the relay service scope, and
  both the publisher and shared keyed worker preserve owner-scope interruption
  instead of converting shutdown into an ordinary failed publish.
- Attach checkpoint and per-connection background VCS refreshes to their owner
  scopes, so server or connection teardown interrupts the remaining refresh
  rather than leaving a detached fiber behind. Real refresh failures remain
  diagnostic warnings while interruption keeps its lifecycle meaning.
- Acquire keybinding, provider, settings, pairing-link, and session change
  subscriptions before their corresponding snapshots. Lifecycle snapshot and
  subscription acquisition is now one serialized operation, and lifecycle
  publication is ordered through the same lock, closing the startup window
  where a mutation could be missing from both snapshot and live events.
  Keybinding changes use a one-slot latest-only channel because every event is
  already a complete current snapshot.
- Add a shared complete-file byte guard and apply it to keybindings, provider
  status snapshots, server runtime/environment identity, observability startup
  settings, telemetry identity sources, Linux machine metadata, and usage
  pricing/scan caches. Oversized cache writes are skipped rather than creating
  state the next process refuses to read, while required identity/runtime files
  fail explicitly instead of allocating an arbitrary local file in full.
- Reject non-finite, fractional, or unsafe rotating-log byte/file limits before
  they can disable rotation or create a non-terminating suffix loop. Startup
  pruning now streams directory entries through an opened directory handle
  instead of materializing every sibling in the log directory.
- Serialize usage scans so concurrent web/mobile refreshes cannot duplicate a
  multi-gigabyte transcript walk or race the shared scan map's pruning and
  dirty flag. Pricing and scan-cache replacements now use atomic same-directory
  renames, so a crash cannot leave a partially written cache for the next
  process.
- Replace Usage's unbounded Node readline buffer with a 16 MiB byte-framed JSONL
  reader. It discards only the oversized record, resumes at the next newline,
  avoids caching a partial parse, and reports oversized records or unreadable
  files as a partial source instead of presenting incomplete totals as exact.
- Stream transcript directory discovery and bound it to 50,000 files, 20,000
  directories, and 500,000 entries. Newest files are scanned first; individual
  files stop at 512 MiB, each provider stops at 4 GiB or 200,000 records, and
  the in-memory scan cache retains at most 500,000 records. Every ceiling is an
  explicit partial source, incomplete walks cannot prune unseen warm entries,
  changed files release stale cached records, and provider-controlled usage
  identifiers/token fields are bounded before entering cache and aggregation.
- Treat the persisted usage scan cache as an independent trust boundary rather
  than assuming every record was produced by the current parser. Hydration now
  bounds empty-file entries as well as records, rejects oversized intern tables
  and identifiers, validates token/cost ranges and row indices, and cold-scans
  instead of retaining a truncated prefix. This prevents an old or corrupted
  cache from expanding a byte-bounded JSON document into unbounded maps or
  poisoned aggregate state; cache admission applies the same file/record caps.
- Bound the usage aggregate itself to 4,096 buckets, 50,000 dedupe identities,
  and 50,000 bucket-session memberships per provider, plus 50,000 distinct
  source sessions. Matching wire limits cap summary buckets, sources, model and
  path identifiers, time zones, timestamps, diagnostics, and finite costs.
  Capacity loss now marks that provider source partial instead of silently
  presenting incomplete totals as exact. Dedupe identities are provider-scoped,
  and out-of-window copies no longer consume the dedupe budget or suppress a
  later in-window record. Untrusted pricing rejects negative rates, overflowing
  arithmetic degrades to unpriced usage, and cache savings never go negative.
- Limit the web/mobile usage fan-in to 32 connected environments so a fleet
  cannot multiply each bounded summary into an unbounded query and merge burst;
  both clients explicitly report how many environments were not queried. The
  shared merge applies the same defensive limit, bounds coverage diagnostics,
  uses collision-free source fingerprints, refuses to guess equivalence when
  filesystem identity is unavailable, and prefers a complete duplicate scan
  over a lower-id partial one. Selected partial/failed source messages now reach
  both usage UIs instead of incomplete transcript totals appearing exact.
  Wire summaries require at most one source per provider because buckets carry
  provider attribution, not a finer source identifier.
- Enforce a one-MiB ceiling for every filesystem-backed server secret on both
  reads and writes. Existing values are read through the same opened handle
  with one detection byte, so sparse or concurrently enlarged files fail with
  a typed error instead of being allocated in full or accepted after a size
  race. Random-secret creation validates the requested count before asking the
  crypto provider to allocate bytes, including non-integer and unsafe values.
- Continue bounded reads from the same opened handle after the initial stat so
  a concurrently growing file cannot be mistaken for a complete document.
  Apply the guard to systemd unit, pinned-runtime sentinel, launcher source,
  and service-state reads; the standalone launcher independently rejects state
  above 64 KiB before JSON parsing, including during recovery.
- Fill workflow-script prefixes across short OS reads and probe one extra byte
  on the same open descriptor, so a concurrent append cannot make a partial
  script look complete at the existing 256 KiB ceiling.
- Retain at most one MiB from each generic provider probe stream while still
  draining the child, closing the remaining unbounded stdout/stderr path used
  by Claude, Cursor, Grok, and Kimi availability checks. Cursor channel config
  reads are capped, and Claude skill discovery now reads only a bounded
  frontmatter prefix, limits candidates and retained skills, and bounds
  metadata before it enters provider snapshots.
- Bound provider snapshot counts for instances, models, slash commands, and
  skills, along with every provider-supplied label, path, diagnostic, auth,
  version, and timestamp field. The central snapshot builder truncates and
  slices dynamic CLI discovery results to those same limits before a hostile
  provider response can poison persistence or fail server-to-client encoding.
- Replace recursive provider authentication discovery with a cycle-safe,
  iterative 4096-node traversal. Deep or cyclic JSON from a provider can no
  longer overflow the server stack or make the auth probe walk indefinitely.
- Normalize dynamic provider select/boolean option descriptors at their
  canonical count and string budgets, including choice and prompt-injection
  arrays, so CLI-discovered capabilities cannot create a snapshot the shared
  model contract then rejects. Model capabilities additionally cap aggregate
  choice/text volume and reject duplicate descriptor or per-descriptor choice
  identifiers, preventing individually valid option arrays from multiplying
  into an ambiguous multi-megabyte UI payload. The legacy object-shaped
  selection decoder remains tolerant: it skips stale invalid entries and keeps
  the first canonical bounded set rather than taking down settings hydration;
  duplicate array selections likewise normalize with stable first-value
  semantics instead of leaving clients and settings merges to disagree.
- Replay every pending event when a projection bootstraps instead of silently
  stopping after the event store's default 1000-event window. The event store
  keeps streaming in 500-row pages, so a large rebuild is complete without
  materializing the full log.
- Skip attachment-root I/O when a projection batch has no cleanup work, and
  otherwise read and index the flat attachment directory once per batch.
  Reverting or deleting several threads no longer rereads and reparses every
  attachment once per affected thread.
- Append streaming assistant deltas inside SQLite instead of repeatedly
  reading, concatenating, and rewriting the complete growing message. Shell
  summary refreshes now query four scalar aggregates instead of hydrating all
  message text, plan Markdown, activity payloads, and approval history.
- Settle all matching running turns with one atomic SQL update rather than
  decoding every historical turn and checkpoint-file array and then issuing
  one write per running row.
- Page merged-pull-request settlement candidates by thread ID in batches of
  100, preventing each periodic sweep from materializing and performing remote
  lookup work for every eligible thread at once. Persisted command rejection
  diagnostics are capped at 8 KiB at the repository boundary.
- Bound derived resource-telemetry snapshots to the maximum native-plus-
  Electron process envelope, history to 3,600 buckets and 512 ranked process
  identities, and attribution to 256 retained keys. Process labels, commands,
  health diagnostics, numeric rates, and derived aggregates now share finite
  wire budgets. Attribution overflow is accumulated into an `other/overflow`
  entry so totals survive, while explicit truncation flags cover attribution,
  history rankings, desktop Electron metrics, and the merged live snapshot.
- Build resource-history buckets with one forward scan instead of filtering
  every retained sample for every bucket, and summarize each process identity
  in place instead of retaining and sorting a second array of its samples.
  Lifetime telemetry counters now saturate instead of overflowing into values
  that fail JSON or wire-schema encoding.
- Remove newly written Canvas data-URL attachments when a later operation,
  document validation, or persistence step rejects the apply. The SQLite
  commit and attachment-ownership handoff are interruption-safe, so cleanup
  cannot delete an image after its document became durable.
- Admit at most 32 queued attachment-preview jobs and run only two native image
  decoders concurrently. Sharp now rejects corrupt inputs, disables unbounded
  pixel allocation above 40 million source pixels, and reads sequentially;
  overloaded previews fall back to the original asset instead of growing a
  native decode and temporary-file backlog.
- Probe only one directory entry when validating an existing source-control
  clone destination instead of materializing its complete child list.
- Replace storage inventory's project-by-project thread-query loop with one
  deterministic project read and one deterministic thread read, preserving
  project grouping while eliminating the database N+1 path.
- Stream storage-orphan discovery through bounded directory handles instead of
  materializing every visited directory. Discovery now stops at 20,000
  directories, 100,000 entries, and the remaining 4,096-entry wire capacity;
  it skips symlinks, never descends into owned or already identified checkout
  roots, and therefore no longer mislabels nested leaf folders as independently
  removable orphans. Managed worktree entries use the same aggregate ceiling,
  while no-worktree counts are accumulated without retaining additional
  snapshot rows.
- Revalidate orphan removal at the destructive RPC boundary. Removal now
  refuses truncated ownership snapshots, paths that overlap an owned worktree
  in either direction, and paths redirected through symlinked directories
  outside (or elsewhere within) the managed root.
- Stream the portable storage-size fallback through directory handles and
  fixed 64-file stat batches. Flat worktrees no longer materialize every entry
  and file path at once, and custom abort reasons can no longer be swallowed as
  ordinary filesystem failures.
- Replace active-versus-archived storage byte deduplication's nested scan with
  a path set, and saturate directory/category totals at the largest safe wire
  integer so extreme or malformed filesystem metadata cannot make the whole
  inventory response undecodable.
- Bound preview state to 256 tabs per thread and 4,096 tabs per server with a
  typed limit error, and use collision-free tuple keys for legal identifiers.
  Cap local-server discovery at 512 sorted results at both process parsing and
  the wire contract so unusual hosts cannot fan out unbounded probes/payloads.
- Align preview-automation snapshot IPC schemas with the desktop producer's
  existing text, element, diagnostics, action, screenshot, and accessibility
  ceilings. The desktop now returns only the measured bounded accessibility
  node envelope, rather than spreading unexpected top-level protocol data.
- Bound preview-automation status URLs and page titles at the same shared wire
  ceilings as snapshots. A malformed or older host can no longer send an
  unlimited high-frequency status string through the renderer/server bridge.
- Close every server-owned preview session when its thread is deleted, using
  the existing best-effort deletion reactor alongside provider-session and
  terminal cleanup. Deleted tabs no longer consume the 4,096-session process
  ceiling until the server restarts.
- Reject preview-automation results above 24 MiB of encoded JSON and remote
  error envelopes above 64 KiB before settling broker deferreds. The generic
  128 MiB WebSocket ceiling can no longer multiply across 64 outstanding host
  requests into retained multi-gigabyte result/error state; unserializable
  direct-service responses are classified as malformed instead of throwing.
- Backpressure the lossless orchestration command ingress at 64 queued
  commands. Dispatch callers now wait for the single event-store worker to
  make room instead of retaining an unlimited burst; command order and receipt
  semantics are unchanged and no mutation is dropped.
- Key preview-automation clients by `(environment, client)` and provider leases
  by serialized identifier tuples. Equal client IDs on two connected
  environments no longer replace each other or make one environment lose its
  browser host.
- Contain fire-and-forget preview automation response failures. A host stream
  that is replaced while desktop work finishes no longer turns the rejected
  stale response command into an unhandled renderer promise.
- Deduplicate the latest 256 `(connection, request)` browser-automation events
  in the renderer. Atom replay or mount timing can no longer execute the same
  click/type/navigation side effect twice.
  Truncated or unreadable scans carry truthful optional coverage metadata to
  web and mobile, where bulk cleanup is disabled but individually verified
  listed paths remain actionable.
- Backpressure lossless client connection-control bursts at 64 signals and
  per-thread ordered stream bursts at 4,096 items. Disconnect/retry events and
  cursor-ordered deltas are never dropped, while a stalled client reducer can
  no longer grow either local queue indefinitely or materialize an unbounded
  coalescing batch.
- Make trace-id recovery tolerate throwing accessors and adversarial aggregate
  error arrays. Traversal now reads defensively, admits at most 128 pending
  nodes, and rejects oversized identifiers instead of allocating a nominally
  bounded walk around an unbounded pending stack.
- Bound schema-error formatting to 256 issue nodes and 64 cause reasons while
  retaining the existing eight-issue/2-KiB presentation ceiling. Very wide or
  deep invalid payloads now report that more issues exist without recursively
  traversing the complete already-rejected schema tree, and diagnostic paths
  stop growing after their displayed segment budget.
- Count drainable-worker outstanding work only after its queue accepts the
  item. A worker value that escapes its closed owner scope can no longer turn a
  rejected late enqueue into a permanent `drain` wait.
- Retain at most 256 source-control action command wrappers per client runtime
  with least-recently-used eviction. Historical environment/worktree targets
  no longer remain strongly reachable forever; an evicted in-flight command
  remains valid and still shares the scheduler's target-serial lane.
- Preserve hyphens in prerelease versions, compare arbitrarily long numeric
  prerelease identifiers without floating-point rounding, reject unsafe main
  version integers, and order prerelease runtimes below an equal stable range
  boundary. The stringified remote range checker remains plain JavaScript.
- Refuse `.` and `..` as inferred clone folder names and strip the conventional
  `.git` suffix case-insensitively, so a pasted remote cannot make the proposed
  destination escape to the selected directory's parent.
- Define parsed CLI flags as own data properties, preserving valid names such
  as `__proto__`, `constructor`, and `toString` instead of silently invoking or
  shadowing inherited object behavior.
- Bound tool-activity path discovery to 256 visited payload nodes. A very wide
  provider array with no useful path can no longer make a single presentation
  derivation scan every entry on the client render path.
- Encode archived-environment atom keys as deterministic JSON rather than
  joining legal identifier text with another legal identifier character.
  Distinct environment sets no longer collide into the same cached snapshot,
  and malformed family keys now fail closed.
- Encode internal scoped project/thread atom keys as validated JSON tuples
  rather than joining contract-valid identifiers with NUL. Entity IDs that
  contain the old delimiter no longer alias another environment/entity pair,
  and malformed family keys fail with the existing structured errors.
- Use the same collision-free environment/input tuple encoding for marketplace
  refresh and orphan-removal single-flight lanes. Legal colons in an
  environment ID, repository source, or path can no longer make one command
  incorrectly share another command's active result.
- Fail snooze classification visible when the client clock, snooze timestamp,
  or hand-raise event timestamp is malformed. Corrupt lifecycle data can no
  longer keep a thread with a future wake time, failure, or completed run hidden.
- Select the combined terminal summary/buffer timestamp with the shared
  deterministic timestamp comparator. A valid timestamp now wins regardless
  of which stream supplies it, while two malformed legacy values keep a stable
  ordering instead of inheriting asymmetric `NaN` comparison behavior.
- Dispose idle initial-configuration and prepared-connection subscriptions
  after the same five-minute window used by other environment query and shell
  atoms. Visiting an environment no longer keeps both supervisor streams and
  their last connection/configuration state alive for the full client session.
- Dispose an environment's supervisor-state subscription five minutes after
  its last reader leaves. Removing or navigating away from an environment no
  longer keeps that historical connection stream live for the rest of the
  client session; catalog-wide readers still keep every current row mounted.
- Index pending lifecycle entries by thread in one pass before projecting a
  shell snapshot. Overlay work is now `O(threads + pending)` rather than
  rescanning as many as 65,536 pending commands for every thread, while each
  thread's existing coalesced domain order and untouched object identity stay
  intact.
- Coalesce a persisted lifecycle-command batch with one backward survivor
  index. Hydrating as many as 65,536 valid queued entries is now `O(pending)`
  rather than repeatedly filtering a growing array, while replacement order
  and settle's historical removal of earlier snoozes remain unchanged.
- Index workflow members once by parent before cascading a settled
  coordinator's outcome. Folding retained legacy activity is now
  `O(agents + workflows)` rather than checking every agent for every terminal
  workflow, while insertion order, retry reactivation, and the 100-agent
  retention ranking remain unchanged.
- Apply shell project/thread upserts with one ID scan instead of probing the
  full snapshot and then mapping it again. Large environment snapshots now
  preserve duplicate replacement and untouched row identity with half the
  per-upsert lookup work.
- Build project/thread indexes and cross-environment entity lists with direct
  loops. Large legacy shell snapshots no longer allocate intermediate tuple or
  singleton arrays, and aggregation no longer risks the JavaScript variadic
  argument ceiling while preserving catalog and snapshot order.
- Define normalized trace attributes through own data properties. Provider or
  OTLP keys such as `__proto__` can no longer mutate a diagnostic object's
  prototype or silently disappear during bounded nested serialization.
- Release an archived shell-snapshot query after 90 idle seconds rather than
  the generic five-minute query window. Leaving archive navigation no longer
  retains a potentially history-sized snapshot for several extra minutes,
  while short route transitions still reuse the cached result.
- Release idle project entry searches, recursive trees, and source-file reads
  after 60 seconds instead of five minutes. Navigating or typing across
  projects/files no longer retains multiple 200-result search keys, results of
  up to 25,000 paths/16 MiB of path text, or 1 MiB of file text for four
  additional minutes; immediate back-navigation remains warm.
- Release idle turn-range and full-thread diff queries after 60 seconds rather
  than five minutes. Visiting several checkpoints no longer keeps multiple
  contract-unbounded diff strings resident for four extra minutes.
- Release idle canvas snapshots and event subscriptions after 60 seconds
  rather than five minutes. Navigating among canvas threads no longer retains
  multiple documents or last snapshot events that may each reach the 2 MiB
  contract ceiling, nor keeps their remote streams alive for four extra
  minutes; an active canvas and immediate back-navigation remain unchanged.
- Release idle pull-request diff pages and conversation activity after 60
  seconds rather than five minutes. Review navigation no longer retains every
  cursor-keyed patch of up to 8 MiB, plus large comment/thread histories, for
  four extra minutes after their readers leave.
- Release idle agent-instruction contents after 60 seconds rather than five
  minutes. Opening several server-minted files no longer retains each result of
  up to 1 MiB for four extra minutes; the lightweight file listing keeps its
  existing navigation cache.
- Release idle review-diff previews after 60 seconds rather than five minutes.
  Switching repositories, base refs, or whitespace modes no longer retains
  each multi-source patch result for four extra minutes after its reader
  leaves.
- Release idle access-management subscriptions after 60 seconds rather than
  five minutes. Closing Settings no longer retains as many as 1,024 pairing
  links plus 1,024 client sessions or keeps their remote update stream alive
  for four extra minutes; reopening after eviction receives a fresh snapshot.
- Release idle terminal attachment, event, and metadata streams after 60
  seconds rather than five minutes. Closing terminal UI no longer retains a
  512 KiB client buffer, a potentially 1 MiB last output event, or an unbounded
  metadata snapshot while processing remote updates for four extra minutes;
  terminal processes are unaffected and reattachment resnapshots history.
- Trim a full terminal output window with a UTF-8-aware scan of only the prefix
  being evicted. Continuous output no longer re-encodes and allocates the whole
  512 KiB retained buffer for every small chunk, and surrogate pairs split
  across chunks now keep an exact byte count.
- Release idle VCS-status subscriptions after 60 seconds rather than five
  minutes. Leaving a workspace no longer retains its server-side remote poller
  for four extra minutes, avoiding needless forge refresh work and quota use;
  active views remain continuously subscribed.
- Release superseded filesystem-browse queries after 30 idle seconds rather
  than five minutes. Typeahead no longer retains one result of up to 200
  full-length paths for every partial path typed during the previous five
  minutes.
- Release idle preview snapshots and event subscriptions after 60 seconds
  rather than five minutes. Moving across threads no longer retains up to 256
  preview sessions per old route or keeps its remote event stream alive for
  four additional minutes; visible previews stay subscribed.
- Parse bare and quoted composer mentions with one linear scan and reject paths
  beyond the 32-KiB project-path contract. Repeated unterminated `@"` prefixes
  can no longer make every keystroke rescan the remaining draft quadratically,
  and a single pill cannot retain an out-of-contract path.
- Strip stacked historical auto-PR instruction suffixes against one source
  string and take a single final prefix slice. Rendering a legacy message with
  hundreds of duplicated blocks no longer repeatedly copies a shrinking
  near-megabyte message.
- Stop mobile composer trigger discovery after the 256-character path-search
  query ceiling. Long unbroken tokens no longer force a full backward scan on
  every keystroke or create a request the wire contract will reject.
- Reject malformed or non-finite OKLCH preview components before conversion,
  so an imported theme falls back to its source canvas color instead of
  emitting an invalid `#NaNNaNNaN` native fill.
- Replace unpaired UTF-16 surrogates before composer file-link URL encoding,
  preventing a malformed draft path from throwing during link insertion.
- Recognize skill frontmatter after a UTF-8 byte-order mark, and ignore opaque
  provider skill fields whose proxy/getter access throws instead of letting
  metadata presentation take down event processing.
- Bound relay telemetry error causes to 16 levels, Effect reasons to 64,
  messages to 4 KiB, and retained stacks to 64 KiB. Opaque getters and object
  coercion can no longer escape span finalization, and nested stacks no longer
  grow without a finite ceiling.
- Derive thread-snapshot proof URLs from the same typed HTTP contract builder
  as the request itself. Entity IDs containing slashes, spaces, or other path
  syntax are now percent-encoded identically, so relay DPoP authorization no
  longer signs a different path than the client sends.
- Build remote-environment HTTP failure details from bounded primitive or
  defensively read error fields instead of coercing an arbitrary failed value.
  Throwing accessors and `Symbol.toPrimitive` hooks can no longer replace the
  intended typed fetch error with a defect, and retained detail stops at 4 KiB.
- Define deep-merge results through own data properties. A JSON-derived
  `__proto__` settings key can no longer invoke the legacy prototype setter and
  mutate the merged record's prototype.
- Bound safe-log cause traversal to 128 nodes and retained stack source to 64
  KiB/32 frames. Malformed stack URLs now lose userinfo, query, and fragment
  text even when the URL parser rejects them, keeping the fallback diagnostic
  both finite and credential-safe.
- Refresh command-resolution cache replacements before capacity eviction. An
  expired key at the 512-entry ceiling no longer discards an unrelated result,
  shrinks the cache, and remains stuck at its old FIFO position on every retry.
- Reject non-integer and out-of-range ports before Node's bind/connect helpers
  can throw synchronously. Invalid preferred ports now take the existing
  ephemeral-port fallback instead of defecting during startup discovery.
- Recognize an existing Claude `Ultrathink:` prompt prefix without regard to
  case, preventing a lowercase or uppercase user-authored prefix from being
  duplicated during dispatch.
- Reserve the managed project-favicon revision, separator, and extension inside
  the 255-character basename ceiling. A long valid source filename no longer
  produces a managed path that common filesystems reject after the icon bytes
  have already been copied.
- Treat a query or fragment as a valid boundary after a bare loopback preview
  host, so `localhost?...` and `[::1]#...` keep the intended HTTP development
  default instead of unexpectedly switching to HTTPS.

### Marketing and downloads

- Harden the latest-release lookup with an HTTP deadline, status checks, a
  1 MiB streaming response cap, strict GitHub release and asset URL validation,
  and a short-lived validated cache with stale fallback. Corrupt or oversized
  session cache entries now refresh instead of breaking every download link;
  rejected/oversized bodies are cancelled and every streaming reader releases
  its lock on success, abort, or decode failure.
- Pause the endorsement marquee whenever it is offscreen or the page is
  hidden, disable it for reduced-motion users, and remove two inert infinite
  animation declarations whose keyframes did not exist. The marketing page no
  longer spends compositor time on its only live continuous motion when no one
  can see it.
- Respect reduced-motion preference across marketing entry animations and
  smooth scrolling, reserve footer-icon layout before its image loads, and
  frame-throttle and clean up the global navigation and legal-page scroll
  observers.

### Web

- Compare wire timestamps chronologically instead of as raw strings across
  preview reconciliation, canvas capture ordering, timeline/plan/approval
  ordering, pull-request lists/conversations, archived threads, provider-update
  freshness, diff checkpoints, drafts, shell summaries, and subagent
  rosters/logs. Mixed fractional precision and timezone offsets can no longer
  make an older snapshot replace a newer one or reorder UI rows; invalid legacy
  timestamps remain deterministic and sort before valid values.
- Release resizable-panel pointer capture, pending animation frames, and global
  body cursor/selection overrides when a panel unmounts mid-drag. Existing
  inline body styles are restored instead of being discarded, and a second
  pointer cannot replace an already-owned drag session.
- Fence the shared minute clock's timeout-to-interval handoff so its last
  subscriber leaving during a boundary notification cannot install an orphaned
  interval after cleanup or overwrite a replacement subscriber's timer.
- Clear canvas pointer sessions, mirrored gesture state, pending viewport
  transforms, pinch state, and every animation frame when the canvas unmounts
  or switches threads, preventing a removed surface from leaving its old
  thread stuck in a dragging or drawing state.
- Treat lazy World Scenery priming as best-effort so a transient chunk-load
  failure cannot escape the synchronous new-thread action as an unhandled
  rejection. Pre-hydration primes are de-duplicated under a finite 256-thread
  budget and share one self-removing hydration listener instead of retaining
  one callback per attempted thread.
- Contain Ghostty terminal font-preview creation and font-update failures so a
  missing WASM asset or renderer failure cannot escape Appearance settings as
  an unhandled rejection. Late-created previews still dispose after unmount,
  and a bounded unavailable state replaces the failed terminal surface.
- Contain rejected desktop context-menu IPC in branch, right-panel, legacy
  project, terminal-selection, and canvas-cleanup flows, so a closing or
  unavailable Electron bridge cannot surface an unhandled renderer promise
  after the gesture is already consumed or its owner has unmounted.
- Contain rejected host-link opening across pull-request headers, checks,
  summaries, and timelines behind one user-visible failure path instead of
  leaking rejected shell IPC from fire-and-forget click handlers. Repository
  publishing and Git-action toast links now report the same bridge failures.
- Report rejected preview refresh, history, and zoom IPC as bounded action
  failures. A tab closing during a toolbar click can no longer leave an
  unhandled renderer promise.
- Bound every preview-automation host request by its wire timeout. A desktop
  bridge or renderer operation that never settles now returns the typed timeout
  response and releases the request's preview-guest residency instead of
  pinning the guest and request forever; late uncancellable IPC settlement is
  detached from the completed request.
- Present telemetry truncation flags beside live process, history ranking, and
  I/O attribution tables. Diagnostics no longer imply that capped native,
  Electron, historical, or attribution rows are a complete data set.
- Prevent scenery download-registration calls from sending the configured
  Unsplash authorization header to off-origin or malformed persisted URLs.
  Search terms, result counts, response bytes, API metadata, access keys, and
  image transforms are now finite and validated; malformed photo records are
  skipped rather than crashing a pool refresh or becoming executable image
  URLs.
- Tear down the shared status-pulse visibility, media-query, and motion-store
  observers when its last indicator unmounts, preventing hot-reload and
  transient-view listener accumulation. One bad elapsed-time subscriber can
  no longer stop the document-wide second ticker from updating every other
  label.
- Contain synchronous local-storage quota and browser-policy failures inside
  the shared debounced storage adapter. Large scenery or composer-draft writes
  can no longer surface later as an uncaught timer exception after the render
  that scheduled them.
- Bound pending desktop path attachments to 32 per thread with explicit
  overflow feedback, and merge rather than overwrite any files added while a
  failed send was in flight. Desktop bridge lookup failures now fall back
  safely, real path whitespace is preserved, and JSON quoting carries paths
  with backticks or newlines into the agent prompt without rewriting or marker
  injection. Browser-inline text files choose a code fence longer than their
  content, while plan follow-ups validate the fully composed provider prompt
  after attached paths are appended.
- Fence the post-sign-in Connect onboarding mutation to the account and dialog
  generation that started it. Signing out, switching accounts, closing the
  dialog, or unmounting now invalidates the outstanding result so an old relay
  operation cannot advance or toast success inside a newer account's wizard.
  Relay-environment Connect actions use the same account/unmount fence plus a
  synchronous single-flight guard, so a double click cannot register twice and
  an old account's result cannot clear or toast inside the replacement view.
  Account-profile deregistration is fenced the same way, preventing a slow
  destructive mutation from clearing confirmation state or reporting success
  after the user has switched to another account.
  Cloud-link error inspection now follows at most 64 unique `cause` nodes, so a
  cyclic or adversarial nested error cannot recurse until the renderer stack
  overflows while it is trying to report a network failure.
  Hosted CLI OAuth callbacks reject oversized authorization-code and state
  query values before concatenating, rendering, or offering them to the
  clipboard, using the same ceilings as the CLI parser.
  Persisted “don't show again” accounts are de-duplicated as an LRU-style list
  and capped at 64 contract-sized Clerk identifiers instead of growing for the
  browser profile's lifetime.

- Deduplicate identical encoded Ghostty mouse-motion writes before they cross
  the terminal bridge.
- Derive timeline minimap turn data in one pass rather than repeatedly scanning
  all rows, and bound streamed preview-text compaction to the prefix the UI can
  display.
- Replace the preview loading component's timer-driven React rerenders with a
  bounded CSS-only animation that respects reduced motion and the app's motion
  preference.
- Make the desktop-local topology reader asynchronous, coalesce identical
  in-flight bridge reads, reject stale out-of-order results, and publish bridge
  changes through a properly detached external-store subscription.
- Invalidate an older desktop-local IPC read as soon as a replacement bridge is
  selected, including when the replacement throws synchronously, so stale WSL
  topology cannot resurrect later.
- Expire unresolved desktop topology IPC reads after five seconds. Generation
  guards prevent a timed-out result from overwriting a successful retry, and
  the primary desktop bootstrap loader follows the same bounded policy.
- Parse angle-bracket Markdown destinations and paths containing spaces, keep
  modifier-click editor behavior, and show the full target path in the file
  tooltip.
- Support negative, string, and wide ordered-list starts without clipping the
  marker gutter; footnotes inherit the same gutter treatment.
- Stop sending private, loopback, or tailnet hosts to the public favicon
  service and bound failed-host retention with an LRU.
- Avoid quadratic preview-thread deduplication and prune stale pin timestamps
  from the Electron browser residency tracker.
- Split oversized Ghostty input into bounded grapheme chunks, preserve a lone
  Shift modifier for Kitty keyboard reporting, and make terminal copy fallback
  and IME composition safe. Buffer/status updates no longer clear a user's
  active terminal selection unnecessarily.
- Stop an empty right-panel composer launcher from consuming the first typed
  character, normalize IPv4 and IPv6 loopback preview targets to `localhost`,
  and compare mixed-precision ISO timestamps chronologically rather than
  lexicographically.
- Keep environment-port preview targets on the selected private environment
  even when their path begins with `//host`. The path is now resolved as an
  explicit relative-path reference instead of being allowed to replace the
  environment origin through URL network-path semantics.
- Preserve the first assistant response, attachment deliverables, and terminal
  message when compacting settled turns.
- Refresh the independently cached open file together with the workspace tree
  from the File Browser refresh action. Image refreshes now mint a new signed
  URL query so a cached error or stale response cannot survive the retry.
- Disable the File Browser refresh action while its tree or selected-file
  refresh is already pending, announce file/image loads and failures to
  assistive technology, prevent repeated clicks from stacking equivalent
  refresh work, and scope right-click coordinate capture to the file panel
  instead of installing a document-wide listener per mounted browser.
- Explicitly cancel every retained file-line reveal frame, scroll-guard
  listener, and pending editor-selection frame when the file preview unmounts,
  rather than relying solely on the third-party renderer to deliver its
  post-render unmount callback.
- Recover the editor save coordinator after both rejected promises and resolved
  command failures: the pending marker remains truthful, one error is shown,
  and an edit made during the failed write is still persisted.
- Evict rejected desktop-tab creation leases and identity-check stale release
  callbacks so a failed lease cannot poison or close a successful retry.
- Track preview status delivery by the complete payload (including title and
  history state), acknowledge only the current request, retry after failure,
  and ignore settlements from a stale bridge subscription.
- Coalesce immediate, `did-attach`, and `dom-ready` desktop webview
  registrations so one guest cannot start overlapping registration IPCs.
  Navigation, overlay-registration, and rendered-viewport readiness now apply
  their declared deadline to each bridge/webview await instead of hanging
  forever inside a nominally bounded polling loop.
- Bound a desktop CDP automation control action to sixty seconds and its
  interruption cleanup commands to five seconds. A Chromium debugger promise
  that never settles can no longer retain the per-tab control semaphore,
  timeline action, or agent-controller state forever; authored coverage also
  proves that the lane accepts a later action after the deadline.
- Scope a canvas image node's retained signed URL and failed-load state to its
  current attachment identity. Recapturing a node no longer flashes the old
  bitmap while the replacement URL loads, and successful URLs are retained
  without scheduling React state during render.
- Surface failures from user-triggered preview reload, DevTools, appearance,
  zoom, cookie, and cache actions instead of silently swallowing rejected or
  synchronously thrown desktop bridge calls.
- Mount preview-panel viewport resize tracking only while inline width
  clamping is active. Sheet, embedded, sidebar, and maximized panels no longer
  install a window listener and rerender on every OS resize for a value they do
  not consume.
- Share one frame-coalesced window resize/scroll subscription across browser
  surface slots. Multiple mounted panels and mini players no longer install
  duplicate global listeners or repeat their layout reads for every event in a
  single scroll burst.
- Keep the agent browser cursor mounted across pointer events and reset only
  its inactivity timer. Mouse movement no longer tears down and recreates the
  cursor subtree and timeout on every sequence update, preserving transform
  transitions while reducing renderer churn.
- Keep zoom-indicator timer cleanup tied to unmount rather than every factor
  effect cleanup. A sub-epsilon zoom update no longer cancels the pending hide
  timer and leaves the indicator visible forever.
- Schedule blob-URL cleanup for plan and custom-theme downloads from a
  `finally` path, so an exception while constructing or invoking the browser
  download cannot retain the generated payload for the page lifetime.
- Treat a browser protocol handoff that throws as an unsuccessful remote-editor
  open instead of leaving an unhandled rejection, and correct the editor menu
  trigger's accessible name from the unrelated “Copy options” label.
- Report rejected remote-editor handoffs at the button and keyboard entry
  points, surface native project-folder picker failures, and report theme-file
  and plan download failures after scheduling blob cleanup instead of failing
  silently.
- Give repository lookup in the command palette a latest-query generation, so
  editing the repository or leaving its submenu prevents an older lookup from
  replacing the new query. Open VSX search and install now own independent
  abort controllers, and searches are blocked while an install is committing,
  preventing a suggestion click from cancelling the install and leaving its
  progress state stuck forever.
- Reserve add/open-project work with a ref-backed single-flight guard and
  disable its duplicate entry controls while pending, preventing repeated
  Enter/click events from creating multiple project records for one folder.
- Add a direct command-palette route for Keybindings instead of matching that
  query to General settings. A first Escape while editing a settings field now
  blurs the field and leaves Settings only on a later Escape; dialogs and
  popups retain ownership of their own Escape handling. Closing the palette
  outside chat now restores its invoking control rather than cancelling focus
  restoration when there is no composer to focus.
- Route Connect trace-ID copy actions through the bounded clipboard helper
  with visible success and failure feedback, and announce changing empty
  command-palette results as an assistive-technology status.
- Load Markdown images lazily with asynchronous decoding and no referrer, make
  preview refresh labelling truthful during an in-flight refresh, and preserve
  address selection when focus is requested programmatically.
- Preserve client settings through read/decode failures and pre-hydration edits:
  malformed storage now remains an error, pending patches merge after a
  successful read, and full-document writes are serialized and latest-coalesced
  in both renderer and desktop persistence. Test resets are generation-fenced
  so a stale asynchronous writer cannot consume a later test's queued state.
- Synchronize browser client settings across tabs through one lazily retained
  storage listener. External snapshots wait for local full-document writes,
  merge any pre-hydration patch, and are generation-fenced so an older event or
  hydration read cannot roll the visible settings backward.
- Bound client-setting notification, favorite, skill, per-provider model, and
  project-grouping collections at the shared schema boundary. Individual
  persisted values are bounded too, and desktop refuses to write an encoded
  settings document that its own one-MiB reader could never load again. Browser
  persistence applies the same one-MiB UTF-8 ceiling before decoding or writing
  local storage.
- Hide a debounced workspace-path query's previous entries and error until its
  complete environment, workspace, query, kind, and image target settles. Old
  composer file suggestions can no longer remain selectable while a new query
  or project/environment switch is pending.
- Clamp web thread, branch, workspace-path, and content searches to their wire
  contract budgets before debouncing or constructing query atoms. Pasting or
  continuing to type a long unbroken token no longer produces repeated schema
  failures, invalid thread-search keys, or a permanently empty result set.
- Bound the syntax-highlighter promise cache, evict rejected entries so a
  transient initialization failure can retry, and keep a total scenery network
  failure from pretending the photo pool is fresh for 14 days.
- Let Ghostty keyboard-layout lookup retry after a transient browser API
  failure instead of caching `undefined` for the entire page lifetime.
- Bound pull-request panel snapshots to 128 recently viewed entries and live
  refresh timestamps to 256 entries so browsing many sessions cannot grow
  those presentation caches for the lifetime of the page.
- Bound the keep-alive thread change-request snapshot map to the 512 most
  recently changed threads. Sidebar row remounts still preserve terminal PR
  state without retaining every PR-bearing thread visited during the page
  lifetime.
- Limit Storage inventory work to 32 connected environments and report how
  many environments were omitted. Active, archived, and orphan worktrees now
  render in 100-row increments while bulk actions continue to cover the full
  loaded inventory, and concurrent “open managed folder” actions keep
  independent pending state instead of clearing one another. Long-running scan
  and refresh indicators use the shared visibility-aware status pulse instead
  of continuously rotating for a wedged or background connection.
- Retry Markdown syntax rendering after code, path, or theme identity changes
  instead of pinning one transient highlighter failure for the component's
  lifetime. Expanded image previews now move focus into the modal, trap Tab,
  restore prior focus, and clean up their capture listener on close.
- Route Markdown table/code, message/command, file-path, preview-artifact, and
  right-panel path copies through the shared clipboard helper with visible
  failure feedback and accurate accessible labels.
- Reject image attachments whose asynchronous preparation outlives its draft,
  revoke each abandoned object URL once, and avoid revoking a URL retained by
  another accepted image later in the same batch. Missing draft sessions no
  longer accumulate orphan composer state or blob previews.
- Guard canvas “Add to chat” synchronously against double submission and only
  clear the note that was actually submitted. Text entered while the canvas
  crop is still rendering now survives completion instead of being erased.
- Limit one canvas paste/drop to 32 supported images and the document's
  remaining node capacity before any file bytes are decoded or compressed.
  Unsupported and omitted files are reported, and a second import cannot start
  another image pipeline over one already in flight. Image dimension decoding
  now releases its listeners on every outcome and fails after 15 seconds
  instead of leaving an import permanently in flight.
- Persist composer images incrementally: attachments already durable under the
  same id and metadata reuse their existing data URL, while only new files are
  read, one at a time, in composer order. A superseded effect stops before its
  next read instead of every attachment change concurrently base64-encoding up
  to eight ten-MiB images again.
- Calculate an image's exact base64 data-URL length from its byte count before
  stash persistence. A source that cannot fit now goes directly to bounded
  re-encoding without first allocating its complete ArrayBuffer and larger
  base64 string, and stash compression applies the existing 50-MiB source
  decode ceiling before creating an ImageBitmap.
- Give the floating theme editor an unhandled-Escape close path without
  preempting nested dialogs, menus, selects, popovers, comboboxes, or
  autocompletes. Closing restores a still-connected invoking control only when
  focus otherwise fell back to the document body, and unexpected pointer
  capture loss clears both drag and resize sessions.
- Let the provider accent hex field retain incomplete local input while the
  user types or backspaces. Only complete six-digit colors reach settings, and
  leaving an incomplete field restores the last committed picker color instead
  of making the controlled input appear frozen.
- Make the preview-panel separator keyboard operable with arrows, Shift
  acceleration, Home, and End while exposing its current range to assistive
  technology. Cancelled or unexpectedly lost pointer capture reverts the
  unfinished drag and releases every global body style.
- Key pull-request check rows by host identity and duplicate occurrence rather
  than current array position or status, preventing row state from migrating
  between checks when the host reorders or updates them.
- Bound primary-environment HTTP fetches to 15 seconds while preserving the
  caller's abort reason. The deadline signal remains active through response
  body consumption, so a server that returns headers and then stalls cannot
  bypass desktop bootstrap or browser retry policy.
- Make connection-cache and browser-DPoP IndexedDB callbacks interruption-safe.
  Cancelled reads, writes, deletes, and cursor sweeps abort their live
  transaction; an uncancellable database open that succeeds after its caller
  leaves closes the late handle, and a cancelled blocked-open timer is cleared.
- Route same-document Markdown links through TanStack history instead of
  mutating `window.history` behind the router, preserving hash/back-state
  ownership. Invalid or oversized server and draft route identifiers now
  redirect to the app root instead of leaving a blank matched route or probing
  draft state with an unbounded external key.
- Re-decode Connect and pairing deep links when their hash or query changes
  without a full page reload. Request-scoped sign-in/redirect guards reset for
  the new authorization request, pairing surfaces remount around the new
  one-time credential, and Skills settings remount pending action state when
  the primary environment identity changes so an old settlement cannot paint
  errors or spinners onto the replacement environment.
- Give project settings the same Escape ownership as global settings: nested
  dialogs and popups keep the key, an edited field blurs on the first press,
  and only a later unowned Escape navigates away from the project.
- Drop Electron preview surface geometry and pointer records when their runtime
  tab genuinely disappears, while preserving state for temporarily hidden or
  residency-evicted live sessions. Surface updates no longer become
  progressively more expensive after every closed tab.
- Remove composer, terminal, right-panel, diff, mini-player, preview, scenery,
  visit, and changed-file presentation state after a successful local thread
  deletion, including the direct archived-thread deletion path.
- Retain parsed pull-request patches only for the current diff slices while
  reusing exact matches, and evict a rejected font-preview highlighter promise
  so one transient failure does not permanently blank that theme or produce an
  unhandled rejection.
- Prune pull-request list diff statistics to the currently visible targets,
  preserving intersecting counts during replacement queries while filtering
  late obsolete results. Cap dismissed full thread errors at 128 entries.
- Bound file-line reveal state, project-favicon successes, provider-update
  notification keys, branch-mismatch dismissals, scenery-arrival history, and
  PR handoff prompt history with small recency caches rather than retaining
  every resource opened during the page lifetime.
- Expire inactive web and mobile usage-window aggregator atoms after five
  minutes so changing custom date ranges or time zones does not retain every
  historical cross-environment dependency graph for the app lifetime.
- Give wallpaper decoding a 15-second settlement bound and clear listeners on
  every outcome, so a browser decode promise that never resolves cannot poison
  that URL forever. Ghostty's two bundled WASM body reads similarly fail after
  30 seconds, cancel when their streamed body exceeds two MiB, and remain
  retryable rather than allocating an arbitrary replacement asset in the
  renderer.
- Release transient Ghostty WASM allocations from terminal writes, viewport
  scrolling, theme application, selection, coordinate conversion, cell decode,
  and output encoding even when a native call traps. Failed PTY callback
  attachment and detachment likewise clear their JavaScript writer entry, so a
  malformed terminal transition cannot leak renderer memory or retain stale
  closures for the page lifetime.
- Release the desktop-capture picker's base64 thumbnails whenever it closes,
  and generation-fence list/permission requests so an older refresh or closed
  dialog cannot publish late capture sources into a newer opening.
- Settle MediaRecorder shutdown on stop, error, synchronous failure, or a
  five-second deadline; remove every settlement listener and stop the canvas
  stream tracks during final cleanup so a failed media pipeline cannot pin the
  native preview tab indefinitely.
- Bound each Open VSX import network step, including its streamed response
  body, so manifest, package, or checksum downloads cannot leave Settings in a
  permanent importing state. Caller cancellation continues to win.
- Reject theme-import batches above 64 files before reading them, surface native
  picker failures, and generation-fence native picker results so a dismissed or
  newer import dialog cannot be overwritten by an older selection.
- Enforce the eight-image provider limit inside the composer store as well as
  the picker UI, revoke previews rejected at that final boundary, and keep a
  preview annotation sendable without its screenshot when the draft is full
  while telling the user what happened. Annotation screenshots now pass
  through the same provider byte-limit compressor as pasted images and use a
  revocable blob URL instead of retaining another full base64 copy in memory.
- Bound background-activity reports to four environments at a time and ten
  seconds per request, so one unreachable environment cannot permanently stop
  lease refreshes for every other connection or fan out without limit.
- Fail desktop network-access settings reads after five seconds instead of
  leaving the settings surface permanently pending when either Electron bridge
  call never settles; successful refreshes remain cached by the existing atom.
- Fail cloud DPoP key storage promptly when an IndexedDB upgrade is blocked or
  a read/write transaction aborts, wait for read commit before using key
  material, close late and version-stale database handles, and convert
  synchronous browser storage failures into the typed auth error.
- Reject oversized persisted browser DPoP private coordinates before base64
  decoding or WebCrypto import, matching the existing bounded public-key
  coordinate contract.
- Bound browser and mobile DPoP proof methods, URLs, and access tokens before
  URL parsing, hashing, or signing. Shared verification now applies the same
  access-token and normalized-URL ceilings, and relay proof errors retain only
  bounded method and URL diagnostics.
- Reject oversized Clerk session tokens before relay use, and recheck the
  active account after the asynchronous token read so an account switch cannot
  let an in-flight deregistration unlink the previous account's environment.
- Reject oversized relay origins before trimming or URL parsing, and retain
  only a bounded URL in a disabled relay client and its diagnostics.
- Make latest-value client command lanes share one pending promise. A slow
  active command can still coalesce arbitrarily many refresh requests to the
  newest input, but no longer retains one resolver closure per caller while it
  waits; every coalesced caller observes the same latest result as before.
- Frame-coalesce composer command-menu geometry reads across captured scroll,
  resize, ancestor resize, and panel-animation bursts. The initial layout still
  measures synchronously, while later events perform at most one layout read
  and state update per animation frame and cancel the pending frame on unmount.
- Serialize asynchronous diff-worker theme writes per worker pool. Rapid
  appearance changes can no longer let an older `setRenderOptions` settlement
  overwrite the newest theme, and a rejected write no longer poisons later
  synchronization.
- Reserve pull-request checkout preparation synchronously rather than relying
  on a later React pending render. Duplicate Enter/click events cannot prepare
  two checkouts, an unmounted dialog cannot navigate from a late result, and a
  failure opening the prepared draft now has visible feedback.
- Reserve pull-request merge/update/close actions, title saves, discussion
  commands, and thread/worktree handoffs synchronously. Same-tick clicks can no
  longer dispatch duplicate host mutations or create parallel draft checkouts;
  pending state is target-scoped, every outcome releases it, unexpected
  rejections are visible, and an old pull request cannot settle UI into the one
  now open.
- Expire inactive cross-environment pull-request list and statistics aggregation
  atoms after five minutes. Changing filters, pages, or environment sets no
  longer retains every derived JSON-keyed query graph for the page lifetime.
- Fence canvas tab/window captures to the owning thread generation and
  version concurrent re-captures per image node. Late results after a route
  change are ignored, an older capture cannot overwrite a newer one, removed
  nodes stay removed, and the final bitmap replacement re-reads the current
  node so moves, renames, and grouping changes made during capture survive.
- Give global new-thread and new-canvas shortcuts one synchronous reservation
  with visible rejection feedback. Keyboard repeat and same-tick duplicate
  events can no longer start multiple drafts or leak a rejected navigation
  promise.
- Reserve primary pairing credential submission before React rerenders and
  keep a successfully consumed one-time credential reserved through the route
  transition. Automatic and manual submission can no longer exchange the same
  token concurrently or update an already-unmounted pairing surface.
- Reserve pull-request comment posting, description/comment edits, thread
  resolution, pagination, reviewer requests, and final review submission
  synchronously, clear their pending state on every outcome, and ignore late UI
  settlements after their target changes or tears down.
  Optimistic reactions now merge concurrent emoji changes, carry complete
  target identity, reconcile after failures, and use per-reaction request
  versions so an older failure cannot erase a newer toggle or leak state into
  another pull request. Transient review drafts and diff state now use an exact
  environment/project/repository/number tuple instead of colliding across
  matching projects on different connected environments. The detail panel's
  title/action/refresh scopes and live-refresh throttle use the same complete
  identity, preventing one environment from suppressing or inheriting another
  environment's in-flight UI state.
- Bound one submitted review to 100 inline comments at the shared wire
  contract. GitHub can no longer receive an arbitrarily large JSON/stdin body,
  and GitLab or Bitbucket can no longer be asked to run an arbitrary number of
  sequential host mutations from one RPC. The web draft store enforces the
  same ceiling at admission, preserves every accepted draft, and gives visible
  feedback when the reviewer must submit or remove one before adding another.
- Put the workflow-script inspector's existing 256 KiB read ceiling into the
  shared request/result contract and bound its client-supplied absolute path to
  32 KiB. A malformed client can no longer send a WebSocket-sized path into
  filesystem resolution and reflected errors, and a nonconforming server or
  replay cannot hand clients an unbounded script body.
- Apply the thread-search request's 50-row ceiling to its response schema as
  well, so replayed, proxied, or nonconforming responses cannot bypass the
  synchronous SQLite query's intended end-to-end bound.
- Replace literal NUL and unit-separator bytes embedded in ChatComposer,
  session logic, and the activity projection TypeScript sources with ordinary
  `\0` and `\x1f` escape sequences. Runtime tuple-key semantics stay
  identical, while search, diff, review, and editor tooling no longer
  classifies source as binary or stops scanning at a separator.
- Read agent-instruction files through the shared descriptor-owned bounded
  reader and probe one byte beyond the one-MiB response ceiling. A file that
  grows between its metadata read and body read can no longer return a stale
  prefix marked as complete; the actual opened stream now decides truncation.
- Remove a dead preview loading hook and a dead theme-editor helper.

### Desktop

- Serialize main-window creation and ensure main-only activation, zoom, menu
  actions, and fullscreen state reads cannot accidentally target
  picture-in-picture or auxiliary windows.
- Walk past stale destroyed windows when selecting an Electron fallback window,
  skip already-destroyed windows during shutdown, and skip destroyed renderer
  contents during broadcasts instead of aborting delivery to later live
  windows. Native folder and file pickers now fall back to an application-owned
  dialog when their requested owner has already been destroyed. Native menus
  skip owners whose window or renderer has already died instead of turning a
  stale context-menu request into a main-process defect. Fullscreen and
  hold-to-quit notifications likewise skip a destroyed renderer and contain a
  raced synchronous send failure.
- Keep a cold hidden main window unthrottled only until its first reveal, then
  restore Chromium background throttling.
- Ignore activation once quit has begun and flush window bounds while logging
  cleanup failures instead of abandoning the rest of shutdown. Renderer
  destruction remains on the existing lifecycle path so unload handlers still
  get a chance to persist drafts and edits.
- Recreate the updater UI after a failed install handoff so a recoverable
  failure does not leave the application permanently hidden.
- Keep committed updater state alive when a renderer disappears during its
  broadcast, so one raced Electron send cannot terminate updater event or poll
  handling. Packaged GitHub generic feeds now require HTTPS; the explicit
  localhost mock-update path remains available only through development
  configuration.
- Replace independent updater check, download, install, and channel flags with
  one atomic mutation reservation. Simultaneous actions can no longer all pass
  their preflight checks, channel writes are serialized with native updater
  configuration, and the channel-to-check transition retains ownership without
  opening a race window. Functional updater-state reductions now use one
  atomic read/modify/write as well, so concurrent native callbacks cannot erase
  a newer error or progress transition with a stale snapshot. State commits
  and renderer broadcasts share a small critical section, preventing a slow
  older send from landing after a newer error and rolling the visible UI back.
- Restrict renderer-opened external targets to ordinary web URLs or a narrow
  VS Code Remote SSH deep-link shape; reject arbitrary editor commands and URL
  userinfo.
- Propagate custom-protocol request cancellation to Electron's target fetch and
  stop transient retries after abort, so renderer navigation cannot leave an
  orphaned backend request running.
- Preserve the configured backend origin when proxying custom-protocol paths.
  A renderer pathname beginning with `//host` is now assigned as a pathname
  component instead of being resolved as a network-path URL, so it cannot
  redirect the privileged protocol proxy to an attacker-selected origin.
- Release closed main-window references from both preview capture and bounds
  persistence after the final durable bounds write completes, with identity
  checks so delayed cleanup cannot clear a replacement window.
- Validate restored main-window bounds against each display's usable work area,
  not its taskbar/dock-covered physical bounds. The WSL connecting splash now
  awaits and contains load failures, clears itself with an identity fence, has
  screen-reader status semantics, and disables spinner motion when the OS asks
  for reduced motion. The browser picture-in-picture document also declares
  its English language for assistive technology.
- Queue at most 16 distinct menu actions behind one main-frame load dispatcher
  per WebContents, coalescing duplicates and detaching on success, main-frame
  failure, destruction, or window close instead of accumulating one listener
  per click.
- Latch the first normal quit synchronously so repeated `before-quit` events do
  not start duplicate shutdown waiters, consume a failed shutdown promise while
  still allowing Electron's fail-open quit, and let a repeated native quit act
  as the force path if graceful cleanup never settles. Dock activation is
  skipped after shutdown has begun. Concurrent relaunch requests now atomically
  claim that same quitting state inside their detached sequence, preventing
  duplicate shutdown, relaunch, and exit calls.
- Retry backend child-log initialization after a transient filesystem failure
  by caching only successful writers; failed calls remain no-op for that call
  without disabling logging for the rest of the app session.
- Bound fatal-startup messages at 4 KiB and stack detail at 64 KiB before they
  reach native error dialogs or logs, and tolerate defects whose string
  coercion or stack getter throws while startup is already failing.
- Route screencast frames directly to their active tab, acknowledge dropped
  frames, cap delivery near 12 fps, validate the active source after webview
  replacement, and clear per-tab automation history on close.
- Validate screencast dimensions and encoded size before treating a CDP frame
  as healthy or allocating its decoded copy, and enforce the shared frame byte
  ceiling on capture fallback output too. Malformed frames no longer keep the
  bounded capture fallback suppressed, and global recording/PiP teardown no
  longer creates an unbounded queue of serialized cleanup fibers.
- Enforce the same 1600-pixel and 8-MiB ceilings in the desktop recording-frame
  IPC contract, with finite timestamps and MIME metadata. Preview tab-image
  dimensions are checked against their existing 8192-pixel request ceiling.
  Automation snapshot screenshots stop at 1280 pixels and 12 MiB of base64 in
  both main-process encoding and the host contract before the MCP adapter can
  allocate decoded image bytes.
- Validate annotation screenshots as PNG data URLs capped at 48 MiB, 3840
  pixels per edge, and the existing 3840-by-2160 viewport-area budget before
  renderer IPC; main-process capture downscales to those dimensions and rejects
  an oversized PNG before allocating its base64 string. Annotation payloads
  now also cap the multiplicative totals at 65,536 stroke points and one MiB of
  style-change characters, mirrored by both the guest picker and manual IPC
  validator.
- Remove a failed `devtools-closed` listener, restore browser control after a
  synchronous DevTools-open failure, and avoid accumulated stale callbacks.
- Replace a detached preview guest's tab-owned popup handler with an inert
  deny-only handler so guest replacement cannot retain stale navigation
  ownership.
- Treat main-window frame capture as a lifecycle: closing the active window
  blocks raced recording starts and drains recording and picture-in-picture
  capture; a delayed close event from a replaced window is ignored.
- Turn background throttling into one shared capture lease: only the first
  capture disables throttling, the final stop restores it with bounded retry,
  replacement windows reconcile before publication, and failed first-session
  setup rolls back the lease without hiding the original error.
- Close a synchronized initialization self-deadlock in frame capture: failed
  initialization now releases its locally owned scope and main-window lease
  only after leaving the state lock, while preserving the original failure.
- Make failed first-capture rollback and final-capture window reveal atomic
  with the shared capture-session set, so a concurrent successful capture
  cannot have throttling restored underneath it.
- Restrict the development dock-icon override to unpackaged builds, add the
  missing dock-icon service field, and update the desktop settings fixture for
  `favoriteSkillIds`, restoring compile-only coverage. Legacy desktop userdata
  is now reused only when its path is an actual directory, so a stale regular
  file at that name cannot redirect Electron's database and cache roots into an
  unusable path.
- Bound preview annotations at both the contracts and guest-IPC boundaries:
  selected elements, regions, strokes, stroke points, style changes, stack
  frames, and attacker-controlled strings now have explicit budgets. The
  picker enforces the same limits while authoring, caps marquee DOM scans, and
  appends stroke points in place instead of copying the entire growing stroke
  on every pointer move. Main-process screenshot crops are clamped to the
  supported viewport dimension and pixel-area budget before reaching
  Electron's capture API. Canvas-style full-tab image capture also has an 8192
  pixel hard ceiling in both IPC schema and main-process code, preventing a
  renderer from asking `nativeImage.resize` for an allocation of arbitrary
  dimensions. Preview tab IDs and navigation URLs are bounded too, while
  desktop-capture kind lists, source IDs, thumbnail sizes, and final capture
  dimensions now enforce the limits the main process already clamps to.
- Bound browser-automation snapshots before page content reaches durable UI or
  RPC state: navigation metadata, diagnostic strings, console argument work,
  timeline errors, interactive-element traversal, and visible-text traversal
  all have finite budgets. Accessibility collection requests a finite CDP
  depth and retains at most 2048 nodes within a one-megabyte aggregate budget,
  avoiding an unrestricted AX-tree and full-DOM materialization on adversarial
  or extremely large pages. Snapshot PNGs now scale by their longest edge, not
  just width, so narrow portrait captures cannot bypass the 1280-pixel bound.
- Enforce wire-schema budgets for browser selectors, typed text, wait text,
  environment-relative paths, key names, modifier and operation arrays,
  request IDs, request deadlines, and remote error messages. Closed preview tab
  lifecycle generations are released while a global monotonic generation keeps
  late registrations from matching a recreated tab.
- Retain only the latest 32 desktop power and thermal events while a telemetry
  sample is busy. Current power state is polled on the next sample, so an OS
  event burst no longer creates an unbounded queue without losing recovery.
- Retain at most 256 Electron process metrics per telemetry sample, bound
  process names, reject non-finite metric values at the wire contract, and
  normalize invalid idle and speed-limit readings before JSON encoding.
- Keep draining WSL command output while retaining at most one MiB per shell
  stream and 64 KiB for small discovery commands, so a verbose source build or
  hostile distro cannot grow desktop memory without limit. Bound the stable
  per-distro home cache to 32 recently used entries.
- Stream packaged WSL server-tree extraction through 64 KiB file chunks instead
  of retaining as many as eight complete bundle files at once, and bound the
  extraction marker before decoding it.
- Enforce generous IPC ceilings for desktop environment IDs, SSH targets,
  URLs, bearer credentials, request IDs, passwords, and prompt text. External
  askpass fields are truncated before renderer delivery, and at most 16 SSH
  password prompts may remain pending for the three-minute response window.
- Bound advertised-endpoint metadata, URLs, manual configuration fanout, and
  the aggregate desktop IPC result while preserving existing endpoint IDs and
  ordinary HTTP, HTTPS, WS, and WSS values. Credential-bearing endpoint URLs
  are rejected before renderer exposure, malformed LAN-host overrides fall
  back to a usable interface, raw or bracketed IPv6 overrides are canonicalized
  to URL-safe bracketed hosts, and oversized comma-list segments are skipped
  without truncating them into different URLs. Equivalent manual URLs are
  deduplicated after normalization to prevent repeated rows and React key
  collisions, and secure WebSocket inputs inherit HTTPS compatibility.
- Limit preview-session cache clearing, updater backend recovery/snapshot/stop,
  and normal desktop-shutdown backend work to small concurrent batches instead
  of fanning out across every configured environment at once.
- Bound desktop connection-catalog IPC at four million characters and reject
  encrypted catalog files above 20 MiB before allocation. Reject a write when
  its encrypted JSON envelope would cross the same ceiling, and serialize
  catalog reads, writes, clears, and legacy migration so overlapping renderer
  persistence requests cannot reorder or resurrect cleared state. Client settings,
  legacy environment registries, app settings, update metadata, server
  observability settings, package metadata, and pre-ready Linux settings now
  have finite file-read budgets as well. Client settings and the legacy
  environment registry now include their persisted trailing newline in the
  write ceiling, and oversized legacy registries are rejected before they can
  create a file the next read must refuse.
- Serialize legacy saved-environment read/modify/write mutations so concurrent
  registry and secret changes cannot overwrite one another. All desktop
  settings/catalog atomic writers now remove abandoned temporary files after
  either a failed write or failed replacement.
- Bound native menu IPC to three finite levels, contract-sized labels and IDs,
  and small per-level counts instead of decoding an arbitrarily deep recursive
  renderer payload. Folder paths, URLs, credentials, environment bootstraps,
  theme-file selections, and WSL distro lists now have explicit bridge limits.
- Limit desktop source enumeration to 128 entries and a 24 MiB aggregate image
  budget before screenshots cross IPC. Individual thumbnails, icons, and
  captures have finite encoded-size budgets, and source capture is capped at a
  4096-pixel edge rather than asking Electron to render every window at an
  8192-pixel thumbnail size.
- Bound updater versions, release-note groups, items, messages, and source text
  before normalization or IPC. Release-note processing now stops after a small
  candidate budget instead of filtering and rewriting an arbitrary remote
  array before taking the first six groups.
- Contain failures from detached window/menu/quit and second-instance reveal
  actions instead of allowing rejected Electron work to become unhandled
  promises, and stop Linux `xdg-mime` URL-handler registration after ten
  seconds so best-effort desktop integration cannot hold startup indefinitely.
- Re-check that the owning BrowserWindow is still live before an asynchronous
  hold-to-quit preference read can quit the application. Closing a window while
  that read is pending can no longer turn its late failure or disabled result
  into a surprise application quit.
- Retain at most 256 KiB from login-shell and PowerShell environment probes
  while continuing to drain both process streams, so verbose or hostile shell
  profiles cannot grow startup memory or block on an unread stderr pipe.
- Read selected theme JSON through the desktop bounded-file helper after the
  preliminary size check, closing the stat/read race where a replaced or
  growing file could allocate arbitrarily before crossing renderer IPC.

### Mobile and release automation

- Bound notification, quick-action, and active-thread route identifiers before
  percent decoding/encoding and navigation, preventing malformed native input
  from allocating or retaining arbitrarily large paths or dedupe identifiers.
- Resolve adaptive workspace layout from the topmost non-overlay route and
  fall back to Home when a cold deep link contains only sheet routes. A
  Settings, Connections, onboarding, or thread-settings sheet can no longer be
  mistaken for the underlying workspace and flip split-view selection during
  initial navigation hydration.

### Web route resilience

- Made root-level thread and draft route parsing bounded and non-throwing, so
  malformed percent escapes cannot crash the scenery host and encoded
  environment ids resolve consistently with encoded thread ids.
- Reject non-canonical or oversized thread and draft route identifiers before
  they enter scoped query keys or client-side draft lookups.
- Restore pending path attachments when the fully composed provider prompt
  fails local validation; previously that early return silently removed every
  attached-file chip before any send attempt existed to restore it.
- Bound Open VSX theme-search terms in both the input and request helper so a
  pasted or programmatic megabyte-scale query cannot construct an oversized
  URL or retain an unnecessarily large controlled input.
- Validate the browser's persisted background-activity client id against the
  shared wire limit before reusing it, replacing corrupt values instead of
  making every periodic activity report fail contract encoding.

- Reject oversized persisted mobile DPoP private coordinates before base64
  decoding, so corrupt SecureStore data cannot force an unbounded allocation.
- Bound mobile background-activity reports to four environments and ten
  seconds per request so one offline connection cannot prevent every lease
  renewal. Cloud environment status refreshes now fan out at six requests
  instead of one request per linked environment simultaneously.
- Stop a branch refresh from re-triggering forever when its own request
  changes the query atom, and remove eager inspector diff prewarming.
- Split compact and split-view home route components so split view does not
  mount compact-only subscriptions and hooks.
- Compile showcase capture machinery out of normal production behavior behind
  one explicit capability gate.
- Persist incoming shared images as app-owned preview files instead of embedding
  multi-megabyte base64 values in every inbox JSON read. Rehydrate compact
  records, migrate legacy previews, drop missing bytes with a warning, roll
  back created files if the durable write fails, and write inbox JSON
  atomically.
- Keep native share payloads until the durable inbox transaction commits, then
  clean temporary sources. Preserve them on write failure so a foreground
  retry remains possible.
- Return the exact attachments skipped by composer limits and delete only
  those preview files after inbox consumption succeeds.
- Validate picker and native-paste limits against decoded bytes, prefer the
  native MIME type for opaque Android content URIs, reject unsupported HEIC
  rather than mislabelling it as PNG, and surface picker/native-paste overflow,
  unsupported-type, size, and read errors in all three composers.
- Enforce the eight-image contract at the latest atomic composer commit so
  concurrent picker/paste imports cannot race past it. Clean only unreferenced
  overflow previews while retaining the deliberately uncapped recovery path
  for a failed durable outbox write.
- Treat transient composer-draft read, decode, and hydration failures as real
  load failures instead of an empty draft set. Saves wait for a successful load
  and snapshot fresh state afterward; missing files are pruned, while transient
  attachment reads remain retryable.
- Make explicit composer flush perform one final current-state write even when
  no debounce timer remains, covering an earlier swallowed best-effort failure.
  PR handoff now requires successful draft hydration and refuses navigation
  with a visible error when persisted state cannot be loaded.
- Generation- and focus-fence PR handoff after hydration before draft mutation,
  alerts, or navigation, so an older request cannot overwrite a newer route's
  draft. Pairing attempts use the same attempt ownership and URL check before
  navigation or clearing pending UI.
- Complete every fallible incoming-share inbox read before its durable consume
  delete so a successful removal cannot be reported as a failed operation.
- Make atomic-file staging unique per concurrent write and clean the staging
  file after write or rename failure.
- Sweep only the numbered atomic-write staging-file pattern when the draft,
  inbox, and outbox stores load, reclaiming crash leftovers without touching
  ordinary JSON or preview files.
- Renew unchanged mobile background-activity leases before the server TTL while
  still coalescing duplicate event bursts.
- Serialize mobile device-ID creation, cache an ID only after successful
  persistence, and use a process-local fallback activity client ID instead of a
  shared constant when storage is temporarily unavailable.
- Give the JavaScript source-file fallback pull-to-refresh parity and one
  bounded recovery attempt when a requested deep line has not been measured.
- Invalidate recycled mobile rows from explicit external state across source
  and file browsers, pull-request lists/conversations/reviewers, New Task
  project/environment/branch pickers, Git sheets, and thread-feed focus.
  Asynchronous syntax tokens, selections, pending/disabled state, accessibility
  state, and focus-gated elapsed timers no longer wait for list data identity to
  change before repainting.
- Key signed message-attachment preview caches by stable environment,
  attachment, and variant identity. A refreshed capability URL now reuses the
  same memory/disk preview instead of creating another cache entry and download;
  local composer previews retain their own URI key so they cannot poison the
  remote preview cache.
- Virtualize pull-request detail collections and the New Task project chooser,
  retaining native headers, refresh behavior, row actions, and empty states
  without eagerly mounting every high-cardinality row.
- Bound review-diff prewarming to the two nearest sections, schedule one per
  idle period, and cancel it when the review route loses focus.
- Reclaim review-comment preview files on dismissal, delete images produced by
  picker/paste work that finishes after ownership is lost, and prevent late PR
  comment or environment-pairing completions from popping or replacing a newer
  mobile route. Native sheet dismissal now clears only the exact diff selection
  it owned, so an old sheet cannot erase a newer comment target.
- Coalesce incoming-share refresh bursts with one trailing pass so a share that
  arrives during ingestion is not stranded until the next foreground event.
- Evict outgoing-preview presentation entries without deleting their files;
  copied drafts and durable outbox items may still own the same URI.
- Abort both automatic and user-requested OTA restarts when draft/outbox flush
  fails, retain the pending update, restore retryable UI state, and surface the
  failure through the normal callback.
- Retry a transient persisted-outbox load on the next foreground transition and
  immediately before a new enqueue. Successful loads remain memoized, so normal
  resumes add no storage work.
- Make environment-storage deletion interruption-safe and two-phase: unlink
  every owner before removing a shared worktree path, withhold thread deletion
  when removal fails, and display unknown dirty status distinctly from clean.
- Checkpoint and vacuum SQLite after explicit environment/all-client-cache
  clearing so deleted payload pages are returned to the OS; a temporarily busy
  compaction is logged without turning the already-committed delete into a
  misleading failure.
- Stop PR-detail polling while the app is inactive, refresh once on foreground,
  and skip a scheduled refresh while either live query is already pending.
- Bound abandoned mobile thread-open performance marks, pending terminal launch
  payloads, and remembered terminal grid sizes so cancelled navigation and a
  long session cannot retain every historical target.
- Limit opportunistic workspace-file prewarming to four concurrent read and
  highlight operations. Keep each key and slot owned until its query actually
  settles instead of treating a timeout as cancellation; opening a file still
  performs its authoritative load, while a stuck or rapid preload burst can no
  longer grow without bound.
- Prune accepted Live Activity push tokens as soon as their one-minute dedupe
  value expires and cap the recent-token window at 32 entries; an eviction can
  only cause a harmless extra registration replay.
- Add accessible names, button roles, expanded/busy state, and disabled state to
  previously unlabeled connection, terminal, review-comment, Git, and relay
  refresh controls, plus the native Connect-close and environment-add toolbar
  buttons. Connection details now announce the visible URL, status/error, and
  trace identifier rather than hiding descendants behind a generic row label.
- Validate iOS hardware-keyboard event payloads against the exact command set
  exposed by the current JavaScript screen. Malformed, unknown, or stale native
  commands can no longer dispatch navigation or contextual actions.
- Match Expo development-client and share-extension lifecycle links by their
  exact URL host. A legitimate route that merely contains either reserved host
  name is no longer silently discarded before React Navigation sees it.
- Bind pull-request avatar load failures to the exact URL that emitted them, so
  a late error from a recycled row cannot hide the replacement actor image.
- Hide malformed pull-request diff counts instead of formatting negative,
  fractional, infinite, or `NaN` host values into misleading UI.
- Add button/link semantics to shared empty-state actions and fallback markdown
  links. Android header controls and Settings rows now expose disabled state,
  while Settings rows also announce their visible current value.
- Mark the What's New surface as modal for assistive technology and group the
  project-grouping choices as one named radio set, keeping VoiceOver traversal
  within the active presentation and preserving the choices' checked state.
- Preserve compact Home search/project filters through split-view transitions,
  while keeping its expensive subscriptions compact-only. Retained inspector
  panes now receive stable React nodes keyed to real thread/workspace identity,
  so ordinary shell updates no longer remount the file tree and erase search,
  expansion, list position, or focus state.
- Chain World Scenery first-sight assignment patches synchronously so restored
  back-stack routes cannot overwrite same-tick assignments. Refresh the daily
  photo at local midnight and on foreground with one lifecycle-suspended timer.
- Serialize Live Activity preference mutations at the Settings switch, restore
  the truthful prior state on failures, and cap environment relink/rollback
  fanout at four requests instead of launching every environment at once.
- Retain only 64 validated Connect onboarding opt-out account ids and reject
  oversized markdown destinations before URL parsing or percent decoding.
- Bound controlled Home, split-sidebar, archive, file-browser, pull-request,
  reviewer, and model-picker search terms to their 200-character wire
  contract, with defensive RPC-hook clamps. New Task branch and composer path
  searches likewise stop at their 256-character contract.
- Normalize and reject oversized mobile file-route paths before joining route
  segments or issuing a file RPC, matching the 512-character read-file
  contract instead of allowing an external route to allocate an arbitrary
  intermediate path.
- Apply the shared host, token, and URL ceilings at the Add Environment native
  inputs and QR/development-route parser, so oversized pairing material never
  enters controlled state or URL parsing merely to be rejected downstream.
- Put Clerk session-token acquisition behind the managed-relay ten-second
  deadline for relay activation and Live Activity preference mutations, so a
  stalled native auth bridge cannot pin those operations indefinitely.
- Cap every mobile composer draft set, append, restore, and merge at the
  provider's 120,000-character input contract. Oversized persisted drafts are
  normalized during hydration, further keystrokes at the ceiling become
  no-ops instead of rewriting the full drafts JSON, and both existing-thread
  and New Task composers surface the limit when native input crosses it.
- Stop indeterminate send, loading-strip, and connection-status animations
  after a few cycles and leave a static progress affordance, avoiding perpetual
  UI-thread/GPU work when a mobile network operation remains stalled.
- Retain only the 50 most recently refreshed VCS-ref snapshots per environment
  in the mobile SQLite cache. Visiting new projects and worktrees no longer
  grows branch-list storage for the full lifetime of an environment; pruning is
  best-effort so housekeeping cannot turn a successful refresh into an error.
- Retain at most 256 inline mention/skill chips in the native composer while
  preserving the complete source draft. A valid long prompt can no longer ask
  UIKit or Android to create tens of thousands of native token attachments and
  rendered chip images merely for presentation.
- Bound development terminal input diagnostics to a 32-code-point prefix, and
  skip building that diagnostic entirely when terminal debugging is disabled.
  A large terminal paste no longer creates another full array of character
  codes before the input is sent.
- Reject malformed Android native-terminal frames before allocating cell
  arrays: decoded grids must fit the surface's 400-column by 200-row contract
  and the payload must contain every fixed cell header.
- Clear development review performance marks and measures after reporting them,
  so repeated parsing, highlighting, and diff-ready events do not grow the
  runtime performance timeline for the lifetime of a Metro session.
- Normalize and bound every mobile pull-request deep-link environment,
  project, repository, number, file path, and reply-thread component before it
  becomes a query key or RPC input. Invalid links now stay on the existing
  not-found state instead of retaining arbitrary route text.
- Give composer attachment preview/remove controls explicit image/button
  semantics and accessible names, including a truthful preparing state.
- Keep legacy mobile connection migration within the current 1,024-record
  catalog schema and skip fields the new catalog cannot re-encode. One old or
  oversized record can no longer make otherwise valid saved connections fail
  their post-migration write.
- Cancel native-composer settings-sheet opening/focus frames and the focus
  retry timer when the sheet closes, reopens, or its owner unmounts, rather
  than waking guarded callbacks after their presentation is obsolete. A native
  keyboard-dismissal failure is contained as well.
- Bound showcase-runner pairing input to 16 URLs of at most 8,192 characters
  and reject oversized encoded/JSON payloads before decoding or parsing them.
- Reset native review comment-collapse state when its thread or section
  changes, so a reused comment id on another target cannot start hidden.
- Clear the global native-review comment selection when its section controller
  changes or unmounts, releasing the selected file-line graph instead of
  retaining it until some later review happens to overwrite the target.
- Contain rejected Expo haptic promises across clean menu, thread, swipe,
  pull-request, and Git-progress interaction paths. Missing native feedback can
  no longer surface later as an unhandled JavaScript rejection.
- Scope mobile web and image preview component lifecycles to the active URI.
  Loading/error and full-screen state, plus late native callbacks, can no longer
  leak from the previously viewed file into its replacement.
- Reset the reusable mobile copy button's transient success label and timer when
  its text changes, so replacement content is never announced as already copied.
- Subscribe to checkpoint-diff RPC state only while its turn is the selected
  review section, and clear that turn's loading flag on selection change or
  unmount. Persisted Git-section selection no longer fetches an unrelated turn
  diff or leaves a cancelled turn looking permanently busy.
- Memoize archived-thread environment filter models and native menu elements
  independently of search text. Typing in archive search no longer rebuilds up
  to the full 1,024-environment catalog worth of menu rows per keystroke.
- Make imperative app-menu and confirmation-dialog presenter teardown
  ownership-aware, so cleanup from a replaced host cannot unregister the newer
  root host during Strict Mode or refresh transitions.
- Order pull-request conversations/lists, incoming shares, outbox/pending
  tasks, Live Activity rows, and thread-feed cutoffs by parsed instants rather
  than ISO spelling, so mixed offsets or fractional precision cannot misorder
  or hide mobile rows.
- Expand mobile release workflow path coverage to shared assets and public
  configuration inputs (including `.env.example`), and accept the canonical
  `T3CODE_APPLE_TEAM_ID` variable with the legacy name as a fallback.
- Treat only the post-submit local iOS production fingerprint as delivery
  proof. A finished or in-flight hosted EAS build no longer suppresses the
  local TestFlight build, and deterministic fingerprint recovery now runs
  before Xcode/TestFlight work rather than after a delivered IPA.
- Pass the OTA release message through a quoted step environment variable
  instead of interpolating it into Bash, closing command substitution through
  an otherwise valid tag message.
- Upload every Origin release asset before pushing the remote tag, keeping the
  tag as the completion marker instead of publishing a release that is still
  missing artifacts.
- Restrict generic desktop updater feeds to HTTPS in both release-forge and
  artifact-build paths.
- Run the mutable Origin installer with a minimal environment allowlist so
  release credentials are not exposed to its shell; the installed CLI receives
  only the credential it needs for its subsequent operation.
- Split Origin authentication, S3 tool preparation, and public publication into
  separate credential scopes. Origin and release Git children inherit only
  network and user basics, Depot receives only its dispatch token, and AWS
  receives only its standard credential/config family, so no child tool or Git
  hook can read another publisher's secret. Known credential values are also
  redacted from captured child-process errors.
- Correct the mobile README: JS-only releases publish OTA without needlessly
  occupying the Mac runner; native iOS fingerprint changes trigger TestFlight,
  while Android store binaries are not yet wired into this fork workflow.
- Leave the upstream release workflow unscheduled in this fork. Its
  schedule-only detector belongs to `pingdotgg/t3code`; T3 Pretty scheduling
  remains in the fork-owned release and upstream-sync paths.
- Preserve the existing non-cancelling workflow concurrency groups without
  `queue: max`. That key is not supported by the pinned Buildkite GitHub
  Actions importer, whose queue already retains waiting entries; native sync
  also has an explicit Buildkite concurrency group.
- Require complete Apple signing, notarization, team, and provisioning-profile
  prerequisites before the official workflow builds either macOS updater.
  Missing prerequisites now stop publication instead of silently changing the
  public artifact's trust model; Windows and Linux behavior is unchanged.
- Write decoded Apple keys, certificates, and provisioning profiles with mode
  `0600`, and remove their exact runner-temp paths on every desktop build exit
  and after mobile submission so a failed persistent-runner job cannot leave
  reusable signing material behind. Apple key IDs must now be filename-safe;
  mobile cleanup derives the exact runner-temp path instead of trusting a value
  that the pulled EAS environment could replace.
- Remove the exact pulled production `.env.local` path with `always()` cleanup
  in both mobile jobs, including the persistent iOS runner failure path.
- Scope Cloudflare and Vercel credentials to their exact release steps, Apple
  credentials to macOS matrix entries, and Azure credentials to Windows
  entries instead of exposing every release secret to setup and every OS.
- Load relay tracing state through one 64 KiB parser that requires the exact
  three keys once, non-empty control-free values, and a credential-free HTTPS
  endpoint. It writes only canonical entries to `GITHUB_ENV` and escapes the
  token before issuing the masking workflow command.
- Retain at most 8 MiB from each `git tag --list` stream while continuing to
  drain it, fail closed on overflow, and select the previous stable/nightly tag
  in one pass without changing equal-version ordering.
- Fail closed when Origin cannot find the exact requested pull-request head or
  when merge arguments contain only option values, preventing automation from
  editing or merging an unrelated pull request.
- Resolve a just-created Origin pull request only among exact open-head matches,
  so reusing an automation branch cannot return an older closed PR with the
  same head name.
- Validate every Origin updater asset, unique object basename, full commit
  target, and pre-existing local tag target before the first upload. Bound
  release-note reads to 1 MiB and keep the remote annotated tag as the final
  completion marker after every updater object succeeds.
- Publish the macOS and Windows blockmaps already collected by the fork build
  jobs instead of dropping them from the final Origin S3 asset array, restoring
  the differential-update files referenced by the updater contract.
- Exclude electron-builder's verbose `builder-debug*.yml` diagnostics from
  official and fork artifact collectors so parallel builds cannot overwrite a
  same-named debug file or publish it beside updater manifests.
- Keep only the final 20,000 characters from desktop build Git/Python probes
  while continuing to drain both streams; a broken or substituted tool can no
  longer grow release-process memory without bound.
- Ask Git once for nightly tags already merged into the fork release commit,
  replacing one `merge-base` subprocess per newer upstream tag while
  preserving version ordering and the integrated-only release contract.
- Drain the fork's sorted tag stream after finding a released changelog child,
  avoiding a short-read producer while skipping all later per-tag Git probes.
- Bound EAS fingerprint inputs, including the committed post-submit marker, to
  64 KiB and normalized fingerprint values to 512 control-free bytes before
  writing workflow outputs, closing shell argument materialization, unbounded
  file reads, and newline-based `GITHUB_OUTPUT` injection paths.
- Bound changelog model success/error bodies to 1 MiB/64 KiB, decode them
  strictly, escape remote failure text before emitting a GitHub warning
  command, and remove the CLIProxy bearer token from every Git child process.
- Pass relay deploy outputs to `github-script` through step environment values,
  normalize and cap their status description, and stop interpolating remote
  output directly into executable JavaScript.
- Bound the entire retried Discord webhook request to 60 seconds and replace
  nested HTTP causes with structured URL-free labels, so transport/status
  failures cannot print the secret webhook path or token.
- Lock the macOS runner registration token to mode `0600`, reject symlinked
  token files, and delete macOS/Windows token files even when JSON parsing
  fails. Windows runner archives now clean up after checksum or extraction
  failures instead of accumulating in the shared temporary directory.
- Pin the EAS keychain compatibility shim to `/usr/bin/security`; pulled Expo
  environment variables can no longer redirect every wrapped signing command
  to an arbitrary executable. Its test now patches an isolated shim copy.
- Bound upstream-sync model responses, cache entries, conflict files, resolved
  files, and reused reports before materializing them; cap report metadata per
  batch, sanitize remote text used in logs, and remove the CLIProxy token from
  every Git child process. Cache checkpoints are mode `0600` atomic renames, and
  conflict-path discovery uses NUL delimiters so unusual Git paths cannot split
  records or inject log lines. Each conflict-model request now times out after
  ten minutes so the existing retry/checkpoint path can recover from a hung
  socket.
- Retain official and fork desktop/WSL/resource-monitor workflow artifacts for
  one day instead of inheriting the repository's potentially month-scale
  default. These artifacts are consumed inside the same run; published updater
  assets remain on their durable release hosts.
- Restore the self-hosted macOS user's exact pre-build keychain search list
  after desktop signing instead of replacing it with the login keychain alone.
  The mobile release likewise records and restores the prior global
  `xcode-select` path after local EAS work, and refuses the global switch when
  it cannot record a safely restorable path.
- Name the post-TestFlight fingerprint branch from a fixed SHA-256 prefix rather
  than provider-controlled fingerprint characters, so an unusual but otherwise
  valid fingerprint cannot make the final Origin push use an invalid ref.
- Read macOS and Windows self-hosted runner registration tokens only from
  regular, non-linked files below 64 KiB, cap the decoded control-free token at
  4096 bytes, and keep the opened file exclusively owned while Windows parses
  it. The macOS reader uses `O_NOFOLLOW`, checks and locks the opened handle to
  mode `0600`, and both platforms still remove the exact one-shot file on every
  parse outcome.
- Canonicalize desktop updater feeds as bounded credential-free HTTPS directory
  URLs. Userinfo, query, and fragment values can no longer be baked into
  `app-update.yml`, silently mis-resolve channel manifests, or reach Origin's S3
  publication path; fork preflight now applies the publisher's exact parser
  before starting the signed builds.
- Validate official release relay hosts as bounded DNS names and cap every
  public Clerk identifier before writing job outputs. Relay tracing release
  state now has per-field ceilings, rejects query/fragment credentials, and
  canonicalizes its HTTPS endpoint before masking or exporting the token.
  Repository `.env`, release-train, and package metadata are read through one
  handle under finite byte ceilings rather than allocated wholesale during
  build bootstrap.
- Compose Origin release notes under the publisher's one-MiB boundary. An
  integration report larger than the remaining budget is clipped on a valid
  UTF-8 boundary with an explicit pointer to the complete checked-in report,
  avoiding a last-step failure after successful signing and artifact upload.
- Validate and canonicalize the fork publisher's S3 endpoint as a bounded
  credential-free HTTPS URL, and bound bucket, region, access-key, and secret
  values before the signed build matrix starts. Query/fragment credentials and
  control-bearing configuration can no longer reach AWS CLI arguments or
  diagnostics. Large uploads use error-only AWS output so progress rendering
  cannot overflow the synchronous publisher's captured-output buffer.
- Validate the fork's downloaded updater manifests as single bounded files,
  require every referenced payload to be a local regular basename with the
  exact declared size and SHA-512, and compare packaged `app-update.yml`
  against the canonical configured feed. Zip extraction stops at 64 KiB and
  requires exactly one metadata entry. The Origin publisher independently
  orders payloads before channel manifests, making partial upload retries safe
  for already-visible platform metadata.
- Canonicalize the release changelog and upstream-sync CLIProxy endpoint as a
  bounded credential-free HTTPS URL (with an explicit loopback-only HTTP
  exception), bound control-free bearer tokens, and redact a token if a remote
  error body reflects it before the diagnostic reaches workflow logs.
- Cap manual OTA messages at 1024 control-free UTF-8 bytes before passing them
  to EAS, and reject oversized or control-bearing stable release version inputs
  before an invalid value can be reflected into GitHub workflow logs.
- Canonicalize the hosted-web router as a credential-free HTTPS origin and
  validate router/latest/nightly aliases as bounded public DNS names before
  passing them to the build or Vercel CLI. Hosted client metadata can no longer
  bake URL userinfo, query credentials, fragments, paths, or custom ports;
  Vercel token, scope, organization, and project inputs are bounded before use.
- Cap the upstream-sync resolution cache at 256 entries and 64 MiB, discard
  invalid or oversized cache objects, and rebuild each checkpoint tree from
  only the retained set so stale hashes no longer accumulate forever. Existing
  cache archives are stream-capped at 80 MiB before extraction. Upstream nightly
  marker files and reused-branch marker blobs are bounded and must match the
  expected tag grammar before reaching outputs or Git refspecs.
- Fail the official release when its macOS architecture manifests are missing
  or belong to different channels, and require the exact macOS, Windows, and
  Linux channel-manifest set before GitHub publication. Manifest reads are
  capped at one MiB and 16 entries; every basename-only payload must be a
  non-linked regular file with the declared size and SHA-512, including both
  macOS architectures and the Windows differential blockmap.
- Reuse that bounded manifest verifier for fork publication as well, so its
  manifest handle is opened with no-follow semantics and its required macOS
  DMG/ZIP (plus Windows installer when present) are checked through the same
  release-asset identity contract instead of a separate inline implementation.
- Apply the same one-MiB no-follow read before official architecture manifests
  are parsed and merged, and keep unsupported lines, conflicting URLs, and
  version values out of parser errors. A malformed artifact can no longer force
  an unbounded allocation or reflect control-bearing metadata into release logs
  before the final verifier runs.
- Revalidate the Origin S3 object key inside the direct upload helper rather
  than trusting only its normal caller, and reject path-like, control-bearing,
  or oversized keys before forming an `s3://` destination. The shared GitHub
  output writer now bounds keys and values and rejects all controls, closing
  newline injection even if a future caller skips its own field validation.
- Validate relay deployment-state URLs, datasets, and tokens before reconciling
  `.env`, masking a token, or creating the cross-job tracing artifact. URLs are
  bounded credential-free HTTPS values, datasets/tokens are bounded and
  control-free, the mask command escapes percent/newline syntax, and the
  token-bearing handoff file is created exclusively with mode `0600`.
- Open the downloaded tracing handoff with no-follow semantics, require a
  regular file, and keep unexpected raw keys or malformed URLs out of loader
  diagnostics. The consumer remains safe even if an artifact is substituted
  before its bounded parser and source-side validation run.
- Bound and reject controls in the Clerk secret before the relay workflow
  constructs its management client, so invalid secret material fails with a
  generic diagnostic rather than reaching an SDK request or nested error.
- Open conflict, report, and resolution-cache inputs with no-follow semantics
  on their bounded handle, and strip every ASCII control from the shared
  one-line diagnostic sanitizer. Unusual Git paths or reflected model text can
  no longer inject terminal escapes into sync logs, including file-read errors.
- Stream resolution-cache directory entries while maintaining only the newest
  bounded candidate set. Pruning no longer allocates an array proportional to
  every restored filename before enforcing the 256-entry/64-MiB policy.
- Refuse cache pruning when its resolved target is the filesystem root, home,
  workspace, `.git`, or the system temporary root. A mis-set cache environment
  can no longer turn invalid-entry cleanup into a broad recursive deletion.
- Copy every caller-provided Origin pull-request body through an eight-MiB,
  no-follow, strict-UTF-8 reader into a mode-`0600` temp file. PR bodies,
  blocked-sync Git index/body files, and release tag-note files are now removed
  by exact path in `finally`, preventing small persistent-runner leaks and
  keeping a body symlink away from the external CLI.
- Collapse all Origin/AWS/Git child-process failures to a control-free,
  single-line 20,000-character diagnostic after secret redaction, and cap
  remote mergeability state at 2,000 characters. Child stderr or remote JSON
  can no longer inject workflow commands/terminal escapes or create multi-MiB
  error objects at the publisher boundary.
- Canonicalize Azure Trusted Signing and timestamp endpoints under finite byte
  ceilings, reject URL credentials, query strings, fragments, controls, and
  unsupported digests, and bound signer identity fields before electron-builder
  hands the configuration to its PowerShell signing adapter.

## Verification completed

- Formatting completed for every changed tracked source file and each new
  source/test file.
- `@t3tools/contracts`, `@t3tools/shared`, `@t3tools/client-runtime`,
  `@t3tools/ssh`, `@t3tools/tailscale`, `effect-acp`,
  `effect-codex-app-server`, `t3` (server), `t3code-relay`,
  `@t3tools/web`, `@t3tools/desktop`, `@t3tools/mobile`,
  `@t3tools/marketing`, and `@t3tools/scripts` all pass final compile-only
  typechecking. Printed diagnostics are non-blocking Effect style suggestions.
- Exact-file lint passes across every audited implementation lane; warnings
  found during the audit were removed before closeout.
- `git diff --check` passes.
- Earlier focused pure tests covered client runtime, Tailscale, SSH, Git branch
  resolution, Ghostty input, and timeline derivation. Additional regression
  tests have been written for later fixes but intentionally not executed. No
  process-lifecycle test is considered valid evidence after the PID incident,
  and none will be rerun in this audit.
- Provider-boundary formatting and targeted lint pass for the shared ACP and
  Codex App Server transports, Codex/Claude/Cursor/Grok/Kimi/OpenCode adapters,
  and their authored regression tests. `effect-acp` and
  `effect-codex-app-server` pass compile-only typechecking, as does the server;
  the latter prints only existing non-blocking Effect style suggestions. No
  provider or lifecycle test was executed.

## Findings deferred for product or architecture judgment

### Highest risk

- **APNs delivery ownership and retry:** lease conflicts and ambiguous delivery
  outcomes can duplicate or strand agent-awareness notifications. This needs a
  defined at-least-once/idempotency contract before changing retries.
- **Unbounded connection buffers:** several server paths can retain
  per-client WebSocket, thread, and shell output faster than a slow or offline
  peer consumes it. In particular, each thread subscription bridges the
  orchestration and ephemeral tool-progress PubSubs through another unbounded
  live queue while its snapshot/replay is loading; merely bounding that bridge
  would move the backlog into the unbounded source subscription. A real limit
  requires choosing drop, disconnect, or durable replay/resnapshot semantics
  per stream.
- **Agent-awareness fan-out:** remote registration work is serialized without
  a clear deadline. A slow endpoint can delay unrelated registrations; the
  timeout and concurrency policy are product-visible.
- **Remote SSH process ownership:** stop/restart now requires the persisted
  managed PID and port to exactly match the live loopback runtime record, and
  successful launch persists the verified server PID rather than its package
  runner. This materially narrows accidental signalling, but a crash-stale
  runtime record plus PID reuse could still match. A durable random ownership
  token or OS start identity must be verified by both the spawned server and
  stopper before signalling; PID and port agreement alone cannot prove
  ownership.
- **Mobile outbox attachment size:** queued turns can persist full base64 image
  payloads (roughly 106 MB at the current count/size ceiling). Moving bytes to
  files needs reference accounting across send, retry, edit, and delete.
- **Revoked WebSocket sessions remain live:** authorization is checked during
  connection setup, but revoking or expiring that session does not terminate or
  revalidate the already-connected socket. A live session lease must define how
  in-flight operations and reconnect are handled.
- **Auth access stream backpressure:** pairing/session change channels remain
  unbounded for every subscriber. A bounded design needs a revisioned
  replay/resnapshot protocol; dropping deltas would make the credential UI lie.
- **Auth credential retention and pagination:** expired, consumed, and revoked
  rows remain in SQLite indefinitely, while more than 1024 concurrently active
  records now produce an explicit management-list error. Cleanup retention and
  paginated access-management semantics need a product decision before records
  can be deleted or partial lists exposed.
- **Browser recording retention:** a capture can retain roughly 4 Mbps of chunks
  plus final copies for an unbounded duration. A duration/byte limit or streamed
  destination needs an explicit product policy.
- **Desktop quit can outrun editor durability:** renderer file-save disposal is
  best-effort, while the main process destroys windows before backend shutdown.
  A close/quit handshake needs a bounded wait and explicit failure UX rather
  than silently risking the last edit.
- **WebSocket attachment transport shape:** the 128 MiB ceiling restores the
  existing eight-image contract for compact data URLs, but a monolithic base64
  turn still creates large transient JSON/string/byte copies and requires a
  correspondingly high per-connection DoS budget. An aggregate encoded-byte
  contract or bounded HTTP upload flow would reduce that ceiling, but changes
  retry, offline-outbox, remote/relay, and attachment-lifetime semantics.
- **Provider backpressure overload UX:** canonical provider and protocol queues
  now apply finite lossless backpressure, while optional raw observers keep a
  finite sliding window. There is still no user-visible stalled-consumer
  diagnostic or overload timeout; adding one requires deciding whether a
  persistently blocked provider should be disconnected, failed, or allowed to
  recover indefinitely.
- **Shared ACP pending requests:** wire queues and raw observers are finite, but
  callers can still create an arbitrary number of concurrent extension request
  Deferreds if the provider remains connected and never answers. A pending-call
  ceiling or universal deadline would reject legitimate provider-specific long
  operations unless request classes gain separate policies.
- **Provider SDK framing and deadlines:** Claude and OpenCode SDKs own their raw
  response/SSE framing before the adapters see decoded events, so this pass
  cannot enforce a per-record byte limit at that boundary. OpenCode cleanup is
  now time-bounded, but prompt, permission, question, and other product-facing
  SDK operations still need per-operation timeout and cancellation semantics;
  one universal deadline would terminate legitimate long turns.
- **OpenCode active-turn cumulative text:** completed/error/interrupted turns
  now release their correlation maps, but one exceptionally long active answer
  still retains cumulative provider snapshots and emitted text. Chunk-only
  reconciliation needs a provider guarantee about late replacement snapshots;
  truncation would silently corrupt the answer.
- **Codex App Server pending requests and callback scheduling:** wire and raw
  observer queues are finite, but concurrent client requests still retain one
  Deferred each until a response or lifecycle termination. Incoming request
  callbacks also run on the ordered reducer and can intentionally wait for a
  human approval; decoupling them needs bounded concurrency plus explicit
  response ordering and shutdown semantics.
- **Codex collaboration registry cardinality:** terminal children are removed,
  but a provider can still announce arbitrarily many simultaneously live child
  thread ids and receiver-turn correlations. Enforcing the configured child
  policy at this inbound boundary needs a truthful overflow event; silently
  treating excess child traffic as parent traffic would corrupt attribution.
- **Opaque native provider event payloads:** canonical presentation fields and
  collection counts are increasingly finite, but the optional `raw.payload`
  remains `Schema.Unknown` and several adapters attach the complete SDK event.
  Removing or structurally truncating it changes diagnostics, replay, and
  auditing expectations; a separate bounded native-log reference is preferable
  to copying multi-megabyte tool output through every persisted runtime event.
- **Codex App Server full-history messages:** the 128 MiB raw line limit fits
  the exact maximum eight-image turn envelope, but `thread/read` requests full
  turns and its upstream schema has no aggregate history ceiling. A sufficiently
  old image-heavy thread can exceed any finite single-line policy; preserving
  it needs upstream pagination or a bounded history response rather than
  raising the local process DoS budget again.
- **Reactor queue backpressure:** orchestration commands/events and the shared
  drainable workers used by deletion, provider-command, checkpoint, and
  provider-runtime ingestion remain unbounded. A safe limit needs a declared
  outcome per event class—producer backpressure, rejection, coalescing, or
  durable replay—because silently dropping structural events would corrupt
  projections or strand receipts.
- **Lifecycle outbox admission:** persistence decoding/encoding rejects more
  than 65,536 queued entries or 16 MiB of JSON, but enqueue does not enforce
  either ceiling before updating the in-memory pending map. Persistence errors
  are logged and swallowed and enqueue still reports success, so memory can
  continue growing while the newest commands are not durable. Admission must
  return a truthful failure or apply a declared per-thread eviction policy;
  silent truncation could reverse the user's last settle/snooze intent.
- **Drainable-worker failure policy:** an unexpected non-interruption failure
  from a worker's processing effect terminates its sole consumer and can leave
  accepted outstanding items waiting forever. Restarting, retrying, skipping,
  or failing every waiter each imply different command/event durability, so
  the shared helper needs an explicit caller-selected policy rather than a
  blanket catch-and-continue.
- **Provider history retention:** prompt and event queues are finite, and
  OpenCode no longer keeps an unused local history, but Claude, Cursor, Grok,
  and Kimi intentionally retain turn snapshots to implement local read and
  rollback. A finite policy needs pagination or a durable provider-native
  history source plus an explicit maximum rollback horizon.
- **Opaque provider resume/event state:** session `resumeCursor` and persisted
  `runtimePayload`, plus several provider-native raw/realtime/account payloads,
  remain intentionally opaque. A recursive generic cap could reject a valid
  provider upgrade or fork cursor, while silently truncating it could resume the
  wrong conversation. Each provider needs a versioned cursor/payload envelope
  and an explicit invalidation/migration policy before these fields can be
  bounded safely.
- **Terminal metadata snapshot cardinality:** individual terminal summaries are
  bounded, but the initial active-terminal array is not. Silently slicing it
  would hide a running shell and make later upsert/remove deltas incoherent;
  this needs pagination or a declared truncated/resnapshot protocol.
- **Projection retention and legacy snapshots:** event history, resolved
  approvals, activities, plans, checkpoints, and archived shells have no
  end-to-end retention or pagination policy. Legacy full-snapshot reads can
  still decode complete histories; deleting or truncating them safely requires
  defining rebuild, audit, old-client, and archive-navigation semantics.
- **Deep thread-pagination copy amplification:** every older-page merge builds
  identity sets over the complete loaded window and reconstructs flat message,
  activity, plan, and checkpoint arrays. Loading many pages therefore performs
  quadratic cumulative copying and briefly retains successive large windows.
  Avoiding that requires a segmented/indexed thread-detail model plus updates
  to web and mobile consumers that currently rely on flat ordered arrays and
  their reference identity.
- **Opaque tool-payload presentation:** activity payloads remain
  `Schema.Unknown`; client presentation walks every entry in a command array,
  joins all string parts, and can retain an arbitrarily large command/query as
  rendered detail. A hostile or old persisted activity can therefore allocate
  and render far more text than its bounded traversal suggests. A finite
  presentation envelope needs an explicit truncation marker/full-detail access
  policy so real long commands are not silently hidden.
- **Fallback tool-activity identity:** activities without an explicit tool-call
  ID persist a group key made by joining provider-controlled label/detail text
  with another legal text character. Distinct tuples can collide and compact
  one another; changing to tuple encoding needs compatibility for already
  persisted projection keys and in-flight legacy updates.
- **Revert projection rewrites:** a thread revert still loads and rewrites all
  messages, plans, activities, and turns so it can preserve checkpoint-linked
  rows and attachment cleanup. Replacing that rare but history-sized path with
  SQL-native deletes needs one transactional design that retains exactly the
  same attachment and turn-link semantics.

### Networking, Connect, and relay

- Automatic stale-relay migration records its attempt key before running and
  never clears it when reconciliation returns `false`. A transient token,
  environment, or relay failure therefore leaves the desktop on the old relay
  until some later input changes or the client reloads. Retrying safely needs a
  visibility-aware bounded backoff; immediately clearing the key can turn a
  persistent failure into a toast and request loop.
- Connect UI results are now account-fenced, but the underlying multi-step
  cloud-link command is not cancelled when Clerk switches accounts. A switch
  between challenge, link, local relay configuration, and preference update can
  still land an old account's link after account cleanup ran. Fixing it needs
  scheduler-level account generations plus a compensating local/relay unlink
  for the phase that already committed; a renderer-only stale-result guard
  would hide rather than repair the partial mutation.
- Settings labels the connected relay action “Disconnect,” but local removal is
  immediately undone by mesh reconciliation. Making it permanent would revoke
  account access and remove the tunnel, so that destructive meaning needs the
  same explicit confirmation already used by the Connect profile page.
- Cloud replay files use permanent local paths and non-atomic writes. Retention,
  encryption-at-rest expectations, and crash recovery should be decided
  together. Safe legacy and hashed guards are currently both retained for
  upgrade compatibility, so a versioned migration/cleanup point is also needed.
- DPoP replay cleanup is driven by one detached in-process timer per accepted
  proof; sustained high request volume can accumulate timers, a stopped server
  leaves expired guard files behind, and there is no startup enumeration or
  migration for older files. Batched expiry should be folded into the broader
  replay-file lifecycle policy.
- Relay DPoP replay rows store JWT `iat` epoch seconds in a PostgreSQL
  32-bit integer. Proof consumption will overflow that diagnostic column in
  January 2038 even though verification still succeeds; migrating it to
  `bigint` (or removing the unused persisted field) needs an explicit database
  migration plan.
- The APNs dead-letter queue is provisioned but has no consumer, alert, replay
  workflow, or documented retention/inspection policy in this repository.
  Per-message retry isolation prevents a poison job from dragging healthy
  neighbors into it, but genuine exhausted failures can still remain invisible
  until an operator manually inspects Cloudflare.
- Relay link, credential, and configuration updates can expose partial state
  across failures; making them transactional may require a schema change.
- Managed-tunnel admission is currently a check-then-reserve sequence, and its
  capacity query counts only allocations already joined to an active link even
  though provisioning reserves the allocation before link upsert. Concurrent
  or interrupted provisions can therefore exceed the configured per-user cap;
  concurrent provisions for the same environment can also race Cloudflare
  tunnel configuration. Correct enforcement needs a database-atomic
  reservation or per-user/per-allocation lock and an explicit loser/retry
  policy.
- Remote and derived environment URLs outside the advertised-endpoint catalog
  currently preserve URL username/password fields. Rejecting userinfo there
  would prevent accidental Basic auth propagation and credential-bearing
  labels/logs, but may break a self-hosted workflow that intentionally embeds
  credentials; the supported connection policy needs to be explicit before
  those broader normalizers strip or reject it. Desktop-advertised endpoint
  URLs now reject userinfo at their narrower renderer boundary.
- Client transport classification still matches broad message suffixes such as
  `disconnected.` and `is not connected.`. A provider, database, or MCP
  business failure with the same wording can be hidden by the web thread view
  or treated as retryable/offline by the mobile outbox. Narrowing the strings
  would miss arbitrary environment-label messages; the transport tag must
  survive into these callers so classification stops depending on prose.
- Managed-tunnel startup reports readiness before all downstream work settles
  and lacks a bounded retry/backoff policy.
- Activity records can regress when events arrive out of order, and deletion
  can erase a newer state without a generation check.
- WebSocket compression may spend disproportionate CPU on already-compressed or
  tiny payloads; disablement needs traffic measurements.
- Some keyed semaphores outside the provider adapters still retain keys
  indefinitely. A safe eviction rule must not split mutual exclusion while
  waiters still exist.
- Legacy full thread and archived-shell snapshots can consume or exceed the
  128 MiB WebSocket ceiling because pagination is opt-in for newer clients. A bounded
  compatibility or HTTP snapshot contract is needed before older clients can
  be forced onto pagination.
- Terminal process-event delivery can grow behind a slow listener. Coalescing
  output and lifecycle events needs an overrun/replay contract so a bounded
  queue cannot silently lose terminal state.
- The bounded workspace directory browser returns the first 200 native-order
  matches and then sorts that subset; global lexical ordering across a larger
  directory would require a bounded selection structure or pagination.
- Workspace writes reject stable symlink escapes, but a hostile concurrent
  symlink swap between canonical validation and the final write remains a
  time-of-check/time-of-use window. Closing it portably requires descriptor-
  relative no-follow writes rather than another path check.
- SSH environment creation can outlive a removed in-progress owner, and remote
  launch/cleanup failures can leak a server or tunnel. Fixing this safely needs
  one owner/rollback contract across desktop, SSH, and server layers.
- Client-runtime unary RPC calls have no general deadline. A shared timeout
  would break legitimate long-running methods, so policy needs to be declared
  per method. The latest-command scheduler can likewise retain resolver
  callbacks indefinitely behind a permanently stalled command; settling those
  callers requires explicit supersession or timeout semantics.
- Environment HTTP API decoding materializes each response as an `ArrayBuffer`
  before schema validation. Request deadlines bound time but not response
  bytes; applying one global ceiling would reject legitimate paged diffs or
  legacy full snapshots, so endpoint-specific byte budgets or streaming
  pagination need to be part of the HTTP contract.
- Orchestration command ingress is now count-bounded, but a turn command can
  still carry eight large base64 images. A worst-case 64-command queue remains
  much larger than a safe aggregate memory budget; weighted admission or
  file/artifact-backed attachment transport needs a cross-client contract.
- Several subscription/snapshot fallback logs still attach `Cause.pretty`
  output. Deep or provider-shaped causes can be large and may include payload
  text; replacing them with structural safe-log attributes needs one tracing
  policy so useful Effect failure tags and correlation IDs are retained.
- Server VCS snapshots and per-CWD PR lookup epochs survive the final subscriber
  indefinitely. A shared normalized-CWD TTL/LRU needs generation fencing so an
  in-flight refresh cannot repopulate an evicted workspace.
- Stateful MCP-over-HTTP transport sessions are removed only by an authenticated
  client `DELETE`. Crashed clients whose 24-hour credential expires leave the
  underlying session map resident for the server lifetime; the transport needs
  idle expiry plus a hard capacity linked to credential revocation.
- Desktop primary authentication caches a bearer forever even though the
  session expires, while the bootstrap seed expires much earlier. Safe renewal
  needs an expiry-aware IPC contract and a renewable trusted bootstrap grant,
  not just blind retry with an already-expired seed.

### Desktop and web

- Pull-request scroll restoration observes fixed-height overflow containers,
  whose `ResizeObserver` does not report `scrollHeight` growth. Lazy detail,
  Markdown layout, or the shadow-root diff viewer can therefore clamp a saved
  offset too early and never reapply it. A reliable fix needs a bounded content
  size/readiness signal from each tab (especially the virtualized diff) rather
  than permanent DOM polling.
- Group-shared project settings fan writes out across physical project records
  without transaction or rollback semantics. Concurrent edits can interleave,
  and a mid-sequence failure leaves earlier environments updated while later
  ones retain the old value. A safe fix needs a declared cross-environment
  consistency model, retry/compensation UX, and per-field ordering rather than
  hiding a partial commit behind optimistic local state.
- Pull-request mutations are serialized by environment even though their own
  comment requires ordering only for the same change request. A slow host
  action on one repository therefore blocks comments, reactions, reviews, and
  updates for every unrelated pull request on that environment. Per-reference
  lanes would remove the bottleneck, but the reference-less listing
  invalidation command must still coordinate with every active lane; the
  scheduler currently has no multi-key/barrier primitive, so changing the key
  alone could race cache invalidation and leave stale detail.
- Pinned-order section rewrites use a fixed two-letter keyspace. At 676 or
  more pinned threads the generator saturates at `zz`, emits duplicate keys,
  and cannot preserve the requested order beyond the identity tiebreak. A
  variable-width scheme or explicit product cap needs compatibility for
  already persisted keys and mixed-version clients before changing the shared
  reorder format.
- Scoped project/thread keys and project-grouping override keys still compose
  legal environment IDs, entity IDs, and filesystem paths with a colon.
  Contracts permit colons, so distinct tuples can collide. These keys are
  persisted and hand-constructed across web and mobile surfaces; moving them to
  tuple encoding requires a backward-compatible storage and route migration,
  not a local parser change.
- Preview screenshot/recording actions still permit overlapping start, stop,
  capture, copy, and reveal requests. Reveal failures are not surfaced, and
  capture/recording/reveal IPC has no renderer deadline. The actively edited
  `PreviewView` path needs one operation reservation and late-settlement policy
  rather than an overlapping audit patch.
- Preview tab-image IPC still carries an unbounded PNG data URL. Its existing
  8192-pixel dimension ceiling does not imply a safe worst-case encoded size;
  a byte ceiling needs a lower dimension/encoding policy or artifact transport
  so valid high-detail captures are not rejected after expensive encoding.
- A timed-out browser viewport mutation still owns the shared mutation chain
  until its handler settles. Releasing it would let a late older resize
  overwrite a newer resize, so this needs abort-aware or sequence-aware commit
  semantics rather than simply racing the caller against a timer.
- Non-image composer context collections (terminal excerpts, element picks,
  preview annotations, canvas selections, and review comments) have no shared
  count or serialized-size budget. A cap needs one aggregate prompt budget and
  explicit rejection UX so different context types do not crowd each other out
  unpredictably.
- Human/agent preview ownership has overlapping timers and first-input expiry;
  late capture restoration can reapply stale state. Fixing this needs one
  generation-owned controller transition model.
- Timeline scroll handling still checks every minimap turn on every scroll
  event. A binary-search/previous-visible-set implementation needs real-client
  validation because LegendList may not have measured every row.
- Screencast asks Chromium for every compositor frame and samples after
  delivery. Protocol-level sampling could reduce IPC further but affects
  recording smoothness.
- WSL-only updater recovery currently favors recovery over strict isolation.
  Changing that behavior is a UX and support-policy decision.
- The public `createMain` operation can deliberately create another main
  window; removing or narrowing it changes service API expectations.
- Public-host favicon lookup still depends on a third-party provider. The
  privacy guard is fixed, but eliminating that provider is a product choice.
- The minimap's scroll handler still measures or checks every turn strip on each
  event, and ChatView anchoring has unresolved follow-up/initial-layout races.
- Workspace Markdown images still need an authenticated/signed asset path;
  ordinary browser image URLs cannot carry environment RPC credentials.
- Preview-control epoch sleepers and per-session tables retain avoidable state;
  simplifying them safely needs coverage for overlapping human/automation
  control.
- Client-setting selectors subscribe to the entire settings object, so one
  slider update rerenders all nominally granular consumers. A selector-aware
  external store needs stable equality semantics.
- Canvas state retains every opened thread's full document, undo history,
  previews, and pending operations for the page lifetime. Eviction must never
  discard entries with pending writes or unresolved local previews.
- Signed asset query families keep every recently used resource and resource
  collection key idle for one hour. The cache is finite in time but not count
  or aggregate bytes, so high-cardinality file, favicon, message, or canvas
  image browsing needs a measured LRU/TTL budget that does not expire URLs
  still displayed by a mounted surface.
- Ghostty now retries a failed initial layout read, but successful layout maps
  still never update after the OS keyboard layout changes. Existing cores need
  one shared `layoutchange` subscription and disposal-safe notification.
- Remote or multi-device thread deletion still has no web-owned lifecycle hook
  for clearing persisted presentation stores. Local deletions are cleaned up;
  wiring the same idempotent coordinator to the authoritative event path must
  distinguish deletion from archive.
- Per-thread preview presentation atoms are both family-memoized and marked
  keep-alive, so every thread whose preview state is read keeps an atom registry
  entry for the page lifetime even after its last tab closes. An idle TTL would
  release the cache, but it must first preserve close-suppression tombstones and
  imperative preview-automation reads so a late list cannot resurrect a tab.
- Terminal metadata is selected from one environment-wide array in every
  mounted row, so each update fans out to roughly rows times terminals. A
  structurally shared per-thread index belongs at the environment selector
  boundary.
- Command-palette actions cover creation, search, themes, and settings but not
  the contextual terminal, right-panel, diff, model-picker, composer-stash, or
  favorite-editor commands exposed by keybindings. Adding them needs one
  context-aware action bus so palette and shortcut execution cannot drift into
  separate implementations.

### Mobile

- Incoming native shares use a content hash to make crash-before-ack replay
  idempotent, but Expo supplies no handoff identifier. A later intentional
  share with identical content can therefore be mistaken for the old durable
  item while it remains in the inbox. Unique IDs trade that loss for a possible
  duplicate after a crash; resolving it needs an explicit delivery guarantee.
- Incoming-share loading still rehydrates every attachment in the inbox at
  startup. Lazy hydration would reduce memory and I/O but requires an explicit
  loading/error state for each selected share.
- Composer loading also rebuilds every saved attachment into base64 JS strings;
  at current limits a single draft can exceed 100 MiB before string/object
  overhead. Lazy metadata needs an explicit missing-file state at send time.
- The composer store rewrites one whole JSON document and retains settings-only
  or abandoned thread draft keys without an age/count budget until their
  environment is removed. Blind LRU eviction could discard unsent work, so
  pruning needs authoritative thread-deletion handling plus a protected-draft
  retention policy.
- Composer preview cleanup is not reference-counted. A global sweep could
  delete bytes still referenced by another draft, inbox item, or outbox entry.
- Picker foreground-handoff protection ends before image conversion and draft
  insertion, so a pending OTA restart can reload midway and orphan partially
  prepared previews. The ownership lease must span the full import transaction.
- Draft hydration merges the whole pre-hydration object, so an edit made while
  storage loads can overwrite concurrently hydrated attachments or settings.
  Field-level conflict semantics need to be chosen before changing it.
- New Task clears its draft before the create RPC and its fallback can use a
  stale pre-PR workspace; if both primary and fallback creation fail, the
  prompt can be lost. Recovery needs a durable submitted/failed draft state.
- Deterministic outbox failures and missing threads/projects can silently delete
  queued prompts, while other deterministic failures retry forever. A durable
  failed/edit-needed state needs Retry, Edit, and Discard semantics.
- Environment removal can discard the only cleanup trigger before mobile-owned
  draft/outbox cleanup succeeds. A durable tombstone or startup orphan sweep is
  needed.
- Environment Storage still renders a potentially high-cardinality collection
  eagerly. Virtualization needs to preserve native headers, actions, expansion,
  and scroll restoration.
- Client Storage likewise eagerly mounts every environment cache row, while
  archive environment filters can hand the full catalog to a native menu.
  Memoization removes search-keystroke rebuilds, but virtualizing the settings
  card and replacing impractically large menus needs a searchable picker design.
- The release workflow can publish OTA before a mobile-specific validation
  gate completes. Adding a gate changes release latency and failure policy.
- Upstream sync can both trigger the release workflow by merge push and dispatch
  it explicitly. Two runs pinned to the same pre-fingerprint SHA can publish OTA
  twice and both decide to submit iOS; one authoritative trigger or external
  commit-SHA release marker is required.
- Android production binary publication does not match iOS/TestFlight parity.
- Invalid incoming-share inbox JSON is logged on every launch rather than
  quarantined. Outbox JSON now moves to `.invalid`, but those quarantine files
  have no retention policy and a failed move still retries each launch; delete
  versus retain-for-diagnostics is a data-recovery choice.
- The SecureStore environment catalog is one growing value and may approach
  platform limits for users with many environments.
- Archived Threads mounts and pull-refreshes one snapshot query for every
  catalog environment at once. Capping or staggering that fanout needs a
  visible partial-results contract so a large remote fleet does not silently
  omit archives or leave pull-to-refresh appearing complete too early.
- Expo Updates check, download, and reload promises have no caller-owned
  deadline; one stuck native promise pins the singleton update check and its
  Settings state indefinitely. A `Promise.race` alone cannot cancel the native
  download and could allow a retry to overlap it, so this needs an explicit
  native cancellation/retry policy.
- Workspace-image prefetch deadlines cannot cancel React Native's underlying
  `Image.prefetch`; a permanently stuck native request can outlive its failed
  atom and accumulate with later file URIs. True teardown needs a cancellable
  image-loader API rather than another `Promise.race`.
- Showcase setup retries similarly time out without cancelling the underlying
  orientation, pairing, or outbox operation. A permanently stuck attempt can
  therefore remain alive while later attempts overlap it; fixing this requires
  cancellable operation APIs rather than treating `Promise.race` as teardown.
- The native composer retains one full-text snapshot for each event React has
  not acknowledged. A long JS stall during a large prompt can therefore build
  a transient quadratic text backlog; fixed-count eviction risks reapplying a
  stale controlled value and resetting the iOS caret/autocorrect session, so a
  compact revision/delta design needs dedicated native-editor coverage.
- iOS native image paste/drop still asks every item provider to decode a full
  `UIImage` and PNG-encodes it before JavaScript enforces the eight-image and
  ten-MiB attachment limits. A native count, decoded-pixel, and encoded-byte
  policy needs parity decisions for very large but otherwise valid photos.
- Native markdown presentation recursively walks parser children in several
  paths. A pathologically nested but size-valid document can exhaust the
  JavaScript stack; choosing a depth-limit fallback needs a visible plain-text
  degradation contract rather than silently dropping nested content.
- Source-file and markdown-code highlight atoms retain work for their idle TTL,
  and their Shiki promises have no navigation-scoped cancellation. Cancelling
  large highlights on navigation would save CPU, but it needs a policy for
  preserving useful warm results versus aborting cacheable work.
- Legacy mobile cache migration recursively materializes every directory entry
  and reads every file as text before decoding it. Bounding file count, depth,
  and bytes is straightforward, but deciding whether an exceeded migration
  budget should preserve the legacy directory for retry or quarantine it needs
  a one-time upgrade/recovery policy.

### Release automation

- The freshly downloaded Origin CLI is mutable and unpinned. Environment
  minimization prevents broad secret exposure, but the binary is immediately
  trusted with `CURSOR_API_KEY`; require a pinned/checksummed installer or a
  preinstalled trusted binary.
- Both fork mobile jobs install `eas-cli` as `latest`, so OTA, fingerprint,
  local-build, and submit behavior can change between otherwise identical
  release commits. Pinning needs a tested EAS version plus an explicit upgrade
  cadence rather than an incidental lock to today's CLI.
- The self-hosted Mac repair step replaces missing action runtimes from mutable
  `latest-v20.x`/`latest-v24.x` URLs and verifies them only against checksums
  fetched from the same origin. Stronger provenance needs a pinned runner
  runtime artifact or an authenticated runner-package restoration contract.
- Self-hosted macOS release jobs keep Cargo target/registry and CocoaPods caches
  under fixed home-directory paths with no age or size retention. A cleanup
  ceiling could prevent runner-disk exhaustion, but it needs a measured cache
  budget that preserves the intended release-time speedup.
- The fork's WSL `node-pty` prebuild comes from a temporary unlocked `npm
install` plus whichever `node-gyp` `npx` resolves, so transitive build inputs
  can drift from `pnpm-lock.yaml` while the release commit stays fixed. Moving
  this job onto the workspace lockfile is safer but changes the self-contained
  recovery/build-time contract and should be measured first.
- Hosted release deployment captures the complete Vercel CLI stdout in one
  shell variable and passes it to alias mutations without an exact URL check.
  A bounded draining collector plus single credential-free HTTPS URL parser is
  needed before changing the CLI output contract.
- Windows runner bootstrap downloads the mutable Visual Studio Build Tools
  launcher without a pinned digest, changes the machine-wide execution policy,
  and starts services through legacy wildcard names. Unattended setup needs an
  authenticated installer/channel contract and exact owned-service identity.
- Official and fork Windows signing install whichever PSGallery
  `TrustedSigning`/NuGet provider currently satisfies a minimum version, then
  immediately expose Azure credentials to it. Pinning an exact module package
  and trusted digest requires a tested upgrade/provenance policy; the endpoint
  host also remains intentionally configurable, so an Azure cloud/sovereign
  domain allowlist needs an explicit fork policy before it can be enforced.
- Origin merge completion is fail-open and is not independently verified before
  later release steps. The exact CLI result contract must be confirmed before
  making the gate strict.
- Upstream-sync pull-request bodies are now local-file bounded at eight MiB,
  but the exact Origin API/CLI body ceiling is undocumented in this checkout.
  Once that contract is confirmed, clip the PR summary to the remote limit and
  point at the complete checked-in integration report instead of discovering
  a smaller limit only after the merge work finishes.
- A transient Windows build failure can still leave a tagged release that looks
  complete without Windows artifacts. Whether Windows is mandatory or an
  explicitly partial release is a product policy.
- The EAS dotenv output is appended wholesale to `GITHUB_ENV`; it still needs
  an explicit allowlist and correct multiline parsing without dropping required
  Expo public configuration. The on-disk file is now removed on every job exit.
- Changelog publication pushes directly to the protected default branch and
  swallows rejection. Moving it to a bot PR changes the release workflow and
  review policy.
- Expo marketing version participates in the native fingerprint and may force a
  binary build for a server-only release-train bump. Removing it requires a
  deliberate native compatibility/versioning rule.
- Unsigned Windows updater behavior, artifact stapling/notarization evidence,
  and installer-level trust checks still need an explicit release policy and
  gate. The official workflow now verifies the exact cross-platform manifest
  set and every named payload, while the fork verifies the files named by each
  present manifest but keeps Windows as an explicitly optional job.
- The upstream workflow must publish immutable `t3@<version>` before exposing
  matching clients, but a later GitHub-release failure leaves a rerun attempting
  the same npm publish again. Recovery needs idempotent verification that the
  existing registry package was produced from the exact release commit before
  skipping publication or repairing dist-tags and downstream artifacts.
- A scheduled nightly tag can exist before all GitHub assets, hosted aliases,
  and announcements finish. The next schedule treats a tag on the same commit
  as complete, so automatic repair needs a separate finalization marker or an
  authoritative external completeness check.
- Origin's tag is now a last-step completion marker and updater manifests are
  uploaded after their binaries, but several S3 objects cannot be swapped as
  one transaction. A versioned-prefix plus atomic channel-pointer contract is
  needed if readers must never observe platform manifests from different runs.
- CLI packaging recursively enumerates client output, reads each compressible
  asset whole, and runs synchronous Brotli quality 11. A per-file budget and
  asynchronous compression policy need measured build-size and release-time
  targets before changing the shipped precompressed asset contract.
- Stable release validation accepts version strings looser than npm SemVer, so
  malformed tags can consume the full build matrix before immutable-package
  publication rejects them. Tightening this needs one shared release-version
  parser that preserves intentionally supported historical tags.
- Desktop changelog pushes, iOS fingerprint merges, and upstream-sync merges
  mutate Origin `main` from distinct concurrency groups. Serializing all three
  entire workflows would waste independent Linux/Mac work; their final main
  mutations need a narrower retry or compare-and-swap contract.
- Each native GitHub Actions queue retains at most 100 pending runs. A
  repository blocked long enough to fill that queue cancels additional
  arriving runs, so operations must repair from source state rather than
  assume every dispatch survived. This limit does not describe the pinned
  Buildkite importer used for Origin workflows.

## Simplicity audit (ponytail)

- **Deleted:** `apps/web/src/observability/clientTracing.ts` was approximately
  145 lines with no imports or callers.
- **YAGNI candidate:** `packages/shared/src/String.ts` exposes a general
  truncation helper with one production caller; localizing it may be clearer.
- **YAGNI candidate:** `packages/shared/src/Struct.ts` exposes a generic deep
  merge with one production caller; removal depends on whether it is intended
  as package API.
- **Keep:** lifecycle guards, legacy-sidebar compatibility, and provider
  adapter compatibility are not ornamental abstraction; they protect real
  multi-surface and multi-version behavior.
