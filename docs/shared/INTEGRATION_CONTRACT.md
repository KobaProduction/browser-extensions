# All-in-one composition and scoped provider connections

All-in-one composes VK and ChatGPT modules for different hosts in one
installer. Its **default databases and persistent settings belong to
all-in-one itself**; they must not collide with a standalone extension.

## Connection hierarchy

```text
all-in-one:dev  ── capability/consent ──► vk-booster:dev
               └─ capability/consent ──► chatgpt-booster:dev

all-in-one:prod ── capability/consent ──► vk-booster:prod
               └─ capability/consent ──► chatgpt-booster:prod

DEV ───X──► PROD            PROD ───X──► DEV
different owner ─X─► archive
```

- Sharing is **opt-in**. Host URL does not grant database access.
- All-in-one may obtain **read-only** query/snapshot/backup capability from a
  same-channel product after explicit user approval and account verification.
- The provider owns its storage and grants narrowly-scoped access. No
  hard-coded `indexedDB.open('other-product-db')` or cross-extension storage
  probing by the aggregator.
- Never merge two stores merely because their message IDs, URLs, owner labels
  or content hashes look similar. Explicit import goes through validation
  and a distinct destination scope, not live shared writable storage.
- Track provenance `sourceProduct/sourceChannel/sourceOwner/schemaVersion`
  for imported copies and allow revoke/disconnect without deleting source.
- Browser target capabilities differ; if a sanctioned connection transport
  cannot be supported by a userscript, report unsupported instead of
  introducing unsafe origin-global bridges.
- Connection semantics and codecs should be reusable across VK, ChatGPT and
  future extensions. Provider-specific schema stays in the provider.

**Current implementation:** standalone/aggregate isolation and composition
exist at source level; a user-consented same-channel connection to standalone
archives has **not** been runtime accepted. This document defines the future
capability contract rather than asserting it exists today.

Acceptance must cover all six installed combinations, channel and owner
mismatch rejection, read permission boundaries, concurrent archive updates,
reconnect and revocation. See [environment isolation](ENVIRONMENTS_AND_STORAGE.md).
