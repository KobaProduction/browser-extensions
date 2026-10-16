# Shared application telemetry

One application-owned service collects technical events from VK Booster,
ChatGPT Booster and application infrastructure. Providers depend on its
typed port; they do not own collectors, consent, queues or diagnostic pages.
Telemetry belongs in application settings, never in the ordinary archive.

## Consent and privacy

- Local collection is **OFF by default**, independently for every product,
  channel and installation target. No adapter means unavailable.
- External delivery requires a **second explicit opt-in**, a saved HTTPS
  endpoint and the actual target capability. Saving an endpoint does not
  enable delivery. Changing it revokes previous external consent.
- Turning local collection off stops both collection and delivery and revokes
  external consent. Existing local records remain readable/exportable until
  the user clears them. Hiding the launcher does not change consent.
- No default collector, automatic availability probe or secret is configured.
  An explicit **Check endpoint** action uses the unsaved HTTPS candidate and
  an empty OTLP JSON envelope. It never drains the journal, includes service
  or provider data, saves configuration, or grants collection/delivery consent.
  The settings UI permits saving a changed nonempty endpoint only after that
  exact candidate succeeds; editing it invalidates the check.
  Before each delivery, the adapter rechecks persisted consent and endpoint.
  Opt-out aborts an in-flight request owned by that running controller.
- Only allowlisted event names, validated module scope, time, bounded count,
  duration and a finite error class may cross the queue/transport boundary.
  Never include messages, conversation/account IDs, email, tokens, cookies,
  paths, filenames, provider URLs, content-derived hashes or exception text.
  Technical notifications and errors use typed codes, not arbitrary strings.
- Telemetry storage/transport errors remain fail-open for product operations.
  Never reset, delete or migrate a failed journal to make an error disappear.

The required envelope contains application `serviceId`, product, DEV/PROD
channel, schema version and timestamp. `providerId` distinguishes application,
VK and ChatGPT events **within that installation**. An all-in-one scope filter
does not authorize opening or importing a standalone product's journal.
See [environment isolation](ENVIRONMENTS_AND_STORAGE.md).

## Application and provider ports

`ApplicationTelemetryController` in `packages/core` owns configuration,
local and external consent, status, bounded record queries, JSON export,
explicit clear and delivery. `ScopedTelemetry` sanitizes allowlisted events
before storage. `useApplicationTelemetry(providerId)` binds an injected
controller to the contributing provider without exposing private context.
Application lifecycle and notification adapters use the same controller.

`ApplicationTelemetrySettings` is the one reusable settings widget. Its
local, external and journal views expose retention, queue/delivery status,
provider filtering, pagination, JSON download and confirmed journal clear.
The local journal remains visible while collection is disabled. Errors and
empty/unavailable states are explicit. A provider cannot silently enable
external delivery through its own settings UI.

`classifyTelemetryError` and `reportTelemetryError` provide a reusable
fire-and-forget boundary for infrastructure failures. Only an enumerated
error class and provider scope enter the controller. Error messages, stacks
and arbitrary rejection objects are neither read nor stringified. A failed
diagnostic sink cannot change the operation's result. Lifecycle failures,
ChatGPT protocol/storage validation failures and remote automation failures
use this same consent owner rather than starting separate exporters.

The widget uses the shared, CLI-installed shadcn-vue controls by purpose:
Switch for collection/consent, Tabs for its three views, Input/Label for
retention and endpoint, Select for provider scope and Table for the journal.
The former native checkboxes/select and imitation tab buttons are removed;
their inconsistent state indicators and styling did not match the owner's
component contract. Select popovers use the shared injected Shadow DOM
portal target so the same theme and focus boundary remain available.

## Journal, retention and offline delivery

The journal port separates persistence from transport. The Dexie driver uses
its own fixed **schema 1**, with `events` and `metadata` tables and no provider
archive data. Its name includes verified product/channel/installation; an
absent scope or account-linked telemetry scope is rejected. Existing VK and
ChatGPT archive databases remain untouched.

Default policy: retain 5,000 events for seven days, rotate every five minutes.
The user can configure 100–5,000 events, 1–90 days and a 1–60 minute interval.
Rotation removes expired and excess eligible rows in **one periodic batch**;
appending an event never deletes an older event. At startup, overdue rotation
runs once using the saved rotation time. Active delivery leases survive
rotation. Between batches the selected retention target can be exceeded;
the separate 10,000-event safety ceiling applies backpressure to new appends.
The UI exposes the discarded count and last rotation time.

