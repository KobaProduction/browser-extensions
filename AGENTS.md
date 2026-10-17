# Browser Extensions — agent entry map

This file is a **router**, not the application's rulebook. Durable project
rules reside in `docs/shared/`, product contracts under `docs/<product>/`;
GitHub Issues track only current tasks/evidence, never the sole rule authority.

## Required navigation

1. Read the short [system catalog](README.md) and
   [documentation index](docs/README.md).
2. Read the [project rules](docs/shared/PROJECT_RULES.md) relevant to the
   current decision. **Environment isolation** and **backup ownership** are
   binding for all product/channel storage work.
3. For substantive architecture, implementation, target, permission, UI or
   release changes, read [accepted target architecture](docs/TARGET_ARCHITECTURE.md)
   completely and compare with [current architecture](docs/ARCHITECTURE.md).
   A target is not proof of a working implementation.
4. Load the relevant global AI workflow skill/role for the task; do not read
   unrelated skills or account prompt templates.
5. Select the product-specific README or shared contract below. Inspect
   current Git/ref and source before technical decisions.

## Ownership routes

| Task | Mandatory local authority | Source |
| --- | --- | --- |
| VK conversations/archive/export | [VK Booster](docs/vk-booster/README.md), [archive contract](docs/vk-booster/ARCHIVE.md) | `modules/vk-booster/` |
| ChatGPT archive, account/owner and migration | [ChatGPT Booster](docs/chatgpt-booster/README.md) | `modules/chatgpt-booster/` |
| All-in-one/provider connection | [All-in-one](docs/all-in-one/README.md), [integration](docs/shared/INTEGRATION_CONTRACT.md) | `apps/` |
| Storage/Pinia/Dexie/identity/session | [Environment and storage](docs/shared/ENVIRONMENTS_AND_STORAGE.md) | `packages/storage/`, `packages/adapters/` |
| Backup/import/restore | [Backup contract](docs/shared/BACKUP_AND_RESTORE.md) | Provider repository + shared ports |
| Telemetry/metrics | [Telemetry contract](docs/shared/TELEMETRY.md) | `packages/core/` and provider adapter |
| UI, responsive layouts and local acceptance | [UI acceptance](docs/shared/UI_ACCEPTANCE.md), [UI Lab](apps/ui-lab/README.md) | `packages/shell/`, provider UI, `apps/ui-lab/` |
| Build, versions, release | [Project rules](docs/shared/PROJECT_RULES.md), [release channels](docs/DEV_PROD_CHANNELS.md) | `scripts/`, `.github/workflows/` |
| Issue/PR creation | [Issue routing](docs/ISSUE_ROUTING.md) | Required `Target extension` |

## Non-negotiable immediate gates

- DEV and PROD **never** share writable data, settings, IndexedDB or events.
  The aggregate may request access only to same-channel services, through
  an explicit capability, valid owner identity and user consent.
- VK Booster now targets the first **1.0.0** source base and fixed Dexie Archive
  **schema 1**, frozen until separately approved first PROD. DEV build IDs
  may advance. Historic schema-2 and state/pages archives are not migrated,
  overwritten or deleted; release-update downgrade requires validation.
- Protect ChatGPT v3/v4 existing PROD archives and existing VK v2 folders.
- Never store credentials or personal conversations in Git, telemetry,
  synthetic fixtures or CI logs.
- Direct push to `main` is allowed when it is not protected. Verify current
  GitHub branch protection and applicable rulesets before pushing; never bypass
  protection. Run strict typecheck, Biome, tests and relevant output/build gates.
  Protected branches retain their review/merge requirements. Distinguish
  source/build from browser/data/prod acceptance.
- Any new Issue names exactly one `Target extension` and contains **current
  implementation scope and acceptance**, with links to documentation rules.
  Do not paste persistent rules into Issues.

Changes to these decisions belong in the owning documentation contract; link
to that contract rather than adding more copies to this router.

For UI work, apply the existing AI Agent Workflow
[UI/layout skill](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/frontend-engineering/ui-layout.md)
and [interface review skill](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/interface-design-review.md).
Use the project's existing components and semantic theme tokens; the local
UI acceptance contract owns this project's responsive and testing decisions.
Start interface implementation/debugging in the local **Laboratory UI**
(`bun run ui:lab`), open its localhost page in a real browser, and exercise
the relevant fixtures and interactions. Inspect the actual rendering there
directly or through authorized CDP/Playwright browser access. Follow the
[Lab-first workflow](docs/shared/UI_ACCEPTANCE.md#lab-first-interface-workflow);
authenticated installed-product checks remain a separate gate.
The owner's latest directive requires real **shadcn-vue registry primitives only**
for interactive UI, exported from the shared UI package. Do not create native
or handwritten lookalikes, duplicate provider registries or competing sidebars.
Read the relevant [owner UI decisions](docs/shared/UI_DECISIONS.md) before
changing an interaction contract. Record the correction and why the prior
behavior was wrong; generalize reusable lessons in the owning workflow skill.
The owner's latest direction authorizes local synthetic tests, isolated browser
validation and a loopback WebSocket fixture. This supersedes the earlier
build/test deferral. Review, installed-browser and release gates remain separate.
