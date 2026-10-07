# ChatGPT browser workflows — product behavior study

Last reviewed: **2026-10-07**. This is a map of **user-visible actions and observable outcomes in ChatGPT**, not an implementation backlog for ChatGPT Booster. It keeps actual browser acceptance distinct from deployed-client interpretation and the public product documentation. Feature availability depends on the account, subscription, workspace permissions, selected mode/model, and rollout.

## Evidence vocabulary

- **Live** — a native action and its result were actually observed in the test browser or in the existing dated acceptance records. A success on one account/build is not a global guarantee.
- **Live UI only** — an affordance/route was observed, but its write or downstream action was not exercised or confirmed.
- **Client implementation** — a behavior was traced in the current deployed client, not necessarily executed end to end.
- **Official documentation** — supported in OpenAI product help; not yet tested in the current account/browser.
- **Blocked / failed** — an actual attempt did not complete. Preserve exact conditions and never silently promote it to success.

Two distinct browser contexts were investigated: a managed persistent Chromium signed into a **Free** account, and a separate **external Playwright MCP** at `192.168.1.11:8931` with a live **Intens Tech · Pro** profile. Do not mix their UI or quota observations. The external Playwright MCP uses the user's Chrome context, not the Koba Web managed Chromium. Browser-tool timeouts are not the same as product errors.

## Primary user-workflow coverage