External delivery claims up to 50 events under a 45-second lease. Successful
collector acknowledgement marks them `sent`, retaining local history until
rotation. Failure returns them to pending; expired leases recover after
restart. Delivery is **at least once**, never exactly once. Offline/unavailable
delivery keeps the queue locally within the same retention policy. The shared
sender uses HTTPS-only OTLP/HTTP logs, no cookies, no redirects and a bounded
request timeout. Background retries back off with jitter; only the explicit
settings action can probe a candidate. The JSON response is bounded to
64 KiB and its acceptance shape is checked before any local acknowledgement.
A plain HTTP 200 or an empty/HTML body alone is insufficient. Positive
`partialSuccess.rejectedLogRecords`, malformed acceptance, and non-retryable
HTTP responses preserve local history and set `collector-rejected`; they
are not retried automatically. Explicit renewed consent or a changed endpoint
resets this block. Only HTTP 429/502/503/504 and transport failures retry.
Collector-provided diagnostic text is discarded, never displayed or recorded.
Unknown JSON fields are ignored for Protobuf forward compatibility. These
acceptance and retry decisions follow the
[OTLP HTTP specification](https://opentelemetry.io/docs/specs/otlp/#otlphttp-response);
retaining rejected records as local history is the application's explicit
retention policy, not an assertion that they were accepted remotely.
Delivery state, last acknowledgement time, next retry time and bounded retry
delay are persisted in the same scoped journal metadata. Worker suspension or
reload resumes that checkpoint instead of resetting retries; an interrupted
`sending` checkpoint resumes as retrying and recovers expired event leases.
Changing the collector resets its delivery history while revoking consent.
A delivery generation fence also prevents an old asynchronous sender from
acknowledging records or overwriting the off state after opt-out, even when
that sender ignores cancellation. An already accepted remote request cannot
be recalled; at-least-once delivery still allows duplicates.

## Browser-target composition

- **Chromium MV3:** content controllers proxy to one extension-owned worker
  controller and Dexie journal. VK and ChatGPT tabs of the same all-in-one
  installation therefore contribute to one queue rather than separate host
  IndexedDB origins. The worker validates sender extension ID and compiled
  product/channel scope. It checks granted endpoint-origin permission before
  every request. The external-consent action requests only that configured
  HTTPS origin from the declared optional permission. The explicit empty
  endpoint probe requests the same narrowly scoped capability. An alarm wakes the
  worker for queued delivery/overdue rotation after suspension. The DEV
  background returns before creating a controller or alarms outside the
  permitted incognito context, including when old local consent is saved.
- **Tampermonkey:** scoped GM persistence is shared by the installed script
  across its matched sites. Separate per-event keys avoid lost updates from
  replacing one shared JSON queue. GM leases cannot provide cross-origin
  transactions: concurrent senders may duplicate delivery, as allowed by the
  at-least-once contract. The GM sender is anonymous and requires explicit
  remote consent; its HTTPS endpoint is selected by the user. Missing required
  GM storage APIs makes telemetry unavailable, rather than silently creating
  unrelated per-site journals. GM grants and `@connect` are build-owned
  capabilities, not evidence of active sending.
- **UI Lab:** a synthetic in-memory journal uses the real controller and
  widget; external transport is unavailable and cannot send network requests.
  Fixtures and account data are never transferred to a live installation.

Telemetry settings can be included explicitly in the application's recovery
selection. The backup contains local consent and validated endpoint/retention
preferences, never credentials or the event log. Restore always revokes
external consent; it must be granted again on the destination installation.
Partial persistence failure restores prior preferences where possible and
keeps external sending revoked. This is separate from archive backup/recovery.

## Owner correction and current acceptance level

The owner's 2026-10-14 review supersedes the earlier source-stage decision
to leave remote configuration permanently unavailable. It authorizes an
explicit settings/queue/delivery flow, **not enabling a collector now**.
The former archive diagnostic footer mixed archive work with infrastructure;
the former local-only toggle hid the journal and retention; deleting the
oldest record on every append contradicted the requested periodic batch
rotation. These behaviors are replaced by the shared application service
and settings categories described above.

The later review also identified that an unverified endpoint could be saved,
an HTTP-success response could discard partially rejected records, and a late
sender could override a revoked state. Candidate verification, strict bounded
acceptance and the delivery generation fence correct these behaviors. The
widget uses the actual shared Skeleton during initial loading and fences
journal requests so an obsolete result cannot overwrite the current view.
The first journal page refreshes through a coalesced subscription and periodic
status check. Loading older pages pins that snapshot until explicit refresh,
so new notifications do not collapse the user's inspection back to page one.

## HappyKids reference comparison

Read-only comparison on 2026-10-14 used the HappyKids account's
[web_report/frontend](https://git.happykids.ru/web_report/frontend) **develop**
commit [`8481c9bc`](https://git.happykids.ru/web_report/frontend/-/commit/8481c9bc4ffc299e964b47638e195f2a0cc234dd).
The default `main` branch is an older 2025 snapshot and does not contain the
current implementation. The earlier `intens-cloud/web-app` console logger is
not this reference. Searching this pinned frontend's source for Kafka returned
no matches; its implemented browser transport is OTLP/HTTP.

| Concern | HappyKids source | Extension service decision |
| --- | --- | --- |
| Composition | [telemetry public API](https://git.happykids.ru/web_report/frontend/-/blob/8481c9bc4ffc299e964b47638e195f2a0cc234dd/src/shared/telemetry/index.ts), separate persistence/exporter/delivery | Shared core port, target journal/transport adapters, one application controller; providers contribute typed signals. |
| Offline journal | [storage](https://git.happykids.ru/web_report/frontend/-/blob/8481c9bc4ffc299e964b47638e195f2a0cc234dd/src/shared/telemetry/storage.ts) keeps compact indexed spans and serializes OTLP at delivery | Same compact-record boundary; fixed schema 1 per product/channel/installation and local technical logs retained after acknowledgement. |
| Connection | [settings](https://git.happykids.ru/web_report/frontend/-/blob/8481c9bc4ffc299e964b47638e195f2a0cc234dd/src/shared/telemetry/settings.ts) separates tab-local ingestion credentials; [delivery](https://git.happykids.ru/web_report/frontend/-/blob/8481c9bc4ffc299e964b47638e195f2a0cc234dd/src/shared/telemetry/delivery.ts) provides an unsaved draft probe | Empty candidate probe before UI save and independent local/external consent. No default credential or production endpoint; telemetry remains separate from the authenticated remote archive session. |
| Retention | Capacity-triggered oldest-record rotation plus periodic sent-history expiry | The extension owner's rule takes precedence: scheduled batch rotation, no oldest-record deletion on append, active leases preserved, separate hard-limit backpressure. |
| Diagnostics | [errors](https://git.happykids.ru/web_report/frontend/-/blob/8481c9bc4ffc299e964b47638e195f2a0cc234dd/src/shared/telemetry/errors.ts) stores sanitized messages/stacks; history supports level/time inspection | The extension's privacy contract is stricter: finite event/error codes only, no exception text or stacks that might contain conversation data. |
| Signal/target | OpenTelemetry SDK HTTP/session/navigation traces and manual diagnostic logs in a page-owned database | Technical OTLP logs/counters, provider filtering, JSON journal export, extension-owned MV3 queue or scoped GM bridge. Full tracing and Kafka integration are not claimed. |

This comparison adopts the shared ownership, compact persistence, draft
verification and local journal workflow. It does not copy the web application's
global database name, append-time eviction, credentials, business fields or
exception-string sanitizer into an extension installed on unrelated sites.

## Validation checkpoint

The owner's later instruction authorized focused synthetic tests and local
runtime checks. The telemetry suite covers opt-in/scope separation, an empty
candidate probe, endpoint-change consent revocation, lease/reopen behavior,
scheduled rotation, private-field rejection, partial collector rejection,
persisted delivery blocks, opt-out racing a late sender, GM persistence and
transport, and fail-open error classification. It uses fake IndexedDB,
in-memory GM values and mocked HTTP only. No external telemetry endpoint has
been enabled or contacted during this work.
Target permission prompts, GM cross-site concurrency, worker suspension,
offline retry, privacy, retention, recovery and installed DEV/PROD coexistence
still require the full end-of-batch checks and installed-browser acceptance.
Synthetic tests and source comparison do not establish collector indexing,
installed target permissions or production acceptance.
