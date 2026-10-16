# Automation and WebSocket remote sessions

## Source checkpoint and ownership (2026-10-14)

This contract records the owner's requested reusable automation and the current
local source implementation. It does not establish a running server, browser
compatibility, production data delivery or product acceptance. The latest owner
directive permits focused synthetic tests and local execution. Focused tests
cover drafts, provider CRUD, auth/ready, reconnect, fake-IndexedDB ACK delivery,
fragmented responses, actual common-message delivery, legacy source adaptation,
variants and raw-consent/privacy boundaries. Installed extension and
production-server acceptance remain separate.

| Owner | Responsibility |
| --- | --- |
| [`packages/core/src/automation.ts`](../../packages/core/src/automation.ts) | Typed facts, rule validation, matching, command scheduling and configuration |
| [`packages/adapters/src/remote-session.ts`](../../packages/adapters/src/remote-session.ts) | WebSocket connection, authentication, framing, delivery and command dispatch |
| [`packages/adapters/src/remote-archive-sync.ts`](../../packages/adapters/src/remote-archive-sync.ts) | Explicit canonical archive resend, bounded production and snapshot finalization |
| [`packages/storage/src/remote-outbox.ts`](../../packages/storage/src/remote-outbox.ts) | Scoped durable/volatile delivery queues and command claims |
| [`packages/ui/src/dom-facts.ts`](../../packages/ui/src/dom-facts.ts) | Generic presentation observation utility; not a ChatGPT business-event source |
| [`conversation-automation.ts`](../../modules/chatgpt-booster/packages/features/src/conversation-automation.ts) | ChatGPT facts, verified owner, source mirroring, settings and composition |
| [`archive-fixed-runtime.ts`](../../modules/chatgpt-booster/packages/features/src/archive-fixed-runtime.ts) | Provider capture policy, committed-local publication and the separate remote-only observation route |
| [`conversation-command-port.ts`](../../modules/chatgpt-booster/packages/features/src/conversation-command-port.ts) | Explicit native-method command port and source-confirmed effects |

The engine and transport are shared. ChatGPT is the current provider consumer;
VK has no automatic remote connection or chat-control consumer. UI Lab uses
synthetic settings and memory state without a real delivery store. A separate
loopback fixture at `apps/ui-lab/scripts/ws-fixture-server.mjs` implements this
protocol in memory. It binds only `127.0.0.1`, accepts only DEV synthetic scopes
(`installationId` prefixed `ui-lab`/`synthetic`, owner `synthetic-owner`) and uses
an explicitly synthetic token. It is a test receiver, not a production backend.

Follow [environment isolation](ENVIRONMENTS_AND_STORAGE.md),
[backup ownership](BACKUP_AND_RESTORE.md) and [telemetry privacy](TELEMETRY.md).
Remote message delivery is a separate opt-in data channel: private source content
must never be placed in telemetry to reuse its collector.

## Defaults, facts and rules

Automation and remote connections default to **off**. The initial
remote mode is `local-only`, its endpoint is empty and its command allowlist is
empty. A saved endpoint or token alone does not enable a connection. Restoring
portable preferences disables automation and remote delivery; credentials are
excluded from those preferences and backups.

An `AutomationEvent` contains `eventId`, `providerId`, `runId`, optional
`conversationId`, `origin`, `at` and optional `cause` identifying its command
and rule. The fact kinds are `message`, `api`, `dom`, `limit`, `conflict` and
`completion`. Completion outcomes are `complete`, `failed`, `cancelled` and
`context-exhausted`. Providers supply facts; the core does not intercept host
functions, observe a page, open storage or create timers by itself.

The owner's 2026-10-15 ChatGPT correction requires every business reaction to
originate from observed fetch/XHR/SSE/WebSocket evidence or an explicitly bound
and decorated native application method. ChatGPT does not publish DOM facts or
derive timers, lifecycle, confirmations or automatic actions from controls,
rendered text, route polling or arbitrary extension-internal events. Legacy DOM
rules are unsupported and must not execute after loading/restoring preferences.
DOM observers may only place and refresh extension presentation; a shared generic
DOM utility does not grant a ChatGPT business capability. Message text remains
ephemeral local matching input;
`automation.fact` remote publication excludes message facts. Source text uses
the separately enabled archive channel below.