| Area | User interaction | Evidence | Result / boundary |
| --- | --- | --- | --- |
| Ordinary chat | Create chat, submit message, stop response, rename/delete, load history | Live | Transport, run identity, stop acknowledgment, rename/delete and load-error outcomes are documented in `CHATGPT_RUNTIME_CONTRACTS.md` and `CHATGPT_PRODUCT_OPERATIONS.md`. |
| Chat alternatives | Edit user message, select previous/current versions, request assistant variant, true branch/nested branch | Mixed live + client implementation | Edit/version graph and branch parent navigation observed; exact native ordinary Retry and `POST /conversation/new_branch` payloads still need live capture. |
| Model/reasoning | Change model, effort, send and verify outbound fields | Live UI Pro + earlier runtime capture | Free `Размышление` opened Plus upsell; on Pro the normal Chat composer showed `Высокий`, while Work showed `GPT-6 Astra` and an inspection-only Booster warning. The exact current selector mutation/outbound payload still requires a separate live acceptance. |
| Projects | Create, set instructions, save, first chat, delete | Live | Explicit `Save` for Instructions; memory state differs by account; project-file preview/download/delete described officially but not end-to-end tested here. |
| Work | Start Work conversation, inspect subagents | Live in earlier capture | `conversation_origin=tpp`, subagent lifecycle, panel and detail call observed. Cloud Browser/computer-use actions are **separate** and not yet accepted through native Work. |
| MCP apps | Create custom server app, OAuth/DCR/PKCE link, call/inspect tools, reconnect, permissions, refresh, rename, icon, delete | Live earlier + Pro catalog UI | Main OAuth path well covered. Pro `/plugins?directoryTab=personal` showed personal Koba Analysis/Files/GitLab/Web/MCP Bridge/GitHub. The public directory is distinct from personal apps. No-auth, hybrid OAuth, Tunnel, second link removal and sharing remain untested. |
| Scheduled | One-shot, recurring, condition monitor, list/edit/pause, run-now, date/title/prompt edit | Live earlier + Pro template UI | Existing earlier task management acceptance remains valid. Pro `/scheduled` exposed templates for email checks, reading, prices, concerts, weekend plans and flights. No new task was created in the Pro test; app-event triggers and sharing remain untested. |
| Uploaded image in conversation | Persist across branch, edit, response variant and reload | Live | Previous image/Estuary resolver acceptance exists; not equivalent to arbitrary CSV/PDF/XLSX upload. |
| File library | Browse/search/filter, file preview, file versions, download | Live Free + Pro | Free Library Markdown preview/download succeeded. Pro `/library` redirected to `/space`, which has Recommendations/Favorites/Your items/Shared with you, grid/list, folder and search surfaces. Pro synthetic CSV persisted after page reload, opened in a spreadsheet preview and exposed Download. |
| Library upload | File picker → add new synthetic CSV to Library | **Free blocked; Pro live** | Free Library quota blocked cloud storage. Pro Space accepted a synthetic 87-byte CSV through its file input; the backend accepted upload/process operations and the file survived a full page reload. The Free account's existing files were not deleted. |
| Library file → new Chat | Select existing file, `Начать чат`, submit document-processing request | **Free failed; Pro live** | Free instance previously staged a file but the model did not receive it. In Pro Space, selecting the synthetic CSV and `Начать чат` placed a typed Library reference in the ProseMirror composer; after submit Python opened the exact 87-byte file and produced a verified aggregation. The Free failure remains a separate account-specific observation. |
| Composer upload | Attach a synthetic 87-byte CSV to a chat during Library quota exhaustion | **Live** | UI identified the file as spreadsheet and explicitly indicated **only in this chat**, not Library; quota notice was a dismissible modal. Attachment remained after dismissing it and was attached to the outgoing user turn. |
| File content analysis | Group synthetic CSV `amount` by `category` and `month` | **Live Python trace in Pro** | Free answer had no captured code trace. In Pro native `Просмотр анализа` displayed Python code and STDOUT: source exists and size 87, 4 rows, grouped totals 25/25 and 30/20, generated CSV 94 bytes, reopened and validated. Distinguish this trace from the model's prose claim. |
| Generated file | Open a generated CSV and download it | **Live** | Generated file appeared as an attachment, opened in a native spreadsheet-like preview (formula bar / import view) and was downloaded via its own `Скачать` control: 32 bytes, filename `booster-file-flow-20261007-summary.csv`. |
| File formats | PDF, DOCX, XLSX, PPTX, audio, multi-file upload/preview, downloads from tool outputs | Official documentation; partly untested | Available types are plan/model dependent. Prior successful Markdown and CSV tests do not prove every format or every renderer. |
| Python / data analysis | Code execution, charts, tables, notebook/artifact visibility | **Live Pro code and stdout** | Native `Просмотр анализа` showed two Python code cells with actual STDOUT and output-file round-trip. The generated-file pressable existed, but independently observing its download into the external computer remains a separate acceptance boundary. Charts/interactive DataFrames untested. |
| Search / Deep Research | Public web, site restrictions, research plan/progress and report downloads | Official documentation | Deep Research supports plan review, citations and export; execution and downloads not yet tested in the current browser account. |
| Study | `@study` / study mode in normal chat | Official documentation | Not tested. Availability differs for temporary chats, GPTs and Projects. |
| Voice/audio | Dictation, voice chat, audio uploads/transcription | Live UI affordance + official documentation | UI exposed dictation and voice launch; capture/processing/recording flow not tested. |
| ChatGPT Sites | Create Site, hosted MCP/Plugin, publish, linked recurring Site updates | **Pro first-entry UI live** | Pro `/space/sites` opened a first-entry terms dialog describing site-owner responsibility and visitor-data obligations. The terms were **not accepted**, no Site was created; hosting/publishing and Sites-linked schedules remain untested. |
| Work files | Generate editable documents, sheets, slides or reports; collaborate with connected Google apps | Official documentation | Work artifact creation/editing, review and export need separate acceptance. |
| Team tasks | Shared ownership, scheduled/triggered recurring team work, team review and action permissions | Official documentation | Dedicated team-task management, shared responsibility, provider permissions and executions have not been live accepted. |
| Desktop browser vs cloud browser | Built-in desktop browser, Work cloud browser, Codex Chrome integration | Official documentation | Different execution/session/permission surfaces; the persistent **Koba Web test Chromium is neither a live Work Cloud Browser run nor proof of desktop built-in-browser capabilities**. |
| Library productivity | Create image, note or folder; Library filters | Live UI Free + Pro | Free Library showed Image/Note/Folder/Upload. Pro Space `Создать` exposed Page, Site, Image, Folder, Space, Templates, Upload files, Connect plugin. Presentation and Spreadsheet entries were present but explicitly **disabled as coming soon** in this entrypoint. |

