# Extension 4 Tampermonkey acceptance checkpoint

Date: 2026-10-05

Tested runtime line: `0.8.2` on real ChatGPT through Tampermonkey 5.5.1 with `runtime_content_mode=userscripts-dynamic`.
Primary transport fix ref: `278b5564d192179dd0963280cd322786c0b76825`.
Late-start runtime-tested build ref: `794faafb9cb8b7c218a2c5b79d69add8175570ff`.
Published equivalent source commit on `dev`: `94c9515` (same repository tree for the tested code change; SHA changed when the validated patch series was replayed through the GitHub App-managed checkout).

## Runtime findings

- Tampermonkey has access to Chromium `chrome.userScripts`; the earlier browser-level Allow User Scripts blocker is no longer present.
- The normal Booster extension was not used for this acceptance path; the active runtime was the Tampermonkey userscript.
- The userscript mounted one Booster root and one metadata decorator per visible conversation turn after reload and SPA navigation.
- The transport observer now survives ChatGPT replacing `window.fetch` after `document-start`.
- On the real long chat `Сила Magic Lantern`, manual collection advanced from one saved page through four linked history pages and completed with `completeAtLastRead=true` and `hasOlderServerHistory=false`.
- That completed archive contained 63 unique message IDs: 34 visible messages plus 29 internal records, with no duplicate message IDs.
- A hard reload preserved one Booster root, one metadata mount per visible turn and the complete archive state.
- SPA navigation chat A -> chat B -> chat A kept one root, refreshed metadata to the active conversation and did not create duplicate scope controls.
- A conversation-level autosave override changed the sidebar marker to the enabled state without reload; the test restored the rule to inheritance afterward.
- The `/projects` page mounted one 28x28 project control for the observed project row and exposed project-local archive/autosave state.
- Archive UI rendered stored `web.run` tool call/result records with provider/action and timestamps. Current completed ChatGPT turns did not retain a separate live tool-call DOM node, so no false live tool inspector was synthesized from citation pills.
- JSON export reached the prepared state with a downloadable file; the dialog exposed JSON/Markdown providers from the export registry and the expected composition levels.
- No Booster CSP/runtime error was present in the console during the final runs; only Chromium's unrelated active-WebGL-context warning was observed.

## Late-start regression

A late-start case was reproduced by loading an unarchived chat, deleting only its Booster preload pages after the ChatGPT DOM was already rendered, and then starting manual collection.

Before the fix, a full server initial page and a later DOM fallback page could share one manual read. `historyCoverage()` selected the newer DOM fallback even though its pagination booleans were unknown, degrading explicit server completion evidence and leaving the loader stuck in `waiting_for_load`.

The fix ranks initial pages within the same read by evidence quality before `observedAt`. Explicit server `has_previous_page` / `has_next_page` evidence therefore wins over a later DOM fallback with `null` pagination fields, while a newer read still supersedes older reads.

Validation after the fix:

- archive-toolkit regression suite: 38/38 passed;
- features TypeScript check passed;
- userscript build passed;
- full repository `bun run check` completed without errors (Biome reported existing style infos/warnings in test sources only);
- exact local userscript `0.7-794faafb` was installed into Tampermonkey; the equivalent published source change is `94c9515`;
- on a second unarchived real chat, preload was removed after render and manual collection recovered through the DOM fallback, then completed with `completeAtLastRead=true`, `hasOlderServerHistory=false`, 22 stored records and archive state `complete`.


## Export and attachment acceptance

- JSON export was validated from the actual generated Blob: schema `chatgpt-booster.export.v1`, correct conversation identity, verified coverage and expected stored-record count.
- Markdown export was validated from the actual generated Blob with the expected conversation title, coverage block and user/assistant transcript.
- Full ZIP was parsed from actual Blob bytes, including `conversation.json`, `manifest.json` and `records.raw.json`.
- Archive-selected export was tested independently of the current-chat toolkit and exported the selected archived conversation identity.
- A real ChatGPT image attachment (`1000005889.jpg`) exposed the observed `backend-api/estuary/content` signed-URL contract.
- Expired/stale asset resolution produced a truthful `fetch_failed` manifest entry instead of a false complete backup.
- A userscript-world bug was found: binary export used the sandbox `window` for the archive-asset message bridge while the page observer lives on `unsafeWindow`, causing 30-second timeouts even when the same signed URL fetched successfully in page context.
- `createArchiveUiAdapter` now accepts an explicit asset-fetch target; the userscript passes `unsafeWindow` while the extension keeps its default target.
- With local `0.8.2`, the real JPEG was included as `attachments/1000005889.jpg`; expected and actual size were both 208775 bytes, JPEG magic was valid, and the computed SHA-256 exactly matched `manifest.json`.

## Local workbench rule

Disposable browser-import copies, scratch outputs and agent-only test artifacts belong under `/.work/`, which is ignored by Git. `AGENTS.md` records this repository rule so future agents do not create ad-hoc temporary files in the repository root.

## Publication status

The validated patch series is published to `dev` through the `koba-ai-agent` GitHub App. The user-token account can read the repository but its write paths returned 403/404; `koba-ai-agent` is the authoritative write identity for this repository workflow. The current source change is staged for the next rolling push, which resolves to version `0.8.2`.
## Review gate resolution

- Checklist status after this acceptance pass: 102/102 items resolved at their stated evidence levels or explicit waiver.
- E102 was not performed as an independent reviewer run. Issue #25 records a direct user decision waiving that gate for this iteration because no independent reviewer runtime is available in the current session.
- The waiver must not be represented as an independent APPROVED review; `koba-ai-reviewer` is only a separate GitHub identity, not a separate reasoning agent.
