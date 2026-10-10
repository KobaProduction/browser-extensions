# GitHub issue routing and ownership

Every new Issue must use a repository Issue Form with **Target extension**
required. Blank issues are disabled in the repository picker. The selected
target is the *primary change owner* and an `issues` workflow synchronizes one
`target:*` label from the structured Issue Form field. GitHub's raw API and
third-party integrations can bypass the form; imported/API-created tickets
must include the same exact `### Target extension` heading and valid value,
and agents must reject or correct unlabeled/misrouted work before implementing.

| Target extension | Label | Code ownership | Notes |
| --- | --- | --- | --- |
| ChatGPT Booster | `target:chatgpt-booster` | `modules/chatgpt-booster/` | ChatGPT native/archive semantics |
| VK Booster | `target:vk-booster` | `modules/vk-booster/` | VK v2 storage/export semantics |
| All-in-one | `target:all-in-one` | `apps/` | Bundle/integration-specific defects, not every upstream module bug |
| Shared platform / multiple extensions | `target:shared-platform` | `packages/` | List all affected consumer modules in the issue |
| Proxy Switcher (planned) | `target:proxy-switcher` | `modules/proxy-switcher/` | Future capability, not yet shipped |
| Build / release infrastructure | `target:build-release` | `scripts/`, `.github/workflows/` | Specify impacted independent release products |

Use **exactly one primary target**. An issue that spans multiple products
must list every affected consumer and the all-in-one impact. Do not file a
provider bug as Shared solely because the app reuses a widget. A shared
package change can affect independent module versions and the aggregator;
follow `docs/INDEPENDENT_RELEASES.md`, not blanket version bumps.

The issue body must preserve the problem, evidence, acceptance and unresolved
gates. A Pull Request must state target, affected products and source issues.
A task's target can change, but update the issue-form heading so its target
label is synchronized. Avoid duplicate active issues for one scope.

## Legacy ChatGPT Booster tracking

The former standalone repository `KobaProduction/chatgpt-booster` is
**historical evidence, not a source or release authority**. The authoritative
module is `modules/chatgpt-booster/`. All four open standalone issues have
a corresponding active monorepo ticket:

| Standalone | Current issue | Scope |
| --- | --- | --- |
| [#54](https://github.com/KobaProduction/chatgpt-booster/issues/54) | [#11](https://github.com/KobaProduction/browser-extensions/issues/11) | Canonical archive, v3/v4, owner verification and export |
| [#53](https://github.com/KobaProduction/chatgpt-booster/issues/53) | [#12](https://github.com/KobaProduction/browser-extensions/issues/12) | Deferred message/conversation branch graphs |
| [#31](https://github.com/KobaProduction/chatgpt-booster/issues/31) | [#13](https://github.com/KobaProduction/browser-extensions/issues/13) | User Stop suppresses completion sound |
| [#32](https://github.com/KobaProduction/chatgpt-booster/issues/32) | [#14](https://github.com/KobaProduction/browser-extensions/issues/14) | Verified conversation exhaustion critical alarm |

The four still-open standalone PRs are **not merge targets** for this
monorepo. [#66](https://github.com/KobaProduction/chatgpt-booster/pull/66)
is the canonical archive draft; its requirements and acceptance belong to
monorepo #11. Old floating-workspace and selective-capture drafts
[#26](https://github.com/KobaProduction/chatgpt-booster/pull/26),
[#27](https://github.com/KobaProduction/chatgpt-booster/pull/27) and
[#28](https://github.com/KobaProduction/chatgpt-booster/pull/28)
must be checked for live-feature parity in monorepo
[#16](https://github.com/KobaProduction/browser-extensions/issues/16)
before closing old PRs. The 233-item original checklist is already in
`modules/chatgpt-booster/docs/tasks/EXTENSION_2_CHECKLIST.md`. Existing
`ArchiveWorkspace.vue`, `CaptureSettingsSurface.vue`, exporter, Reader
and independent build code in the monorepo are evidence of source presence,
**not** proof of installed-product parity.

Historical titles, issue bodies, PR descriptions and source refs for **all 28
issues and 38 PRs** are preserved in
[`docs/legacy/chatgpt-booster-github-tracker.json`](legacy/chatgpt-booster-github-tracker.json).
A companion [legacy discussion snapshot](legacy/chatgpt-booster-discussions.json)
preserves 52 issue discussion comments, two inline PR code-review comments,
and 43 PR review decisions/comments across all 38 former PRs. These JSON
records do **not** archive old Git commit objects, PR patches, full review
thread state or release artifacts. Keep the old GitHub repository available
until unmerged source parity and any needed Git/release provenance are resolved.
Do not mistake a closed historical tracker for verified product acceptance.