## File study fixture and verified path

Only synthetic CSV data was deliberately sent for the new test. It was four records:

```csv
category,amount,month
alpha,10,2026-09
beta,20,2026-09
alpha,15,2026-10
beta,5,2026-10
```

Results:

1. The shared browser-workspace file was prepared as an **87-byte** CSV and selected through ChatGPT's real file input.
2. Library upload was blocked with the explicit storage-full / change-plan prompt.
3. Uploading the same CSV from the **chat composer** succeeded as a chat-only attachment. The quota prompt did **not** require deleting files; closing it preserved the attached CSV.
4. A new message explicitly requested grouping and downloadable CSV output. ChatGPT rendered the input CSV as a spreadsheet attachment and returned a generated CSV.
5. The generated file opened in the spreadsheet preview. Its native Download control wrote the **32-byte** `booster-file-flow-20261007-summary.csv`.
6. The downloaded bytes were independently inspected and contained:

```csv
category,total
alpha,25
beta,25
```

This independently proves the answer contents and native file-download result. It does **not**, by itself, prove which internal code-execution tool was invoked. The model stated that it used Python, but no separate execution trace was captured.

Separately, a pre-existing saved Markdown file was opened from Library and downloaded successfully (141,226 bytes). Its filename/content were deliberately excluded from the repository evidence because it is not disposable test data.

**Distinct storage behavior:** `Library file saved`, `composer chat-only attachment`, `model can read attachment`, `generated file attached`, and `download succeeded` are five different acceptance boundaries. Do not equate a draft chip with a model-readable file or a displayed file card with saved bytes.

## Pro external-Playwright file acceptance (2026-10-07)

Context: **external** Playwright MCP at `192.168.1.11:8931`, reusing an already authorized remote Chrome profile, verified by the native profile menu **Intens Tech / Pro**. The pre-existing Work test tab remained open; test actions used a separate second tab. This does not imply the managed local Free browser shares that account.

1. **Space / Library discovery:** `GET /library` as a browser navigation landed on `/space`. The Space library showed recommended, favorites, your items and shared-with-you, search and list/grid views. `Создать` exposed Page, Site, Image, Folder, Space, Templates, Upload and Connect plugin. Presentation and Spreadsheet were visible but disabled with `Скоро будет доступно`; this is a **menu-entrypoint** limitation, not proof that Work cannot generate these artifacts.
2. **Synthetic upload:** a browser-side `File` was selected using the actual Space `input[type=file]` and change event, with an 87-byte CSV named `booster-pro-workflow-20261007.csv`. This simulates choosing a file in the input; it does **not** test the OS-native file chooser dialog. The UI displayed `Загружено`; native transport included `POST /backend-api/files` (200), upload of the bytes (201) and `POST /backend-api/files/process_upload_stream` (200). The file appeared under Your items and survived a full page reload. No existing user files were touched.
3. **Preview:** opening the saved CSV navigated to `/space/file/<library-id>`, and displayed a spreadsheet canvas, formula bar at A1 and a Download control. Native `POST /backend-api/files/library/files/<library-id>/opened` returned 204. The Download control was activated; `GET /api/library/files/<library-id>/content` returned a 302 redirect. There is **no independent verification** of the browser-host output file's bytes after this redirect.
4. **Space → Chat:** selecting only the test file exposed `Начать чат / Скачать / Удалить`. `Начать чат` opened the normal **Chat** composer (not Work), with the file represented in ProseMirror as a `chatgpt-library-file-mention-id` plus original file ID, MIME type and the `library_start_chat` entrypoint. A synthetic-data aggregation request was submitted and persisted in a distinct test conversation.
5. **Python proof:** ChatGPT completed the response in roughly 40 seconds and showed two completed Analysis steps. The native `Просмотр анализа` dialog displayed actual Python source and STDOUT, not merely the assistant's narrative. The first code block read `/mnt/data/booster-pro-workflow-20261007.csv` and printed `exists: True size: 87`, the CSV delimiter, exact three headers and sampled rows. The second code block used `csv.DictReader`, `collections.defaultdict` and `decimal.Decimal`, aggregated dimensions and wrote `booster-pro-aggregated.csv`. STDOUT reported all four rows and `Output readable: True bytes: 94`; code reopened the output for a comparison assertion.
6. **Expected aggregates:** `category/alpha=25`, `category/beta=25`, `month/2026-09=30`, `month/2026-10=20`, total amount 50. The response displayed those values and a generated CSV link. The browser-generated file link was present, but separate external-browser local download/byte inspection is **not yet accepted**.
7. **No destructive cleanup:** a clearly named 87-byte synthetic fixture and one test conversation remain available in this Pro account for a reproducibility check; no other files, task schedules, apps or credentials were modified.