The complete provider evidence and native-method rules are owned by the
[ChatGPT live contract](../chatgpt-booster/LIVE_ARCHIVE_CONTRACT.md). The shared
engine remains independent of host interception and receives validated provider
facts through its ports.

Rules have an identity, label, enable switch, trigger, actions and cooldown.
Triggers select a fact kind and optionally its name, role, completion outcome,
or a message pattern. Patterns support literal `contains` and `exact`, with
optional case sensitivity; arbitrary regular expressions and executable code
are not part of the contract. Message rules match only final message facts.
Actions are `send-message`, `stop`, `continue`, `new-chat` and `remote-event`.

The current engine bounds rules to 64, actions per rule to eight, action text
to 8,192 characters, message patterns to 512 and private fact text to 1 MiB
of JavaScript characters. Cooldowns range from zero to one day. Command work
is serialized, with at most 256 pending commands; event/command/cooldown
deduplication maps each retain at most 4,096 entries. Changing configuration
invalidates queued work from the previous generation.

Facts caused by automation or remote commands, and facts with `cause`, remain
observable but do not start another automatic rule. This prevents an automatic
reply from recursively replying to itself. Rules are independently enabled;
the storage mode does not disable them. These bounds and cause propagation are source
mechanisms, not proof of all native or multi-tab event sequences.

Local rule CRUD uses `upsertRule` and `removeRule`. Remote `triggers-set`
replaces the validated rule list; `triggers-reset` empties it. ChatGPT awaits
the scoped settings write before reporting completion. These commands do not
silently enable disabled automation.

The provider additionally owns a RAM-only draft through the shared
`createAutomationTriggerDraft`. `triggers-list`, `triggers-get-config`,
`triggers-get {id}` and `triggers-get-unsaved` read saved/runtime state.
`triggers-draft-set {rules}`, `triggers-draft-upsert {rule}`,
`triggers-draft-remove {id}` and `triggers-draft-reset` change active rules
immediately without persistence. Only `triggers-draft-save` writes the current
draft; `triggers-draft-discard` returns to the latest saved baseline. Unrelated
settings changes retain a dirty draft, and a change during an asynchronous save
remains dirty rather than being overwritten. Stop/restart or owner change drops
unsaved rules. Legacy `triggers-set/reset` explicitly persist and replace the
draft. These commands remain individually allowlisted for remote execution.

Before saving either candidate endpoint or token, the UI must obtain a matching
successful `probeRemoteSession`/provider `control.probe` result and verify that
both candidate values are unchanged. The probe creates an isolated socket, sends
only auth/hello, validates exact-scope/session ready, and closes. It cannot open
an outbox, publish an archive, change the live session or persist credentials.

## Wire protocol version 1

Transport is WebSocket only; no REST fallback or background availability probe
is introduced. Production endpoints require `wss:`. Plain `ws:` is accepted
by the transport only for a DEV scope and loopback host (`localhost`,
`127.0.0.1` or IPv6 loopback). Endpoint user information, query strings and
fragments are rejected. A target must still supply its actual network
permissions and browser policy compatibility.

Every frame carries `version: 1`, the exact `ServiceScope` and `sessionId`.
Scope is `{productId, channel, installationId?, ownerId?}`; all fields must
match the client session, including absent optional fields. ChatGPT supplies
its validated owner and archive scope. A new session has a new random session
identity. Mismatched version, scope or session is ignored before dispatch.

After socket open the client sends, in this order:

1. `{type: "auth", version: 1, token, scope, sessionId}`.
2. `{type: "hello", version: 1, scope, sessionId}`.

