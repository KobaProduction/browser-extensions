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

**Current evidence:** VK native PR #10 supplies an optional
`ScopedTelemetry` interface and synthetic counter tests. A real telemetry
backend/transport, aggregation dashboards, consent persistence and installed
browser acceptance are still missing. Other services must adopt the common
contract deliberately, not pretend a VK mock proves their integration.

See [environment isolation](ENVIRONMENTS_AND_STORAGE.md) and
[project rules](PROJECT_RULES.md).