The previously observed **Free** attempt that staged a library document but received a model `no accessible files` response is not evidence of a universal Library-to-chat failure. The healthy **Pro** Space file-to-chat-to-Python path worked end to end.

### Pro scheduled, Sites and app catalog surfaces

- Pro `/scheduled` exposed a template gallery for email monitoring, weekend reading, price alerts, concerts, outings and flights. No schedule was created or mutated in this pass; earlier native task editor acceptance remains separate.
- Pro `/space/sites` immediately displayed **Sites terms of use**, including user responsibility for hosted content and visitor personal data. The agent **did not agree** to these terms or create a site; consent/publishing is an explicit future decision boundary.
- Pro `/plugins` exposed public and personal tabs. `/plugins?directoryTab=personal` displayed the account's custom Koba apps, including Web, Files, GitHub, GitLab, Analysis and MCP Bridge. Viewing the catalog is **not** proof that each app is connected or that a tool invocation succeeded.

## Higher-value browser-agent capabilities discovered in product help

1. **Scheduled event triggers and monitoring**: beyond daily/weekly reminders, supported app events can initiate eligible jobs; task sharing, notification channels, provider permissions and approvals are separate controls. Tasks created within Projects cannot read that project's uploaded/stored files, per current OpenAI help; capture this as a scope limitation, not an inferred exception.
2. **ChatGPT Work**: persistent cloud browser may navigate supported signed-in sites, fill forms and combine connected apps with file workflows, but runs in its own session, not the user's desktop Chrome cookies. Work also creates or edits artifacts; browser tool access, task approvals and deliverables need distinct tests.
3. **Deep Research**: accepts files, web and connected apps, supports a proposed editable plan and site restrictions, then produces a sourced report that may be downloaded.
4. **Library / connected sources**: saved and generated documents, images, folders and notes; filters, reuse, download, deletion and connected Drive/Box/Dropbox/SharePoint depend on account/provider permission.
5. **Plugins and Sites**: plugin skills, remote or local MCP apps, app templates, Sites-hosted MCP and site-linked scheduled updates are distinct components. A plugin installation is not necessarily a connected account or an event-triggered task.
6. **Study mode**: learning/quiz capability accessible via `@study`; requires separate testing from ordinary reasoning selection.
7. **Team tasks**: scheduled or event-driven work can have shared responsibility in eligible workspaces. Team-task access control, ownership and approval are not equivalent to a personal one-time reminder.
8. **Model/reasoning control drift**: current ordinary Chat, Work and Codex have distinct model pickers and effort settings. The stored `model`/`thinking_effort` evidence remains valid for its captured build, but not as a permanent menu mapping.

There is **no verified separate Goals/Plans manager** in this capture. Product goals and plans may instead be Work planning steps, project instructions, or scheduled tasks; do not invent a dedicated route.

## Acceptance still required before claiming comprehensive coverage

