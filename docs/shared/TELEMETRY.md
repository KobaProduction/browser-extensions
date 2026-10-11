# Pluggable telemetry for all browser extensions

One **provider-neutral interface**, independent adapters per application.
A product determines its own service identity; aggregation does not erase
which product/environment emitted the event.

## Scope and event envelope

Required identity: `serviceId` (e.g. **VK Booster Service**),
`productId`, `channel: dev|prod`, event schema version and time. Optional
validated installation identifier can be rotated. Channel separation is
mandatory for queues, counters, sinks, dashboards, retention and opt-in
consent. DEV events must not appear under PROD metrics.

Allow only approved technical signals (operation, success/failure class,
duration, bounded count and sanitized error classification). Never transmit
message text, conversation IDs, email/account IDs, cookies, access tokens,
file names, paths, hashes derived from private content, provider URLs, or
full exception objects that may contain secrets.

## Port and lifecycle

- Application module depends on a typed `TelemetryPort`/emitter, not a vendor SDK.
- Inject an adapter explicitly; no adapter means telemetry is unavailable,
  not silently enabled.
- **Default OFF**, opt-in per product and channel; visible opt-out/revoke.
  Respect browser-target permissions.
- Sanitization/allowlist is performed before queueing and sending.
- Async transport errors must never block storage commits, exports or UI.
  Queue/storage, if any, must be isolated by channel/product and bounded.
- Explicit retention limits, sampling policies, diagnostics and schema
  versioning. The aggregate may observe only authorized same-channel service
  events through a capability boundary.
- Support a local/mock sink in the development archive lab; no real data
  leaves the environment during tests.

**Source implementation checkpoint:** `packages/core` now supplies a
default-off allowlisted `ScopedTelemetry` emitter and `packages/adapters`
exposes its product/channel-validated `TelemetryPort` binding. The same
typed contract is reusable by VK v2 and ChatGPT without changing their
archives. Real sink transport, persisted consent, dashboards and installed
browser acceptance remain missing; mocks do not prove live integration.

See [environment isolation](ENVIRONMENTS_AND_STORAGE.md) and
[project rules](PROJECT_RULES.md).

## Dexie journal and shared OTLP transport — source integration checkpoint

A new infrastructure adapter in `packages/storage/src/telemetry-journal.ts`
uses Dexie 4 with its own **version-1 telemetry-only** IndexedDB tables
(`events`, `metadata`). The database name includes the verified product,
channel and installation ID. An absent installation ID or an account-linked
queue is rejected rather than silently sharing storage. The original VK v2
folders and ChatGPT v3/v4 databases are never opened or migrated by Dexie.

The bounded journal keeps at most 5,000 sanitized numeric technical events,
counts discarded oldest events, and supports atomic claim/lease/ack/release
operations. Collector failure returns rows to pending; an expired lease can
be recovered after restart (at-least-once external delivery, not exactly-once).
There is no destructive `UpgradeError` or schema-reset fallback. This is
inspired by the offline OTLP queue in the user's HappyKids frontend working
tree; the GitLab main/develop branches did not yet contain those local
telemetry source files at inspection time.

`packages/adapters/src/scoped-otlp.ts` provides one common OTLP/HTTP logs
formatter and HTTPS-only delivery contract for all products. Each event carries
the application service, product, channel and instrumentation scope; one
collector may centralize records while local queues remain physically scoped.
It uses the already allowlisted `ScopedTelemetry` and `asTelemetryPort`.
Local collection and remote upload require **independent opt-ins**. No
endpoint, credentials, automatic probe or always-on sender is configured by
this source integration. Explicitly started delivery checks actual ingestion,
backs off on failure and removes only collector-acknowledged leased records.

**Integration level:** shared storage + transport API and synthetic IndexedDB
tests only. The current ChatGPT-specific runtime OTLP emitter has not yet
been switched over to this queue; VK and all-in-one composition roots still
need application-owned settings/consent, service wiring and installed-browser
permission and lifecycle acceptance. Do not claim centralized live logs until
an endpoint and explicit upload consent have been configured and tested.
Related implementation and decision task: Issue #30.

## Owner ordering correction (2026-10-11)

**Dexie application storage comes before network OTLP adoption.** The shared
scoped OTLP API and its local technical journal exist as optional code; do not
wire automatic exporter polling, select a collector, or copy legacy ChatGPT
URLs/error text into it yet. ChatGPT and VK have independent first-party
fixed-schema Dexie repositories under development. Real product telemetry
capture, consent, server probes and remote delivery follow acceptance of the
application persistence boundary and are tracked separately in Issue #30.
