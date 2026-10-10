# All-in-one — Koba Browser Tools

**Owner:** `apps/userscript/` and `apps/extension/`. This installer is the
product-aware composition of VK Booster and ChatGPT Booster, not a third
provider archive or unrestricted controller of their private databases.

## Documentation

- [Integration and opt-in provider access](../shared/INTEGRATION_CONTRACT.md)
- [DEV/PROD and scoped storage rules](../shared/ENVIRONMENTS_AND_STORAGE.md)
- [Settings/data backup](../shared/BACKUP_AND_RESTORE.md)
- [Per-service telemetry](../shared/TELEMETRY.md)
- [Current release channels](../DEV_PROD_CHANNELS.md)
- [VK product](../vk-booster/README.md) and
  [ChatGPT product](../chatgpt-booster/README.md)

## Capability boundaries

The bundle loads the matching provider only on its supported origin and
provides a **single shared Control Center**. It must not duplicate provider
engines or build one monolithic interchangeable conversation model.

The aggregator has its own product/channel identity, settings and default
archive storage. A future optional connection follows exact pairing:

- `all-in-one:dev` → authorized `vk-booster:dev` and/or
  `chatgpt-booster:dev`.
- `all-in-one:prod` → authorized `vk-booster:prod` and/or
  `chatgpt-booster:prod`.

No cross-channel, unverified-account or silently shared writable storage.
A provider-owned capability, explicit user consent and a snapshot/query
interface are required before reading standalone data. This remains a
**target contract**, not proof that cross-extension access is implemented.

## Verification

Acceptance includes separate DEV/PROD extension identity, UI roots,
persistent settings, tab/session state, telemetry and archives; both
standalone providers and both aggregate channels co-installed in one browser
profile; disabled provider handling and restart/reinstall; safe import and
rollback. An ordinary build does not prove these conditions.
