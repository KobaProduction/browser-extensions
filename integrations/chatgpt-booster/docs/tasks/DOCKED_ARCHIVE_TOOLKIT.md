# Docked archive toolkit — active task

Role: Implementer. Skills: software-engineering, terminal-operations.
Repository: KobaProduction/chatgpt-booster. Workspace: chatgpt-booster.
Baseline: v0.5.0 source tree, local fb108db / upstream 88efa1a (identical tree).
Work branch: feature/docked-archive-toolkit.

## User acceptance contract (2026-10-03)

- One edge-docked toolkit, default right; release on nearest edge; remember vertical ratio, not pixels. The toggle never moves when expanded; controls grow above/below it. No host layout changes.
- Human project names; IDs remain relational keys, exposed only through copy/diagnostics. Current project expanded in archive; others collapsed and individually expandable.
- Visible user/assistant replies are messages. Reasoning, tool calls/results and system/status records are child records, not extra messages. Raw record identity is preserved; grouping is a view.
- Recollect current chat by normal UI scrolling; observe relevant history response/ingestion. No synthetic private history calls. Errors must be scoped to that chat. Completion needs fresh contiguous pagination evidence, never scroll position or old boolean alone.
- Automatic capture is opt-in by project or chat, with per-chat override. Unselected scopes are not archived. Manual collection temporarily permits only that chat, even if automatic capture is off. Existing data is not deleted by changing policy.
- Contextual project/chat buttons open Booster capture settings without navigating/mutating ChatGPT.
- JSON and Markdown export with remembered format and level. Conversation-only; configurable reasoning/tool/internal records; full package. Image/file bytes off by default, metadata retained. Reader remains read-only.

## Resolved contradictions / findings

- v0.5 counted raw message records as visible replies. Derive separate visible/internal/raw counts.
- v0.5 completion was sticky and inferred from one oldest page and, on forced reread, a timeout at scrollTop=0. Remove that inference; old data is unverified until fresh capture.
- v0.5 stores use seconds for server time and milliseconds for observed time. Normalize for sort, never mix units.
- New selective capture supersedes older unconditional-capture requirement; apply default-deny to existing settings without removing historical data.
- A page script cannot generate trusted wheel input. Do not fake WheelEvent. Use real element scrolling in short wheel-sized steps, verify scrollTop and actual normal-client responses. No debugger permission escalation.
- Asset download/attachment body contracts are not classified in current project research. Do not invent URLs or treat metadata-only ZIP as a complete attachment backup. Full-binary export remains a separate acceptance gate unless a verified resolver is added.
- Existing host_permissions wildcard is for telemetry; do not expand permissions in this task.

## Validation gates

Pure tests: docking geometry/migration, time units, classification/grouping, selected export, capture precedence, pagination gaps/stale evidence, loader success/error/cancellation.
Build: all workspaces typecheck, Bun tests, Biome, both userscript variants and extension.
Runtime: edge/toggle geometry, project expansion, export/preferences, manual capture and scroll/ingest, exclusion, no writes from reader.
Independent review is required before calling the overall task release-ready. Self-review is not independent review.

## Status

Implementation checkpoint: see `EXTENSION_2_CHECKLIST.md` and `EXTENSION_2_VALIDATION.md`. 38 unit tests and 13 synthetic browser scenarios passed, along with TypeScript/lint/build. Live ChatGPT pagination/injection, pending-attachment reload safety, full binaries and independent review remain open. No new release is published.
