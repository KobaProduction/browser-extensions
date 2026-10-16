# Documentation map

This directory owns durable contracts, documentation navigation, and accepted
architecture decisions. Source code owns actual implementation. GitHub Issues
own only actionable current work, defects, remaining acceptance and closure
evidence; they must reference these contracts instead of duplicating them.

## Products

| Product | Entry point | Purpose |
| --- | --- | --- |
| VK Booster | [vk-booster/README.md](vk-booster/README.md) | Archive, VK API boundary, media, export, offline lab and tests |
| ChatGPT Booster | [chatgpt-booster/README.md](chatgpt-booster/README.md) | Fixed canonical schema 1, passive provider observation and UI; historical v3/v4 data remains protected |
| All-in-one | [all-in-one/README.md](all-in-one/README.md) | Composition without cross-channel storage collisions |
| Shared infrastructure | [shared/README.md](shared/README.md) | Environment, storage, backup, telemetry and engineering rules |

Local visual UI acceptance environment: [UI Acceptance Lab](../apps/ui-lab/README.md);
its shared [browser acceptance contract](shared/UI_ACCEPTANCE.md) defines the matrix and validation levels.

## Architecture and operations

- [TARGET_ARCHITECTURE.md](TARGET_ARCHITECTURE.md) — accepted DDD + FSD + Ports &
  Adapters target, **not automatically an implemented feature**.
- [ARCHITECTURE.md](ARCHITECTURE.md) — currently implemented/transitional
  architecture (source remains the implementation authority).
- [REFACTOR_PROGRESS.md](REFACTOR_PROGRESS.md) — current owner scope, source evidence and outstanding gates.
- [Shared rules](shared/PROJECT_RULES.md) — project-wide normative decisions.
- [Saved conversation export](shared/CONVERSATION_EXPORT.md) — ranges, source
  evidence, reusable formats and memory bounds, separate from application backup.
- [Automation and WebSocket remote sessions](shared/AUTOMATION_AND_REMOTE.md) —
  shared triggers, source delivery, scoped commands and pending acceptance.
- [DEV/PROD release implementation](DEV_PROD_CHANNELS.md),
  [independent versions](INDEPENDENT_RELEASES.md),
  [release operations](RELEASES.md).
- [Integration](INTEGRATION.md) and
  [reconciliation](INTEGRATION_RECONCILIATION.md).
- [Issue routing](ISSUE_ROUTING.md) — issue target labels and work tracking.
- [Historical ChatGPT issue/PR snapshots](legacy/) — evidence, **not active rules**.

New product-specific documentation belongs below `docs/<product>/`. A
cross-product requirement must have **one** owner below `docs/shared/`;
product READMEs link to it and do not maintain competing copies.