| Priority | Scenario | Missing proof / blocker |
| --- | --- | --- |
| P0 | Library → Chat existing file | **Pro acceptance passed** with a healthy Space upload: source file reached Python. Preserve separate Free quota/missing-file failure for follow-up only if Free-specific behavior matters. |
| P0 | File upload by format | Run disposable TXT/Markdown, PDF, XLSX and image; cover drag-drop and multi-file path, failures, preview and downloadable output, without modifying user files. |
| P0 | Python and code-backed analysis | **Pro code trace passed** on 2026-10-07. Remaining: graphical data analysis, multi-file and error/retry variants, not this already-proven CSV/Python path. |
| P0 | Download variants | Validate generated Markdown, PDF/Word, XLSX, image and external-link/download controls; the current live proof covers Markdown Library download and generated CSV download only. |
| P0 | Scheduled task matrix | In native `/scheduled` capture run-now/Pause/Resume/Delete with exact transport and postconditions, notification settings, event triggers, task sharing and approval dependency. Do **not** create tasks through the assistant's current chat merely to test the external browser. |
| P1 | Work/Cloud Browser and model selection | Native Work browser actions, files in/out, approvals, handoff/resume, current model/effort selector; separately re-capture the paid ordinary Chat selector on the current release. |
| P1 | MCP variants | No auth, hybrid OAuth, Tunnel, multiple links/unlink and explicit tool invocation/approval outcomes on disposable apps. Do not mutate the production Koba MCP Bridge. |
| P1 | Deep Research / Search | Source selection, proposed plan review, interaction, citations and report export. |
| P1 | Event-triggered and team tasks | Native trigger setup, supported events, sharing, shared owner controls and approval/pause outcomes in an eligible workspace. |
| P1 | Project file flows | Source upload/replace/download/removal and memory-setting availability; current official help and one previously observed native UI disagree about whether memory can later be switched. Record as version/account-dependent until retested. |
| P2 | Study / audio / images / Library notes / Sites | Sites first-entry legal terms were observed in Pro; activation and further actions require explicit acceptance. Other listed areas are not yet tested. |
| P2 | Exact retry / true branch transport | Capture two missing request payloads without redoing already verified version/branch presentation. |

A storage-full Free account is not a sufficient test environment to close cross-format/Library requirements. The user later authorized clearing the old Free Library, but **no Free-library deletion was performed** in this pass because research was switched to the external Pro Chrome profile. Do not touch Pro library content beyond clearly disposable fixtures.

## Current official product sources (external, not live-browser acceptance)

- [Uploading files and audio](https://help.openai.com/en/articles/8555545-uploading-files-and-audio-to-chatgpt)
- [Library file management](https://help.openai.com/en/articles/20001052-file-storage-and-library-in-chatgpt)
- [Data analysis with Python](https://help.openai.com/en/articles/8437071-data-analysis-with-chatgpt)
- [Scheduled tasks, event triggers and approvals](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt)
- [ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex)
- [Cloud Browser in Work](https://help.openai.com/en/articles/20001280-using-cloud-browser-in-chatgpt)
- [Work document/spreadsheet/presentation creation](https://help.openai.com/en/articles/20001278-creating-and-editing-documents-spreadsheets-and-presentations-with-chatgpt-work)
- [Deep Research](https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt)
- [Study](https://help.openai.com/en/articles/11780217-using-study-mode-in-chatgpt)
- [Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)
- [Plugins](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt)
- [Sites MCP hosting](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)
- [Sites automations](https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites)
- [Model and reasoning controls in ChatGPT](https://help.openai.com/en/articles/20001354-gpt-56-in-chatgpt)
- [Work/Codex model and reasoning controls](https://help.openai.com/en/articles/20001516-managing-usage-with-gpt-6-astra-in-work-and-codex)
- [Team tasks](https://help.openai.com/en/articles/20001540-creating-and-managing-team-tasks-in-chatgpt)

Links describe supported product behavior at the time of review; they do not supersede contradictory live evidence in a specific browser build.
