# Environments, identity and state/persistence contract

**Normative across VK Booster, ChatGPT Booster, all-in-one and future modules.**

## Non-negotiable environment boundary

**DEV and PROD must never share writable databases, persisted settings, raw
archive files, session keys, cache entries, cross-tab events or telemetry
streams.** This includes multiple targets (Tampermonkey, MV3), accounts,
tabs and concurrent extension instances. A correct channel-specific UI alone
does not establish persistence isolation.

Every storage-capable instance has an explicit identity; the minimum
components are `productId`, `channel` (`dev|prod`), and where relevant
`accountOwner`, `profile/installationId` and the active conversation. The
resulting storage namespace is not guessed from a URL alone. Tokens and
account secrets are never used as raw storage names. An absent/unverified owner
must not be assigned another account's records.

A new physical DB/store, key namespace or tab event name must be derived from
this validated identity. Access without a validated scope fails **closed**;
no global fallback, implicit PROD-to-DEV migration or unscoped default DB.
Unknown or mismatched owner/channel must block reads and writes.

DEV/PROD have separate Tampermonkey update URLs/namespaces and distinct MV3
extension identities where necessary. Even when both inject into the same VK
or ChatGPT origin, their persistent records and private events must not mix.

## Layered state contract

| Lifetime and purpose | Required abstraction | Intended backing | Constraints |
| --- | --- | --- | --- |
| One component or view | Vue reactive state | Component memory | Disposed when view ends; never considered durable |
| One tab/session, navigation or in-progress UI | Session store / scoped tab state | Memory, scoped sessionStorage or browser tab-scoped adapter | Never leak to other tabs, app instances or channel; clear on session end |
| Whole application, small durable settings | **Pinia store + persistence adapter** | Environment/product-scoped local storage or `chrome.storage.local` | Explicit versioned schemas and key prefixes; separate settings backup |
| Large, indexed records, messages, receipts, reports | Repository interface with **Dexie** driver | Per-product/channel IndexedDB | Schema indexes, versioned migrations, bounded queries, transactions and backup |
| Downloaded binary files | Filesystem output adapter after permission | User-selected directory or target-specific file sink | Manifest ownership stamp, SHA-256 receipts, size and filename constraints |

**Implementation status:** Pinia persistence and Dexie are desired **shared
interfaces/technology targets**, not presently proven integrated in all
products. Existing first-party code uses Vue state, storage adapters and
native IndexedDB; ChatGPT v3/v4 has established schemas and owner proofs.
Introduce Pinia/Dexie only behind ports after verifying migrations and source
ownership. Never conflate dependency installation with data acceptance.

### Required API boundaries

- `SessionStatePort`: scoped get/set/remove/dispose; tab-scoped by default.
- `PersistentSettingsPort`: scoped, versioned settings read/write/export/
  validate/import; an adapter for Pinia, not provider business logic.
- `IndexedArchivePort`: scoped Dexie-backed database with explicit schema
  versions/indexes/transactions; each provider supplies its own tables,
  indexes and anti-corruption mapping.
- `FileOutputPort`: user-permissioned export/restore destinations, byte/hash
  verification, no extension-owned implicit filesystem access.
- `TelemetryPort`: scoped, optional, sanitized events; see
  [telemetry](TELEMETRY.md).

These are acceptance contracts and suggested port boundaries, **not claims
of exports already present in `packages/*`**.

## Isolation acceptance matrix

A six-way matrix must be exercised in **the same browser profile**:

`vk:dev`, `vk:prod`, `chatgpt:dev`, `chatgpt:prod`,
`all-in-one:dev`, `all-in-one:prod`.

Tests must assert separate physical DB names and stores, chrome/tampermonkey
settings, session/navigation events, launcher roots, telemetry scopes and
import/export ownership. Reinstall, reload, browser restart, concurrent tabs
and failed migration must not copy or overwrite sibling data.

Do not advertise six-way co-installation as accepted from build or static
namespace tests alone. Actual installed-browser data checks are required.

## Controlled aggregation

All-in-one DEV can request data only from **DEV** registered services,
and all-in-one PROD only from **PROD** services. This is *optional scoped
integration*, not permission to open every IndexedDB database with arbitrary
names. An aggregate and standalone still have separate default storage.

Access uses a versioned, audited provider-neutral capability/port with:
- exact channel + product + validated owner/installation identity;
- explicit user consent and access mode (read-only until separately approved);
- source-side authorization and a source-produced snapshot or query response;
- no direct aggregate access to a foreign extension private DB;
- revocation and cross-channel/cross-account rejection;
- testable behavior when a provider is absent, disabled or upgraded.

See the owning [integration contract](INTEGRATION_CONTRACT.md) and
[backup/restore contract](BACKUP_AND_RESTORE.md).
