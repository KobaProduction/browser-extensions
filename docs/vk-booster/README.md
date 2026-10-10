# VK Booster

**Owner:** `modules/vk-booster/`. Browser targets: Tampermonkey userscript and
Chromium MV3. Provider-specific VK source API, message representation,
attachment retrieval, repository and presentation belong here.

## Documentation

- [VK Archive contract](ARCHIVE.md) — full capture, native storage, viewer,
  file selection, export format, hashing and expected data completeness.
- [Shared environment/storage rules](../shared/ENVIRONMENTS_AND_STORAGE.md) —
  distinct VK DEV/PROD and standalone/aggregate identities.
- [Shared backup and restore](../shared/BACKUP_AND_RESTORE.md).
- [Shared telemetry](../shared/TELEMETRY.md) (`VK Booster Service`).
- [Aggregate connection](../shared/INTEGRATION_CONTRACT.md).
- [DEV/PROD release channel](../DEV_PROD_CHANNELS.md).
- [Implemented architecture](../ARCHITECTURE.md) vs
  [target architecture](../TARGET_ARCHITECTURE.md).

## Intended product behavior

Open a VK conversation, capture its complete accessible message history into
a local indexed archive **without downloading file bodies**. Review archived
messages offline, then run an independent date-/attachment-filtered export to
a selected user directory. Check and recover downloaded attachment metadata
and backup/restore the database separately from the exported attachment files.

The VK archive is **not** the ChatGPT database. The all-in-one product does
not gain direct access to standalone VK records automatically. DEV does not
share any persistent or session state with PROD.

**Version rule:** VK Booster product base is held at **3.0.0** during ongoing
development; only prerelease build IDs `3.0.0-dev.N` advance automatically.
No VK 3.0.1/3.1.0 without explicit owner authorization.

## Implementation versus target

The default `main` branch historically contains the old VK v2 exporter.
The new IndexedDB-first VK Archive 3 is proposed in
[PR #10](https://github.com/KobaProduction/browser-extensions/pull/10).
Do **not** claim it is deployed until the PR merges and installed-browser
acceptance is evidenced. Its synthetic full-history and SHA-256 tests are
source-level evidence, not proof of live VK API/media handling.

Representative source (on the VK 3 branch):
`modules/vk-booster/src/model/`, `infrastructure/`, `api/`,
`ui/`, and `apps/dev-archive-lab/`. Reusable paging mocks belong to
`scripts/dev-harness/`.

## Local development

From the repository root:

```bash
bun run check
bun scripts/build.ts --module vk-booster --channel=dev --build-number=1
```

On the VK 3 implementation branch, `bun run dev:archive` starts a
synthetic memory-only archive lab at `http://127.0.0.1:5187`, with no
VK login and no persistent provider data. This verifies the local UI, not
browser extension injection or actual VK API authorization.

Open implementation issues with `### Target extension\n\nVK Booster`,
linking to [ARCHIVE.md](ARCHIVE.md) acceptance criteria. Do not copy the
entire specification into each Issue.
