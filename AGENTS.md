# Browser Extensions — agent entry map

Start with [README](README.md) and the [documentation map](docs/README.md).
Load only the relevant system contract and source. Source owns implementation;
compare [target](docs/TARGET_ARCHITECTURE.md) and [current architecture](docs/ARCHITECTURE.md)
when changing system boundaries. Issues own current work and evidence.

## AI Agent Workflow

Use the relevant skill from [AI Agent Workflow](https://github.com/ArthurKoba/ai-agent-workflow).
Do not copy its general process here or preload every skill.

| Task | Workflow authority |
| --- | --- |
| Documentation and context | [Context Engineering](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/context-engineering.md) |
| Git, Issues, commits and PRs | [Git Workflow](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/git-workflow.md) |
| Toolchain, checks, hooks and CI | [Project Bootstrap](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/project-bootstrap.md) |
| Domain/application implementation | [Software Engineering](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/software-engineering/README.md) |
| Vue/TypeScript and frontend | [Frontend Engineering](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/frontend-engineering/README.md) |
| UI layout and acceptance | [UI Layout](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/frontend-engineering/ui-layout.md), [Interface Review](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/interface-design-review.md) |
| Browser, CDP and Playwright | [Remote Browser Session](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/remote-browser-session.md) |
| Independent code review | [Code Review](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/code-review.md) |

## System and source ownership

| Responsibility | Source | System contract |
| --- | --- | --- |
| VK capture, archive, media and export | `modules/vk-booster/` | [VK](docs/vk-booster/README.md), [archive](docs/vk-booster/ARCHIVE.md) |
| ChatGPT source, archive and account identity | `modules/chatgpt-booster/` | [ChatGPT](docs/chatgpt-booster/README.md) |
| Product/delivery composition and permissions | `apps/` | [All-in-one](docs/all-in-one/README.md), [integration](docs/shared/INTEGRATION_CONTRACT.md) |
| Host-neutral lifecycle, ports and telemetry types | `packages/core/` | [Architecture](docs/ARCHITECTURE.md), [telemetry](docs/shared/TELEMETRY.md) |
| Provider-neutral storage and browser adapters | `packages/storage/`, `packages/adapters/` | [Environments and storage](docs/shared/ENVIRONMENTS_AND_STORAGE.md) |
| Source-neutral archive use cases | `packages/archive/` | [Conversation export](docs/shared/CONVERSATION_EXPORT.md) |
| Shared primitives, widgets and Control Center | `packages/ui/`, `packages/widgets/`, `packages/shell/` | [UI acceptance](docs/shared/UI_ACCEPTANCE.md), [UI decisions](docs/shared/UI_DECISIONS.md) |
| Backup/import/restore ports and provider repositories | Shared ports + provider | [Backup and restore](docs/shared/BACKUP_AND_RESTORE.md) |
| Builds, independent versions and channels | `scripts/`, `.github/workflows/` | [Release channels](docs/DEV_PROD_CHANNELS.md), [versions](docs/INDEPENDENT_RELEASES.md) |
| Issue target and consumer scope | Issue Forms | [Issue routing](docs/ISSUE_ROUTING.md) |

For UI work start in [Laboratory UI](apps/ui-lab/README.md), following the
[Lab-first workflow](docs/shared/UI_ACCEPTANCE.md#lab-first-interface-workflow).
The UI contract owns registry primitives, theme and browser acceptance.
Local checks and selective test commands live in [README](README.md#development-and-releases).
Direct push to unprotected `main` is allowed after checking live protection and
rulesets; obey tool permissions and protected-branch requirements.

## CI-owned versions

Never bump product versions manually. Push source changes; CI assigns one
version per affected product and source SHA in Git's `dev:release-versions.json`.
Retries reuse that assignment. Follow the owning
[version contract](docs/INDEPENDENT_RELEASES.md#one-version-step-per-commit).
## Refactoring tools and Serena MCP

Prefer working code-navigation and refactoring tools built into the current
environment, including Codex, when they support the required operation. Check
actual capabilities; do not assume that a text editor or patch tool provides
semantic refactoring. Use Serena MCP only as a fallback when the needed built-in
tools are absent, unavailable or fail to work.

Do not start or initialize Serena while suitable built-in tools are working.
When Serena is no longer needed, close this project's Serena instance and its
owned child language servers. If fallback is necessary, reuse **one instance
for the entire project**, including chats, agents and worktrees, and coordinate
checkout activation between clients. Never launch a replacement merely because
a new chat or agent starts. If a client configuration automatically launches
separate STDIO servers, report that limitation rather than claiming a shared
instance is enforced by this document. Clean up owned resources when fallback
work finishes; never terminate other projects or unrelated processes by name.