Normal sessions additionally advertise `source-normalized-v1`, and advertise
`source-raw-v1` only when local `remote.rawEvents` consent is enabled. The default
event mode on every connection is normalized. After ready the server may send
`{type:"event-mode",mode:"raw",capability:"source-raw-v1"}` (or normalized with
`source-normalized-v1`); the client returns `event-mode-ack {accepted,mode}`.
Raw requests without local consent are rejected. Disconnect resets negotiation.
Live normalized events carry the stored common `koba.message` model version 1,
while negotiated raw source
events use `archive.source-raw`. Raw enqueue and queue drain require both local
consent and the current server request, as well as enabled upload. Source-gate
rejection cannot invent canonical validity: it may forward original source only
through that negotiated path. Validation telemetry contains only the approved
technical signal, provider ID and error class, never source data or exception text.

Command results up to 48 KiB keep the existing single `command-result` frame.
Larger results use indexed `command-result-part` frames with 48 KiB raw/base64
chunks, logical result ID, part count, full UTF-8 byte length and SHA-256, followed
by `command-result` with `resultTransfer {count,byteLength,sha256}`. The receiver
must reassemble, validate length/hash and accept the final descriptor before
`result-ack`. Transfers are bounded to 32 MiB and retained response frames to
64 MiB, with the existing command-count/expiry bounds. Fragment send cursors
respect socket backpressure; retries preserve logical IDs and integrity metadata.
This supports full saved/draft configurations without an unbounded single frame.

Only the server's matching `{type: "ready", version: 1, scope, sessionId}`
changes the connection from `authenticating` to `online`. The handshake timeout
is 15 seconds. The token comes from the separate scoped secret adapter and is
used in the first frame, never an endpoint URL, event queue, portable settings,
backup or log. A token is required and is bounded to 16,384 characters. Server
authentication, token lifecycle and authorization remain backend obligations.

### Events and logical acknowledgement

A publish request serializes explicit JSON-safe data to UTF-8 and assigns one
random logical event ID. No implicit Blob/Map conversion or executable
`toJSON` is accepted; source structured-clone values require the provider's
portable codec. Credential-named fields are rejected. JSON nesting is bounded
to 452 levels: the archive codec permits 150 logical source levels, whose
tagged JSON can reach `3 × 150 + 1 = 451`; a sync-row envelope adds one level.
Both transport and canonical hashing derive their shared limit from the codec.

The bytes are fragmented into raw chunks of at most 48 KiB and base64 encoded.
Each client frame contains the common envelope plus:

```json
{
  "type": "event-part",
  "id": "logical-event-id",
  "groupId": "logical-event-id",
  "partId": "logical-event-id:0",
  "index": 0,
  "count": 2,
  "sha256": "sha256-of-complete-utf8-bytes",
  "byteLength": 60000,
  "kind": "archive.source-committed",
  "sourceMode": "normalized",
  "createdAt": 0,
  "data": "base64-fragment"
}
```

The server must bind reassembly to exact scope and logical ID, deduplicate
part indices, reject inconsistent metadata (including `kind` and `sourceMode`), assemble in index order, and verify
the full byte length and SHA-256. It must durably persist the logical event
before sending `{type: "event-ack", id, sha256}` with the matching envelope.
The client deletes an event and its fragments only after that acknowledgement,
after all its fragments were sent and with the exact expected digest. An
individual fragment acknowledgement never deletes queued data.

Reconnect/retry retains the logical ID, digest and fragment IDs. This requires
server idempotency; WebSocket delivery alone cannot establish exactly-once
storage. The transport does not truncate a logical event to a frame limit.
Current serialization still materializes one complete logical payload and its
encoded fragments in memory, so large-record memory and quota behavior remain
acceptance work.

Current ChatGPT kinds are `automation.fact` for non-message facts,
`automation.custom` for explicit rule actions, and `archive.source-committed`
with `{scope,message}` after a real local commit. `message` is the exact
validated persisted `ArchiveMessageV1`, including provider/owner/conversation/
message identity and its native snapshot key and variant index. A deduplicated
observation without a write emits no commit event. In `remote-only`,
`archive.source-observed` uses the same DTO before canonical persistence;
`archive.page-observed` contains only `{scope,page:{conversationId,observedAtMs}}`.
Neither normalized envelope contains a provider original or arbitrary page
metadata. The common model and lossless source boundary are specified in
[conversation export](CONVERSATION_EXPORT.md).

