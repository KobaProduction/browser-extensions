# Extension 2 — checkpoint validation (2026-10-03)

Scope: `feature/docked-archive-toolkit`, recovered implementation plus the consent/evidence/export/loader fixes in this checkpoint. Role: Implementer. No native subagent spawner was exposed in this session; no agent was launched and no independent review is claimed. No release/tag or default-branch merge is part of this checkpoint.

## Source and build

Entry baseline: 34 Bun tests passed; workspace TypeScript passed; Biome failed on two files and warned about CSS specificity. The old 29/2 result in earlier task notes is historical.

Current unit coverage: 38 pass, 0 fail, 91 assertions. Includes docking geometry, settings migration, policy precedence/manual category retention, classification/grouping, pagination gaps/read identity, and basic/custom export boundaries. Vue files are excluded by repository Biome configuration; Vue is typechecked and compiled, not claimed as Biome-linted.

Validation jobs: `b2503eb31fd0415ebd8e1a2bdc17d8e0` and final `e9a234fa0e7d411d9be696175aed52b5`. Final job covers fixture Vue/TypeScript, all workspace TypeScript, Biome, Bun tests, extension build and production/development userscript builds. The final job completed successfully with exit code 0; the fixture typecheck, all workspace typechecks, lint, tests and all three builds passed. Existing Tailwind sourcemap warnings remain; a successful build does not remove them.

## Browser evidence

Real Chromium, production source modules on a separate local fixture origin. Test sources: `tests/browser/`. Synthetic transport/page data, not requests to ChatGPT. The current fixture conversation contains exactly 110 replies and 55 nested records.

Seven storage/capture checks passed: unique IDs/idempotency and updates, eight concurrent ingests without lost counts, cancellation before DB puts, concurrent project title retention, removal of project links on all normalized messages, basic export privacy with real storage objects, and selective/manual/cancel capture.

Two delayed-response tests initially FAILED: both explicit stop and navigation could still open the archive after a late complete DB response. Both now PASS after post-await ownership/consent checks. The stop handler publishes cancellation immediately.

One scroll/evidence test passed: real overflow scrollTop decreases; reaching the top alone does not complete the operation; an ingested linked continuation completes it and opens that conversation's archive. The initial page is counted even if ingested before the loader subscribes. This does not prove current ChatGPT pagination triggers or retry behavior on a live long chat.

Three UI tests passed at 1024×768 and at 390×844: flush edge placement, unchanged toggle anchor and host geometry, repeat-click close, synthetic-pointer left docking with vertical ratio, integrated upward/downward growth, current-project-only expansion, independent project disclosure, 40 initial exchanges then 55, lazy tool details, and no composer/edit form. Touch viewport emulation is not a physical touchscreen test.

Manual browser checks: persisted left/0.2 docking survived a full reload and resize from desktop to 390×844 (x=0, y=160). Native Escape closed the panel and restored the toggle. Light and dark CSS rendered; complete English copy/accessibility acceptance remains open.

Native export button clicks produced basic JSON with `chatgpt-booster.export.v1`, 110 replies, zero nested records and no originalRecord leak; configurable Markdown contained selected tool records. Closing/reopening restored Markdown/custom preferences. Image/file flags defaulted to false. Full mode displayed the unverified-attachment-contract notice and disabled download. The browser's downloaded files were not retrieved and independently verified: do not close the full download-persistence gate on serializer output alone.

Machine-readable local browser report: `evidence/extension2-runtime-20261003.json` (file read and parsed in Terminal; 13/13 passing scenarios). No user conversation content is included.

## Fixes in this checkpoint

1. Manual consent now bypasses automatic enablement only, retaining selected reasoning/tools/internal categories.
2. Persistence rechecks consent after asynchronous DB reads, before any puts; cancelled queued writes are discarded.
3. Same-page duplicate IDs are normalized before insertion counters are computed.
4. Project name upsert uses one read/write transaction and cannot overwrite an observed name with concurrent null/blank input.
5. Equal-request initial evidence uses the latest observation; older reads cannot establish a newer read's completeness.
6. Export projects only explicit conversation fields instead of leaking the storage object's raw metadata.
7. Loader rechecks ownership after awaits; late completion cannot succeed after stop/navigation. Initial page progress is retained.

## Remaining gates and tracked findings

- Live ChatGPT acceptance of the newly docked build, injected controls, long-chat history pagination, 429/network/auth/storage handling, and target-specific Tampermonkey installation is NOT complete.
- `collectCurrent()` reloads the tab after confirmation to establish a fresh initial read. Text drafts and active generation have guards. Pending file/image attachments require additional verified DOM handling before E050 can close. Do not silently reload a draft with attachments.
- Late DOM project-name discovery/persistence and all SPA/stale-reader edge cases still need explicit runtime tests.
- Physical touch dragging, Clipboard API on the real secure origin, complete locale/focus/accessibility and native downloaded-file validation are pending.
- Binary attachment URL/resolver contracts are unclassified. Full ZIP is deliberately unavailable. No metadata-only result is a complete backup.
- Independent review remains required before release-ready. The writer must not self-approve under a second identity or merge its own PR.

The Terminal service briefly returned connection/502 failures during checkpoint recording. Read-only inspection confirmed that the interrupted mutation had not executed; it was applied once after recovery. No source delta was lost.

## Recovery and next boundary

Original delta backup: `/workspace/projects/chatgpt-booster-resume-7kjogl0p/{tracked.patch,untracked.tar.gz,state.txt}`; entry HEAD `90687b8`. Applied state is recorded on the working branch; exact checkpoint refs are in Git history. Next work starts with pending live-runtime safety/attachment guards, not a release.
