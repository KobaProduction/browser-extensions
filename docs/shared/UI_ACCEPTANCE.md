# Browser UI acceptance contract

**Owner: shared Shell and UI.** Applies to ChatGPT Booster, VK Booster, and the all-in-one hosts. This is the source-level/browser-visual acceptance layer before a reviewed UI PR is merged. Real installed-product, authenticated archive, DEV/PROD isolation and production promotion remain separate gates.

## Latest owner correction: shadcn-only controls (2026-10-14)

Use real shadcn-vue registry components through the shared UI public API for
interactive controls. Handwritten lookalikes and native control replacements
are not an accepted baseline. Text and semantic layout may use ordinary HTML;
Switch, Checkbox, Input, Select, Tabs, Collapsible, Dialog, ScrollArea and Button
must keep their intended semantics and accessible state. No provider duplicates
the component registry or base palette. Shadow-root portals must retain the same
theme, styles, focus scope and layering as their source surface.
Portal wrappers explicitly forward style, ARIA and DOM attributes to the actual
surface. Teleport has no DOM element to receive the floating rectangle.

Settings navigation follows a hierarchy: provider capabilities/application group, category,
optional subcategory, then its parameters. Only the selected branch is expanded;
adding more providers or settings must not create one long flat selector.
Mobile settings have an explicit button to expand/collapse this section catalog.
Desktop exposes group navigation above content without a competing nested sidebar. The floating
window's chrome and content form one continuous surface, with no rounded seam or
gap separating them. The owner reported regressions in the previous local source;
those iterations must not be described as visually accepted.

Provider capabilities precede General. Safe provider workflow screens may be
declared catalog leaves: VK exposes Capture, Archive and Parameters directly.
The active group follows the displayed workspace even when that workspace has
no selected settings leaf. This must never invent a selected General category
or replay collection/export actions while restoring navigation.

## Compact archive navigation (owner correction 2026-10-14)

VK and ChatGPT use the same provider-neutral side rail beside the transcript.
It displays compact relationship markers and one registry Slider, not a second
text-message list. Hover, keyboard focus and slider movement reveal the nearest
saved message in an accessible preview; touch/drag also works without hover.
Scrubbing moves the bounded transcript window, while repeated events are
coalesced and final selection is retained. Source IDs, uncertain links, forks,
range markers and keyboard first/middle/last navigation remain available.

Both products have an explicit hide/show action. An empty message timeline is
omitted; pending metadata is loading rather than a fabricated empty history.
The rail, preview and transcript fit phone/tablet/desktop bounds; previews stay
within their portal viewport. Opening history does not fetch attachment bytes.
VK ordinary export exposes JSON/Markdown/TXT and file/ZIP packaging with clear
scope and attachment-reference/media distinctions. Technical Reader refresh
and a redundant conversation-saving category are absent from ordinary flows.

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

The **full Cartesian matrix contains 1152 configurations**. For fast PR checks an **extended 288-case matrix** covers every product × state × surface × viewport with delivery method and side rotated evenly. A 96-case smoke profile covers each product × state × surface with representative viewports, methods and sides. All three are available from the automated-checks direction and browser CLI. Partial/unexecuted cases must never be reported as PASS.

## Required browser assertions

- Shared Shell mounts exactly once; the launcher docks at either edge. At widths above 620px an opened provider workspace floats over the host page, starts at the launcher edge, supports dragging, keyboard movement, resizing, minimizing/restoring, and preserves its scoped geometry without viewport overflow. At 620px and below, the panel fills the entire viewport with no window frame, drag chrome, resize handle or minimize control; the normal close action and keyboard focus remain available. Quick menu remains compact.
- The compact toolkit expands from its own side-docked button as one connected surface, growing up/down from the anchor with no detached popup or gap. Its header contains the application name, version and feature power switch. All-in-one shows its own application version, independently of the current host's provider version. Only an application with multiple component versions has a composition section; it lists component versions and states the installation method once for the whole app. Standalone products have no duplicate installation card. Provider counters and conversation actions appear only in a valid conversation context.
- Full settings expose one shared hierarchical catalog for interface, optional menu/metrics, module lifecycle, telemetry, backup and contributed product categories. Providers contribute recursive category metadata and navigation callbacks instead of the Shell importing provider internals. Grouping nodes navigate to their children; only declared leaf IDs open parameters or enter saved presentation. IDs are unique within a provider and scoped by the provider in the shared catalog. The Shell retains this catalog while replacing the single content column; hosted provider settings hide their own catalog. Desktop group navigation sits above content and shows only the chosen category branch, with no nested application/sidebar. On phones a clearly named shadcn Collapsible trigger expands/collapses all sections and settings. Narrow viewports have no horizontal overflow.
- Interactive controls use the actual shared shadcn-vue registry components according to their purpose: Switch for module/power preferences, Checkbox for selections, RadioGroup for mutually exclusive export scope, Input/Slider/Select for form values, Tabs for provider workflow panels and Collapsible for optional sections. Native/custom lookalike controls must not replace the registry baseline. Dialog/Card own surfaces; shared theme tokens come from the registry baseline, including inside Shadow DOM/portals.
- Workspace chrome and content form one continuous Dialog surface. The shared content uses zero outer padding/gap between chrome and body and removes duplicate nested borders, radii and shadows. The floating drag/resize and mobile fullscreen contracts remain in effect.
- Clicking the launcher opens the quick menu when that preference is enabled; otherwise it opens settings. The drop, quick menu, metrics and native-site entry are independent preferences, shared by every product. Browser Tools always retains explicit settings and menu entry points. Escape closes an open menu. Provider-defined actions open their intended surface; disabled installations cannot execute capture and may be re-enabled.
- Dragging the expanded toolkit away from an edge collapses it to a free drop at the pointer. It only reattaches inside the edge threshold. The free expanded surface rounds every outside corner; a docked surface squares only its screen-facing side. Geometry and safe presentation (surface, section and shared category) are separately scoped; restoring presentation never replays provider actions.
- Providers may register independently enabled capability modules with required platform capabilities, start/stop cleanup and a settings category. Toggling a capability must not restart unrelated modules or the entire product. A preference change from another tab reconciles only the affected lifecycle. Site injection uses the common schema-driven mount/cleanup adapter; DOM observation may locate native mounting points, but cannot infer request, response or conversation lifecycle.
- Synthetic collection start/stop, archive access, empty/error/loading states and long labels remain visible and usable; test failures preserve fixture data.
- Browser uncaught errors or unhandled promise rejections are failures, not silent diagnostics success.