Negotiated `archive.source-raw` uses `{scope,message,source}` for a recognized
observation or `{scope,rejected,reason:"adapter-validation"}` for rejected
source evidence. Original values use `archive-clone-v1`, separately from the
DTO. A rejected source supplies no invented normalized message. Installation,
upload mode, exact channel/installation/owner scope, category retention, local
raw consent and the current server request are checked; asynchronous encoding
also fences owner changes. Unknown but valid opaque content remains a common
DTO with source references, rather than becoming a validation error.

`sourceMode` is optional transport metadata for compatibility, persisted with
the queue record and repeated on every fragment. Current source producers set
it explicitly to `normalized` or `raw`. `archive.source-raw` always requires
raw negotiation. Legacy source/page/sync events without the marker may contain
originals and fail closed as raw. Pending raw records remain stored across
reconnect or consent withdrawal, cannot drain until both permissions return,
and cannot consume all normalized in-flight slots. This pauses data rather
than deleting unacknowledged records.

### Queue, retry and storage modes

| Mode | Remote delivery behavior |
| --- | --- |
| `local-only` | No socket or remote queue is started; the provider's ordinary local capture policy applies |
| `local-and-remote` | Eligible observations first commit to the local canonical archive; accepted delivery events/fragments then commit together to the separate scoped Dexie outbox and retry until logical acknowledgement or dead-letter state |
| `remote-only` | Future eligible stream/history observations bypass canonical writes and enter the volatile delivery route; explicit stop/disposal loses pending work. Rules remain independently configurable |

The durable outbox uses its own fixed schema 1 and never migrates a provider
archive. The database identity includes product, channel, installation and
owner **and the canonical endpoint**. Its suffix is SHA-256 of
`[productId, channel, installationId ?? null, ownerId ?? null, canonicalEndpoint]`.
Changing destination selects a different lazy queue; it never drains the old
destination's backlog to the new server. Old data remains untouched and can
resume only when its original endpoint is selected again. An injected durable
outbox must declare the same canonical destination or connection start fails
closed. Constructing the adapter alone opens no database. Stop closes handles
without deleting durable pending records. Owner change stops the old remote
session, aborts commands, clears pending causes and local matching/timing
caches, then may compose a new session only for a newly verified matching
owner. Old-owner data must not be sent through the new owner's session.

Queue count defaults to 10,000 and is configurable from one to 100,000 logical
events, including dead letters. New events are rejected when full; an older
unacknowledged event is not deleted to make room. The volatile queue additionally
has a 128 MiB budget measured as encoded-string storage. Durable bytes remain
subject to browser quota. Publish receipts distinguish accepted/durable data
from disabled, stopped, full or failed enqueue; an enqueue receipt is not a
server delivery receipt.

In-flight logical events default to eight, configurable from one to 32.
Sending pauses above 256 KiB socket `bufferedAmount`. Logical acknowledgement
times out after 15 seconds. Retry uses 500 ms exponential backoff, capped at
30 seconds. The attempt bound defaults to eight and is configurable from one
to 32; exhausted event attempts become dead letters. Reconnect attempts have
the same configured bound. Explicit `retryDeadLetters()` resets attempts and
reconnect state while preserving event identities.

An unchanged configuration, including canonical endpoint and the same command
capability set regardless of ordering, is a no-op. Changing preferences for
the same destination preserves the volatile queue. Transport-only `reconnect()`
also preserves it; explicit stop, disable, switching to `local-only` or changing
destination clears volatile work. This differs from retrying dead letters:
`retryDeadLetters()` explicitly makes exhausted events eligible again. Neither
operation copies pending events to a different destination. Switching between
the two remote modes at the same endpoint retains the inactive volatile bucket
in memory so it can be used when switching back. Reconnect aborts active command
handlers even when it preserves queued events.

ChatGPT's remote-only route uses `subscribeRemoteSource` / `observedRemotely`
before repository access for future eligible stream and history observations.
It enables that capture route independently of the ordinary automatic-local
capture switch, while still honoring category retention and the installation
switch. A missing consumer or rejected delivery receipt fails capture and
collection completion; it does not emit a local saved/commit signal. Accepted
volatile enqueue is still not a server acknowledgement. Existing local archive
records and Reader access remain intact, without deletion or automatic replay.
Local-and-remote mirrors `subscribeCommitted` only. Historical bulk catch-up
from an existing saved archive is a separate explicit operation below.

