# Browser acceptance fixture

This fixture runs the production Vue components, archive store, capture module and history loader in real Chromium, using synthetic local data. It is not live ChatGPT acceptance. No private history requests are constructed. Its IndexedDB and localStorage live on the fixture origin, separate from chatgpt.com.

Start the fixture from the repository with `bun tests/browser/serve.ts`. Use the exact URL printed by the running job; the port is allocated at runtime. Stop that job after validation. Typecheck the fixture with `bun node_modules/.bin/vue-tsc --noEmit -p tests/browser/tsconfig.json`.

The page exposes `window.extension2Harness` for the authorized browser developer tool:

- `runStorageTests()` exercises IndexedDB idempotency, concurrency, consent revocation, project links/names, export boundaries and selective/manual capture. It creates synthetic records with unique IDs on the fixture origin.
- `runLoaderCancellationTests()` delays store responses and checks that stop/navigation cannot result in stale success.
- `runLoaderScrollTest()` checks that History Loader requests older history through the conversation scroller and reports success only after linked pagination evidence reaches the start. It does not treat scroll position itself as completion evidence.
- `runUiTests()` checks dock geometry, synthetic pointer handlers, project disclosures, bounded exchange rendering and the lack of a composer. Synthetic PointerEvents do not substitute for physical mouse/touch acceptance.
- `runPerformanceTests()` checks structural performance invariants without SPA navigation: concurrent archive thread/coverage reads share one store snapshot, and preload ingest never materializes the whole preload store with `getAll()`. It also returns elapsed timings for diagnostics without enforcing machine-specific timing thresholds.

Run each function separately, await its result and require every returned `pass` to be true. A connector timeout is not a test failure or permission to launch duplicate work: check the stored result or job state first. A combined run can exceed a connector's response deadline.

The seeded current conversation has 55 exchanges: 110 visible replies and 55 nested tool records. JSON/Markdown exports use the real serializer/download function and are also recorded in `extension2Harness.exports` for inspection. Native browser download persistence, live ChatGPT pagination, attachment fetching, and browser-specific userscript installation remain separate tests.

This is a developer-only entry point and is not imported by either shipped browser target.