## Task-oriented lab and responsive density

The lab starts with a map of directions, without a mounted product preview.
Interface behavior, archive fixtures, module/settings sections and automated
checks are separate tasks. Product and site are separate choices: All-in-one
selects a host inside its own context, rather than multiplying product options.
Only archive tasks expose archive data fixtures. Installation method and
launcher edge are secondary, explained controls. Navigation back to the map
unmounts the preview; browser Back/Forward restores the direction.

The preview fits its available width without horizontal page scrolling and
retains its canonical internal viewport; its display scale is explicit and an
unscaled separate view is available. The lab itself must also fit phone widths.
Desktop module settings use a two-column card layout from 1024px; tablet widths
use compact single-column rows. Phone settings use top navigation and a single
content column. Scrollbars belong to the owning scroll area and follow the
shared theme. These are source/browser requirements, not installed acceptance.

A provider may mark its bounded reading content with `data-panel-content-focus`.
On every viewport the shared Shell then assigns its available content height to that
pane. On phones the value `true` additionally hides the shared catalog while a selected
document is being read; the provider retains an accessible Back action that
sets the value to `false` and restores the catalog/list. This is presentation
only, never a command or persisted data state. Providers own their internal
flex/scroll layout and omit redundant upstream summaries during reading; they
do not select or restyle Shell internals. The outer pane has no horizontal
overflow. Long code/table content may scroll within its own themed area.
Reader acceptance measures the remaining content area after chrome/navigation:
the archive fills that area, its toolbar does not obscure records, and resizing
reflows the transcript. Presence-only checks do not establish this behavior.
Opening details pins the explicitly selected record. Scrolling the transcript
to reveal those details must not retarget an inspector to another message.
Branch acceptance waits for completed path loading and checks the full selected
path; a virtualized visible subset is not evidence of correct branch filtering.

Application language belongs to the installation's shared settings, not a
provider category. One scoped preference is injected into provider surfaces;
it never reads a sibling product/channel preference. A prior explicit provider
preference may seed the application once if the shared value is absent.
Standalone catalogs omit aggregate product management. Two directly useful
automation sections do not require an otherwise empty grouping page. Catalog
selection and rendered content must follow the same validated route.

Changing a lab product, aggregate host or page context preserves the current
open/closed presentation and corresponding settings/archive view. A deliberate
surface/section selection or reset may start that requested view. Only validated
presentation is restored: no previous account, fixture records, export targets
or in-flight capture/export action crosses the context boundary. Stale messages
from the previous iframe cannot override the new preview. VK has distinct
conversation and non-conversation fixtures; outside a conversation, the general
product/settings surface cannot expose the current-chat archive module.

Owner feedback and the reasons for these decisions live in
[the UI decision journal](UI_DECISIONS.md). During the current iterative phase,
the owner initially deferred builds and tests. The latest direction explicitly
authorizes local synthetic checks, isolated browser validation and a loopback
WebSocket fixture. That earlier deferral is superseded; installed-product and
review/release acceptance remain distinct.

The 2026-10-15 owner correction prohibits ChatGPT DOM-derived facts, request
timing, native-command clicks and trigger execution. Only observed network
evidence or explicitly decorated native application methods drive business
reactions; DOM changes only locate and refresh presentation. The trigger and WebSocket settings are
separate leaf sections. Lab edits only synthetic preferences: it must never
instantiate the real remote client, open its persistent outbox or execute native
chat commands.

Run `node apps/ui-lab/scripts/browser-matrix.mjs --explorer` for the lab's own
map, contextual selectors, route transitions, fitting and responsive-density
checks. This supplements the provider matrix; it does not replace it.

`--accessibility-ui` separately verifies the Chromium accessibility tree, named
module controls and trusted keyboard/pointer menu interaction, including focus
return and English captions. Screenshot replay waits for a fully painted,
stable surface without geometry warnings; a mounted node alone is insufficient.

PR browser acceptance uses `apps/ui-lab/scripts/browser-matrix.mjs` on Ubuntu-hosted Chromium/Chrome, with generated JSON and screenshots saved only as CI artifacts (`apps/ui-lab/.local/`, ignored by Git). The default PR job runs extended 288. A manually dispatched full matrix runs all 1152. Do not claim the full 1152 were run when only the 288-case PR profile passed.

## Limitations and review decisions

Unit/type/build gates, screenshot comparison, browser layout tests, installed-extension runtime and real-data acceptance are separate. A failure to launch the browser infrastructure is an explicit **BLOCKED** result, never a PASS. Changing CSS, Shell geometry, modal/navigation ownership or provider view composition requires re-running this acceptance suite before independent review. Publishing a DEV build is not evidence of visual acceptance.