### Explicit resend of the saved canonical archive

ChatGPT exposes `control.syncArchive()`, `cancelSync()` and `status().sync`.
The user can start this action explicitly; a server can request it only through
the separately allowlisted `archive-sync` capability. The capability is absent
from the default empty allowlist. Automatic rules need not be enabled for an
explicit resend. An enabled remote mode, online session, enabled installation
and verified owner are required. It reads the current owner's saved archive
without fetching missing site history or modifying canonical rows. Normalized
delivery emits `messages` (preferred DTOs) and `message-variants` (every saved
version, keyed by `[message.key,variantIndex]`). Stored normalized values are
the authority; legacy missing values adapt only in memory. Missing legacy
project context is read from one saved conversation header at a time under the
same owner/revision fences, matching local Reader adaptation without retaining
a whole-archive header map.

The shared `syncRemoteArchive` producer creates a fresh `syncId` and submits
ordinary logical events through the same fragmented/acknowledged transport:

| Logical kind | Payload |
| --- | --- |
| `sync-start` | `{syncId, scope, schema, valueEncoding, digestAlgorithm: "sha256-chain-v1"}` |
| `sync-row` | `{syncId, sequence, store, key, value, rowSHA256}` with zero-based contiguous sequence |
| `sync-end` | `{syncId, rowCount, rollingSHA256}` |

ChatGPT's `schema` is `koba.normalized-archive`, `schemaVersion:1`, with
`messageSchema:"koba.message"`, `messageModelVersion:1`, declared output stores
and `rawCompanions`. Its nested `source` describes the original fixed provider
schema, stores and expected native row count. `valueEncoding` is
`koba-message-envelope-v1`. A preferred DTO has `source.variantIndex:null`;
each variant has its exact saved index. All DTOs retain the native snapshot
reference, without embedding raw values.

Only when raw consent and server negotiation are active at job start does the
same generation additionally include `source-projects`, `source-conversations`,
`source-messages`, `source-elements` and `source-snapshots`, preserving complete
`archive-clone-v1` originals/evidence. The whole generation is then marked
`sourceMode:"raw"`, including its start/end frames, and stops production if
either permission is withdrawn. A normalized generation is explicitly marked
`normalized`. The reusable producer defaults unspecified source mode to raw
for older provider-coded consumers. Native counts and preferred-message counts
are verified independently; emitted wire rows include all variants and optional
source companions. The UI reports a total only once enumeration finishes.

Hashing uses canonical JSON: dense arrays retain order, plain-object
keys sort by UTF-16 ordering, and strings/finite numbers use `JSON.stringify`.
Raw negative zero, accessors, symbols, undefined and raw binary values are
rejected; the provider codec represents supported structured-clone values
explicitly. Canonical hashing and transport validation both bound nesting
to the same codec-derived 452 levels, including the row envelope.

With UTF-8 canonical JSON `C`, the chain is:

```text
H0 = SHA256(UTF8(C(["koba-archive-sync", 1, syncId, scope, schema, valueEncoding])))
Rn = SHA256(UTF8(C([sequence, store, key, value])))
H(n+1) = SHA256(Hn as 32 raw bytes || Rn as 32 raw bytes)
```

Wire hashes are lowercase hexadecimal. The server stages by outer scope,
`syncId` and row sequence, tolerating out-of-order delivery while rejecting
conflicting duplicates. It must not publish a new snapshot until it has the
start and end markers, exactly `[0, rowCount)` rows, matching row hashes and
chain, and valid provider schema/counts. Incomplete generations expire without
replacing server-visible data. Per-event `event-ack` confirms durable receipt
of that logical event; it does not itself acknowledge activation of a full
archive generation.

