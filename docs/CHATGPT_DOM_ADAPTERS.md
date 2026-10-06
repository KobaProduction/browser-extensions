# ChatGPT DOM adapters

ChatGPT ships more than one conversation renderer at the same time. Booster must treat
those renderers as host contracts, not as one DOM with an ever-growing list of fallback
selectors.

## Rule

All renderer-specific conversation DOM knowledge belongs in a versioned
`ChatGptDomAdapter` implementation in `packages/chatgpt/src/chatgpt-dom-adapter.ts`.

Shared feature code must consume normalized targets and helpers from the adapter layer.
It must not branch on plan names, account tier, rollout flags, CSS hashes or renderer-
specific selectors.

The adapter is selected by observed DOM capability. A plan name such as Free or Pro is
evidence about where a renderer was observed, not part of the runtime contract.

## Current contracts

### `legacy-turn-v1`

Observed in the legacy/Free renderer on 2026-10-06.

Primary signatures:

- `section[data-testid^="conversation-turn-"]` is the turn root;
- `[data-message-id][data-message-author-role]` identifies visible messages;
- `[data-testid="copy-turn-action-button"]` anchors native action rows;
- `[data-testid="cot-v5-tool-icon-pile"]` identifies legacy COT tool rows;
- `group/scroll-root` and related scroll hints identify the conversation viewport.

### `search-unit-v2`

Observed in the current Pro renderer on 2026-10-06.

Primary signatures:

- `[data-turn-key]` is the logical exchange root;
- `[data-chatgpt-search-unit-key]` identifies user/assistant units;
- `[data-chatgpt-search-message-ids]` carries message identity;
- `[data-user-message-bubble]` identifies the user message body;
- `[data-chatgpt-selection-message-id]` identifies the assistant message body;
- `.turn-action-controls` anchors user/assistant native action rows;
- `group/activity-header` is the agent/reasoning/tool activity surface;
- `.thread-scroll-container` is a preferred conversation viewport hint.

One `search-unit-v2` turn contains both the user and assistant units. Code must therefore
never assume that one turn root maps to one message.

## Adapter responsibilities

A DOM adapter owns the renderer-specific implementation of:

- visible message discovery and stable message identity;
- logical turn discovery and assistant-turn detection;
- native action-row and metadata mount placement;
- live activity status, activity mount and local turn identity;
- conversation anchor and visible message bounds;
- preferred conversation scroll-container hints used only to identify the viewport;
- canonical tool/activity rows;
- mutation attributes that invalidate the discovered targets.

`packages/features` may correlate those normalized targets with archive records, settings
and UI mounts, but it must not know which ChatGPT renderer produced them.

## Adding a new renderer

When ChatGPT rolls out another incompatible DOM:

1. capture live DOM evidence from the affected browser;
2. add a new `ChatGptDomAdapter` implementation with a new contract ID;
3. place it before older contracts in the adapter registry when its signatures are more
   specific;
4. add a browser fixture covering messages, action rows, activity/tool rows and scrolling;
5. keep the older adapters unchanged unless their own observed contract changed;
6. validate both the new renderer and at least one older renderer before publishing.

Do not patch `features`, UI components or target bootstraps with renderer-specific
selectors to make a rollout pass quickly. The fast path is the adapter itself.

## Failure behavior

If no registered adapter matches, DOM-dependent features should degrade to no targets
rather than guessing a renderer. Transport/archive data already observed from the normal
ChatGPT client remains independent of DOM decoration.

A successful build or typecheck does not prove a DOM adapter. Each new/changed adapter
needs live browser acceptance on the renderer it claims to support.

## History scrolling

History Loader must not encode renderer scroll geometry. In particular it must not
assign `scrollTop`, calculate a reverse-scroll minimum, focus ChatGPT controls, or
dispatch fake wheel/keyboard events. Synthetic input events are not trusted browser
input and do not provide a reliable default scrolling action.

To request older history, Booster finds the conversation viewport and issues a small upward
`scrollBy(...)` pulse. The browser owns the actual scroll
direction and layout semantics. Scroll-container hints and element geometry may be read
only to choose the adjacent older turn and to observe progress. Completion is determined
from archive coverage/server pagination evidence, not from a numeric scroll position.

Trusted mouse/keyboard input from external browser/CDP tooling is an acceptance/debug
capability only and must not become a Booster runtime dependency.
