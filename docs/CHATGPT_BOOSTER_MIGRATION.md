# ChatGPT Booster migration to Browser Extensions

**Scope:** source-preserving initial integration, branch `feat/chatgpt-booster-monorepo-migration`, based on `refactor/extract-shared-booster-platform@acfe36f`. The old `KobaProduction/chatgpt-booster` repository has **not** been deleted. No browser data is migrated merely by installing a new build.

## Source and preservation

- Imported from the existing persistent `chatgpt-booster` workspace, branch `feature/archive-canonical-migrations@c7aaeac`, **including** its uncommitted archive backup, restore, SHA-256 audit and gzip changes. The uncommitted source delta is retained in the local ignored migration workbench; the actual source files were imported into the new repository.
- The original browser storage names and account scopes remain unchanged (`chatgpt-booster-archive` v3 and `chatgpt-booster-archive-v4` v4/canonical). This is code relocation, **not** authorization to clear, reset or rewrite real Chrome/IndexedDB profiles.
- All original source packages (`core`, `chatgpt`, `features`, `observer`, `telemetry`, `ui`) live for now in `modules/chatgpt-booster/packages/`; original target-specific settings, telemetry, background, popup and observer implementations remain under the same module. New `apps/` entrypoints perform delivery-specific composition. This keeps project-specific native ChatGPT transport, lifecycle and owner authorization out of the shared package layer.
- The original `tests/` corpus and browser harness were transferred into `modules/chatgpt-booster/tests`. These preserve source/API/timing/metadata/recovery regression evidence. Do not equate passing tests with live ChatGPT acceptance.

## Implemented mapping (provider vs shared ownership)

| Capability | Monorepo owner | Current state |
|---|---|---|
| Module registry, capability checks, enable/disable | `packages/core` | Shared platform used by VK and ChatGPT |
| Shadow DOM, one launcher and Control Center | `packages/shell` | Shared; ChatGPT's legacy `OverlayModule` is disabled by hosted composition |
| ChatGPT saved Reader, history capture, canonical migration, owner reconciliation | `modules/chatgpt-booster/packages/features` | Ported; original storage namespace preserved |
| ChatGPT reasoning, tool UI, archive export, metadata, migration diagnostics | `modules/chatgpt-booster/packages/ui` | Ported; mounted as ChatGPT's module view inside the shared shell |
| Generic gzip output, source-neutral archive ports/checkpoint vocabulary | `packages/archive` | New extracted shared package; ChatGPT uses its gzip implementation |
| Native ChatGPT history signatures and transport observation | `modules/chatgpt-booster/packages/observer` | Provider-local, not shared with VK |
| Chrome MAIN-world observer, runtime background/popup, restricted ChatGPT manifest | `apps/extension`, `modules/chatgpt-booster/packages/extension` | New module-specific experimental Chromium bundle |
| Tampermonkey grants, page-world observer and saved local settings | `apps/userscript`, `modules/chatgpt-booster/packages/userscript` | New experimental ChatGPT userscript bundle |
| VK exporter v2: 3k messages, media, filename, offline HTML/resumption | `modules/vk-booster` | **Unmodified**; existing v2 compatibility stays authoritative |

## Build, permission and release boundaries

- `bun run build:chatgpt` produces `dist/chatgpt-booster/chatgpt-booster.user.js` and `dist/chatgpt-booster/chatgpt-booster-extension.zip`; `bun scripts/build.ts --module chatgpt-booster --target userscript|extension` builds a single target.
- `modules/chatgpt-booster/module.json` has `release:false`; the default `bun run build` and the independent module release plan still publish only accepted VK/all-in-one products. No automatic update or installer migration occurs.
- The ChatGPT MV3 manifest includes a separate MAIN-world observer and isolated content script, ChatGPT host scope, storage/background functionality, and no proxy privilege. Userscript and extension must never be enabled simultaneously with the old Booster on the same page until a duplicate-observer/live-ownership acceptance pass.
- The original optional external telemetry endpoint may require separately reviewed host permissions in MV3. It must not be silently broadened to all hosts or treated as working without browser acceptance.
- A new code repository **does not** migrate installed Tampermonkey scripts, extension IDs, Chrome storage partitions, or signed store identity. Domain records and user permissions must not be claimed to travel automatically with an extension-ID change.

## Remaining acceptance gates (not completed by source relocation)

1. Full installed Chrome/Tampermonkey acceptance against current ChatGPT pages, memory-first capture, history scrolling, model/tool metadata, event routing and no duplicate shell or observer.
2. Existing v3/v4 IndexedDB migration and export parity on a **safe backup** of a real user profile, including the known two unimported chats, owner ambiguity and very large tool-result exports.
3. Independent backup/restore, failure recovery, cross-account switch, rollback and size/performance validation for canonical generations. `packages/archive` is only the first portable output/contract extraction; the VK v2 archive engine and ChatGPT canonical engine are **not yet** one common persistence implementation.
4. UI visual verification for Archive Browser, Export Wizard, shared shell and responsive/dark styles in both delivery targets.
5. Independent reviewer acceptance of source equivalence, capability permissions, build artifact contents and ownership/dependency direction before merging.

Do **not** delete the old repository or old browser databases until a separately accepted migration cutover with independently restorable user data.

## Source documentation preservation

The original ChatGPT Booster architecture, source-signature research, runtime
contracts, archive target architecture, DOM adapters, product operations and
historical acceptance checkpoints are retained verbatim under
`modules/chatgpt-booster/docs/`. These documents remain **product-local**
contracts, subordinate to this monorepo's approved architecture for ownership
and package boundaries. Any dated old validation is historical evidence and
not acceptance of the new binary or new extension identity.

The canonical backup import UI is available on a newly installed ChatGPT
module with no active canonical generation: it requires a manually selected
GZIP file and an account-scoped explicit confirmation, validates every
source fingerprint and the backup footer, stages all data in a new generation,
and only then promotes it. It preserves existing generations and does not
claim to import unbound v3-only records or binary attachment bytes.
