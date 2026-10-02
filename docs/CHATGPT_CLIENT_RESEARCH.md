# ChatGPT client research

This document separates observations from hypotheses.

## Confirmed in this project

- ChatGPT Booster executes only on https://chatgpt.com/*.
- The first Tool Inspector implementation reads ordinary rendered DOM only.
- It does not intercept fetch, WebSocket/SSE traffic, React internals, or private ChatGPT endpoints.
- Tool/MCP detection is heuristic and isolated in the @chatgpt-booster/chatgpt package.
- The UI reports only data actually visible to the browser DOM adapter.

## Current environment limitation

The automated Koba Chromium environment receives a Cloudflare HTTP 403 when opening chatgpt.com, so the current authenticated desktop DOM cannot be inspected remotely from this workspace.

This means current selector heuristics are intentionally broad and must be runtime-validated in a real logged-in ChatGPT desktop session before being treated as stable.

## What remains unknown

We have not yet established with evidence:

- whether tool arguments/results exist in hidden desktop DOM;
- whether those details are present only in client-side network payloads/state;
- which client store/cache owns current conversation data;
- whether the full server-side model context is ever materialized in the browser.

The last item must not be assumed: rendered conversation state and actual model context are different concepts.

## Next evidence path

1. Run the extension/userscript in an authenticated desktop ChatGPT session.
2. Use Tool Inspector diagnostics to capture surrounding DOM attributes/text for real MCP/tool blocks.
3. If the payload is absent from DOM, separately instrument browser-side network/state observation behind a documented opt-in diagnostic module.
4. Record stable evidence before adding any private endpoint or MAIN-world dependency.