The producer requires the session to stay online. Queue-full backpressure waits
for the queued count to decrease while online, rather than dropping rows or
loading the entire saved archive. The job accepts an abort signal and defaults
to a 15-minute whole-job timeout, including reads and queue waits; the shared
option accepts one millisecond to one day. Offline, rejected enqueue, timeout,
owner change or source mutation stops production. A retry creates a new
`syncId`; already queued events remain governed by their delivery queue policy.

Before start and after source exhaustion, the provider checks owner/session
and source revision. Finalization compares expected/emitted counts and rereads
the persisted snapshot stamp through `assertSnapshotCurrent()` after awaited
row enqueues. Every attempt to enqueue `sync-end`, including attempts after
queue backpressure, repeats this guard. It does not reread the whole payload.
An interrupted generation before final enqueue has no end marker and cannot
be activated. Cancellation does not retract an event whose enqueue has already
started or completed; its receipt may settle after the producer stops.
Cancellation is not atomic revocation of accepted packets.

UI state and results report **`queuedRows`**, never delivered rows. The result
also carries `syncId`, `rollingSHA256` and whether all accepted events used
durable delivery. Failure counts only receipts observed before interruption.
No server-side generation-activation acknowledgement or accepted server
implementation is claimed by the queued status.

### Commands and effect confirmation

Incoming commands contain `{type: "command", id, capability, payload,
issuedAt, expiresAt}` and the common envelope. The capabilities are
`send-message`, `stop`, `continue`, `new-chat`, `triggers-set` and
`triggers-reset`, plus explicit saved-data `archive-sync`. An enabled connection is insufficient: the capability must
also be explicitly allowed and have a provider handler. Payloads use the core's
strict mapped schema, including optional `projectId` for `new-chat`.

Incoming text frames are bounded to 256 KiB of JavaScript characters. A command
must be unexpired, have positive lifetime no greater than configured
`commandTtlMs`, and be issued no more than five seconds in the future. TTL
defaults to 60 seconds and is configurable from one second to one day. The
transport supplies an abort signal and bounds its wait; native handlers must
check owner, context and that signal before an irreversible action.

A claim ledger records command ID, SHA-256 of
`[capability, validatedPayload, issuedAt, expiresAt]`, expiry and status, without
plaintext command content. The same ID with another fingerprint is rejected.
Claims are bounded to 128 and expired claims are pruned in batches. Concurrent
commands are bounded by `inFlightLimit`. Deduplication survives reload only in
durable mode and within the retained command lifetime; it is not an unlimited
global exactly-once guarantee. An interrupted claimed command is reported as
interrupted rather than blindly replaying a possibly completed native action.

A concurrently running duplicate receives
`{type: "command-ack", id, status: "running"}`. Completion uses
`{type: "command-result", id, capability, ok, result?, errorCode?}`. A result
is retried every five seconds until matching `{type: "result-ack", id}` or
its result window expires. Result data uses the bounded single/fragmented
transfer above; at most 128 result entries are retained. Error codes do not include
private exception text.

ChatGPT's native adapter invokes only an explicitly bound native application
method or validated provider API. It never drives DOM controls. Sending and
continuing await a correlated observed request; stopping awaits that run's
confirmed stopped/cancelled state. New-chat requires native-method or protocol
evidence of the created context, and any supplied text needs its own request
confirmation. Missing native bindings fail as unsupported. Confirmation has a
bounded wait and owner/run/abort checks; method invocation alone is not success.
Actual ChatGPT native bindings and protocol compatibility still require
installed-browser acceptance.

## Remaining acceptance

Synthetic loopback WebSockets have exercised auth/ready, commands, fragmentation,
ACKs, actual common DTOs, raw companions, queue gating and owner-race rejection;
the opt-in UI Lab connection form was also exercised against that fixture.
No production backend, user archive or external delivery endpoint was used.
Production client/server interoperability, durable server reassembly, retry
after browser suspension, quota failure, multi-tab claims, token rotation and
native-effect/abort races still require acceptance. The server must authorize every
scope and capability; matching a client envelope is not server authentication.
Combined checks and installed DEV/PROD isolation are recorded separately from
these focused checks. Source documentation must not label production gates as
passed merely because synthetic protocol tests pass.
