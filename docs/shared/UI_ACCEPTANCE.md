# Browser UI acceptance contract

**Owner: shared Shell and UI.** Applies to ChatGPT Booster, VK Booster, and the all-in-one hosts. This is the source-level/browser-visual acceptance layer before a reviewed UI PR is merged. Real installed-product, authenticated archive, DEV/PROD isolation and production promotion remain separate gates.

## Acceptance environment

The executable local harness is [UI Acceptance Lab](../../apps/ui-lab/README.md) (`bun run ui:lab`). It mounts the **real** Shell, ChatGPT and VK Vue components with deterministic synthetic ports. No user accounts, tokens, real IndexedDB, media or external telemetry endpoints are accessed. Live data assertions are forbidden in this layer.

The browser test matrix crosses these dimensions:

| Dimension | Values |
|---|---|
| Product/host | ChatGPT standalone, VK standalone, all-in-one ChatGPT host, all-in-one VK host |
| Data/source state | saved, empty, loading, error, long text, disabled installation |
| Surface | full settings, quick menu, archive, collapsed launcher |
| Delivery identity | Tampermonkey, Chromium MV3 |
| Launcher edge | left, right |
| Iframe viewport | 1365×780, 768×790, 390×780 |

The **full Cartesian matrix contains 1152 configurations**. For fast PR checks an **extended 288-case matrix** covers every product × state × surface × viewport with delivery method and side rotated evenly. A 96-case smoke profile covers each product × state × surface with representative viewports, methods and sides. All three are available from the lab toolbar and browser CLI. Partial/unexecuted cases must never be reported as PASS.

## Required browser assertions

- Shared Shell mounts exactly once; the launcher docks at either edge. An opened provider workspace floats over the host page (not a forced centered modal), starts at the launcher edge, supports dragging, keyboard movement, resizing, minimizing/restoring, and preserves its scoped geometry without viewport overflow. Quick menu remains compact.
- Quick menu shows product, version, delivery method, state, available actions and provider-specific counters without unwanted scrolling at standard heights.
- Full settings preserve provider-owned navigation, not the shared Shell's duplicate sidebar. ChatGPT nested settings remain a bounded two-column grid on supported desktop widths; narrow viewports must have no horizontal overflow.
- Clicking the launcher opens the quick menu and Escape closes it. Provider-defined actions open their intended surface; disabled installations cannot execute capture and may be re-enabled.
- Synthetic collection start/stop, archive access, empty/error/loading states and long labels remain visible and usable; test failures preserve fixture data.
- Browser uncaught errors or unhandled promise rejections are failures, not silent diagnostics success.

PR browser acceptance uses `apps/ui-lab/scripts/browser-matrix.mjs` on Ubuntu-hosted Chromium/Chrome, with generated JSON and screenshots saved only as CI artifacts (`apps/ui-lab/.local/`, ignored by Git). The default PR job runs extended 288. A manually dispatched full matrix runs all 1152. Do not claim the full 1152 were run when only the 288-case PR profile passed.

## Limitations and review decisions

Unit/type/build gates, screenshot comparison, browser layout tests, installed-extension runtime and real-data acceptance are separate. A failure to launch the browser infrastructure is an explicit **BLOCKED** result, never a PASS. Changing CSS, Shell geometry, modal/navigation ownership or provider view composition requires re-running this acceptance suite before independent review. Publishing a DEV build is not evidence of visual acceptance.
