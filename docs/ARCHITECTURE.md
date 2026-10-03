# Architecture

ChatGPT Booster is one codebase with two browser delivery targets.

```text
                 packages/ui
                     |
                     v
extension ------> packages/core <------ userscript
    |                                   |
    +------------ chatgpt.com ----------+
```

## Packages

### core

Environment-neutral contracts:

- runtime/module lifecycle;
- settings model;
- ChatGPT host detection.

It must not depend on Chrome APIs or Tampermonkey APIs.

### chatgpt

DOM-facing adapters. This package is the only place where ChatGPT-specific selectors and extraction heuristics should live.

### features

Reusable feature modules shared by extension and userscript targets. Features depend on explicit adapters and UI mounts rather than querying ChatGPT DOM directly.

### ui

Vue 3 UI used by the browser targets. It also has a standalone Vite dev page for UI work without loading the extension. Injected page UI is mounted into a Shadow DOM root so ChatGPT styles do not leak into Booster and Booster styles do not leak into ChatGPT.

### extension

Chromium Manifest V3 target.

Responsibilities:

- content-script bootstrap on ChatGPT;
- Chrome storage adapter;
- extension popup/settings surface.

It uses an isolated-world content script. MAIN-world injection is not used unless a future feature has a documented need for page-JavaScript access.

### userscript

Tampermonkey-compatible target.

Responsibilities:

- userscript metadata;
- page bootstrap;
- localStorage settings adapter.

The userscript and extension use the same core/UI feature implementation.

## Settings and in-page surfaces

The Control Center remains one Vue component with two direct settings entry points:

- Tampermonkey menu command opens the in-page settings surface;
- Chromium action popup mounts the same Control Center component.

The movable in-page launcher is intentionally one level shallower. Clicking it opens a compact current-chat quick panel with archive coverage, History Loader controls, an Archive Browser entry point and a settings gear. The launcher position remains persisted and viewport-clamped.

The Archive Browser is a separate read-only surface backed only by the local Conversation Archive IndexedDB. It can list persisted projects/conversations and render archived message records, including tool/reasoning/system records and expandable raw metadata. It must not expose composer, edit, delete or private-API mutation actions.

Settings entry points must not fork Control Center behavior. Archive/quick surfaces may consume settings and archive adapters, but must not duplicate target-specific persistence logic.


## Feature model

Features register as small modules with explicit start/stop lifecycle. A feature should own only its injected DOM and subscriptions. Failure of one feature must not prevent unrelated features from starting.

## ChatGPT integration

The current foundation only depends on the page host and normal DOM capabilities. Future DOM selectors must live behind a ChatGPT adapter instead of being scattered across feature code.

## Security and privacy

- host scope is limited to `https://chatgpt.com/*`;
- no remote code execution;
- no chat content telemetry;
- private ChatGPT traffic may be observed only for explicitly documented read-only features; Booster must not synthesize private history requests for the Conversation Archive;
- archived chat content remains local in IndexedDB unless a future user-controlled export feature explicitly moves it;
- extension permissions stay minimal and are added only for concrete features.

## Validation levels

- source/type/lint checks;
- build output validation;
- browser runtime smoke test;
- feature acceptance in current ChatGPT UI.

CI currently covers the first two. Runtime acceptance remains a separate gate.

## Internationalization

User-facing UI strings use the shared UI i18n layer. English and Russian are mandatory locales. The stored language preference is `auto`, `en`, or `ru`; `auto` resolves from browser language, preferring Russian for `ru*` locales and English otherwise. Feature modules must pass the resolved locale into isolated UI mounts rather than hard-coding copy.

## Transport observation and telemetry

Transport interception runs in the page MAIN world and is isolated in `@chatgpt-booster/observer`. It observes fetch, XHR, WebSocket and EventSource without blocking or replacing application semantics. Cross-world events use `window.postMessage` with a Booster channel marker.

Credentials are never exposed to the page observer. Request headers/cookies are not captured. URL and body previews are redacted before leaving the page world, body capture is disabled by default, and previews are truncated.

Telemetry is exported as OTLP/HTTP JSON through `@chatgpt-booster/telemetry`. Resource identity is `service.name=chatgpt-booster-extension`, `service.namespace=koba`, with instrumentation scopes `chatgpt-booster.runtime` and `chatgpt-booster.transport-observer`. Tampermonkey sends through `GM_xmlhttpRequest`; Chromium sends through the extension background worker. Bearer tokens are stored in target-specific secret storage and are never passed into the MAIN world.

## Settings persistence

Settings changes are applied as atomic nested patches rather than replacing a potentially stale full settings object. Chromium writes are serialized by the background service worker so persistence survives action-popup teardown; storage changes remain the live notification path for page modules. Tampermonkey applies the same patch contract synchronously to local storage and emits the existing settings-change event.

## Development builds

The production userscript is minified. The development userscript is emitted without JavaScript minification and references a separately published sourcemap so Tampermonkey's editor does not need to parse a large inline base64 map. Chromium extension builds keep sourcemaps for runtime debugging.

## Analytics persistence

Transport hooks are installed for the lifetime of the page runtime. The observer enable switch controls whether events are consumed, counted, or exported; disabling it does not remove the underlying fetch/XHR/WebSocket/EventSource wrappers. Current-tab counters remain in memory. All-time counters use a separate persistent diagnostics adapter (`chrome.storage.local` through the Chromium background worker, local storage for the userscript) and are displayed in the Analytics settings section.

The settings UI stores its active section and disclosure state alongside other settings. Telemetry endpoint configuration is user-provided; there is no project-specific default endpoint.
## Conversation Archive

The Conversation Archive is a local IndexedDB subsystem that records conversation/history data already fetched by the normal ChatGPT client. Lossless raw records are stored alongside normalized indexes for messages, turns, branches and coverage. The History Loader may drive normal UI scrolling to cause ChatGPT itself to load older pages, but it must not construct or send private history requests. See `docs/CONVERSATION_ARCHIVE.md` and `docs/CHATGPT_CLIENT_RESEARCH.md`.


## Docked toolkit iteration (working branch)

The launcher uses an edge (`left`/`right`) and a vertical fraction of available height,
not saved screen pixels. Expansion keeps the toggle fixed and grows one integrated
shell toward available space. It does not resize ChatGPT. Modal settings, archive and
export surfaces remain Shadow-DOM isolated.

`core/archive.ts` owns capture/export contracts. `chatgpt/archive-records.ts` derives
visible replies, nested records and exchange grouping without changing raw identity.
`features/archive-coverage.ts` requires a fresh initial read plus linked continuation
cursors; reaching the top or retaining an old complete flag is insufficient.

Automatic archive capture is opt-in by project/chat. A manual ticket temporarily enables
only one current-tab conversation, retaining the user's selected record categories.
Consent is rechecked after asynchronous database reads and before puts. Revoking a rule
does not delete existing data. Project IDs remain relation keys, not display labels.
Settings schema 3 is distinct from the unchanged archive IndexedDB version 2.

JSON/Markdown export is a projection: basic mode must not serialize internal storage
metadata or nested records. Configurable mode includes only selected categories; binary
images/files are off by default. Full binary packaging is unavailable until attachment
resolvers are verified. See the task validation report for remaining live-runtime gates,
including preservation of pending attachments before a collection-triggered reload.
