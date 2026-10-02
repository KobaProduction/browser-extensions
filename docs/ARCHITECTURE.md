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

## Settings surface

The Control Center is a single Vue component with multiple delivery entry points:

- Tampermonkey menu command opens the in-page surface;
- Chromium action popup mounts the same Control Center component;
- a movable in-page launcher opens the same surface and persists its clamped viewport position.

Entry points must not fork settings behavior or create separate settings components.


## Feature model

Features register as small modules with explicit start/stop lifecycle. A feature should own only its injected DOM and subscriptions. Failure of one feature must not prevent unrelated features from starting.

## ChatGPT integration

The current foundation only depends on the page host and normal DOM capabilities. Future DOM selectors must live behind a ChatGPT adapter instead of being scattered across feature code.

## Security and privacy

- host scope is limited to `https://chatgpt.com/*`;
- no remote code execution;
- no chat content telemetry;
- no private ChatGPT API interception in the foundation;
- extension permissions stay minimal and are added only for concrete features.

## Validation levels

- source/type/lint checks;
- build output validation;
- browser runtime smoke test;
- feature acceptance in current ChatGPT UI.

CI currently covers the first two. Runtime acceptance remains a separate gate.
