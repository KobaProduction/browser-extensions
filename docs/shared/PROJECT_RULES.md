# Project rules: documentation, ownership, release and acceptance

**Normative for every extension and every delivery target.** These decisions
live in versioned repository documentation, never solely in an Issue. An
Issue is the temporary record of what must be implemented/tested.

## Information hierarchy

- Root `README.md`: short system catalog, responsibility, path to each
  product/service README, links to shared authority and build entry points.
  Do not use it as a multi-product implementation or task changelog.
- `docs/README.md`: entire documentation router.
- `docs/<service>/README.md`: product entry, capabilities, local source map,
  operating flow, product-only constraints, subordinate documents and links to
  shared contracts. Product-specific details stay under that service.
- `docs/shared/`: one cross-product authority per durable invariant:
  isolation, persistence, integration, telemetry and recovery. Do not copy
  binding rules into VK/ChatGPT/aggregate READMEs; link to their owners.
- `docs/TARGET_ARCHITECTURE.md` owns the accepted architecture *target*;
  `docs/ARCHITECTURE.md` describes the current/transitional implementation.
  Code remains the authority for actual behavior. Do not imply a planned
  technology (e.g., Dexie, Pinia persistence) has already been installed.
- Changes to durable behavior update their owning document in the same PR.
  Use relative links; validate moved paths and backreferences. One meaning,
  one owner; no competing copies of an acceptance contract.
- GitHub Issue: **target extension, current problem, implementation scope,
  acceptance tests, evidence, blockers and related PR** only. No project
  rulebook, general product architecture or duplicated master specification.
  Do not create parallel Markdown to-do backlogs.
- Existing migration evidence under `docs/legacy/` is history, not current
  application rules.

## Code and package ownership

Follow [the accepted target architecture](../TARGET_ARCHITECTURE.md):
DDD/Clean Architecture defines source-neutral domain/application invariants;
FSD owns UI/action slices; Ports & Adapters isolates provider authentication,
storage APIs and runtime capabilities.

- `packages/core`: host-neutral feature lifecycle, typed interfaces and
  sanitised telemetry contracts. No VK/ChatGPT selectors or credentials.
- `packages/archive`: source-neutral archive use cases; provider-specific
  source DTOs must remain inside their corresponding module.
- `packages/storage`: provider-neutral persistence ports and drivers;
  physical schema and provider ownership remain product-specific.
- `packages/ui`, `packages/widgets`, `packages/shell`: reusable, themed,
  accessible presentation and one shared Control Center; no widget-owned DB.
- `packages/adapters`: permission-checked browser target interfaces.
- `modules/<product>`: concrete provider, domain storage schema, auth,
  selection and media semantics.
- `apps/`: product/delivery composition, dependency injection and permissions;
  no duplicated business engines, implicit cross-product access or global DB.
- Product-to-product interfaces are explicit exported ports. Never reach into
  another product's private IndexedDB schema or arbitrary extension storage.

Binding security/storage rules:
[environment isolation](ENVIRONMENTS_AND_STORAGE.md),
[integration](INTEGRATION_CONTRACT.md),
[backup/recovery](BACKUP_AND_RESTORE.md) and [telemetry](TELEMETRY.md).

## Release identity and safety

- PROD is promotion-gated after installed-product acceptance; CI and source
  review do not equal browser, user-data or product acceptance.
- DEV is independently updated by prerelease builds; PROD updates are never
  implicit consequences of DEV commits.
- A provider-only change affects its consumer and the aggregate, not an
  unrelated standalone provider. Shared runtime changes affect actual
  dependents. Build-only changes do not imply a product version increase.
- **VK Booster stays at 2.3.10** while retaining the v2 archive compatibility
  contract. No automatic VK source patch/minor/major bump. DEV independently
  increments the third numeric component (`dev-2.3.37`, `dev-2.3.38`)
  without changing the stable base. Existing VK v2 archives and output
  semantics remain readable and writable. See
  [VK product rules](../vk-booster/README.md).
- Historical ChatGPT PROD v3/v4 data and VK v2 archives must not be silently
  destroyed, converted or reassigned.
- No private message data, credentials, access tokens, cookies or attachments
  in telemetry, build logs or tracked fixtures. Synthetic fixtures only.
- Permissions are explicit capabilities. MV3 privileges are not assumed by
  userscripts; proxy capability is not shipped without a validated background.

## Long-lived PRs and multi-agent integration

One coherent **workstream owns one working branch and one PR**. Do not open a
new PR for every feature, bug fix, test or review correction in the same
workstream. Keep adding small reviewed commits to its existing branch/PR,
updating the PR scope, current acceptance evidence and head SHA.

For parallel ChatGPT/shared-platform and VK work, use at most **one open
integration PR per owner/workstream**. A shared change is produced by one
owner, validated in the affected consumers, then incorporated into the
other owner's branch via Git merge/rebase or a reviewed, explicit patch.
Do not create a third "integration" PR or silently copy incompatible
source. Before changing another owner's paths, coordinate the intended
boundary on the existing Issue/PR and inspect its latest remote head.

Avoid permanent chains of stacked PRs. Consolidate accumulated unmerged
work into the existing owner PR, retarget it to the intended base and close
redundant PRs **only after** verifying their commits/diffs remain reachable
from the surviving branch. Do not delete source history or force-push
over another agent's work. After one workstream merges to main, the other
refreshes its branch from the current main and resolves version/lockfile,
provider ownership, schema, storage and UI conflicts before requesting
independent review. Major architectural disagreements are explicit
integration blockers, not permission to silently prefer a branch.

The writer owns implementation, tests and pushing to its own branch;
the independent reviewer owns exact-head acceptance and merges. Check
source+types+lint+tests+affected builds, then **exact final-head CI/review**.
Main merges trigger continuous DEV prerelease publication after a passing
push CI. Never use an apparently successful earlier PR CI as proof of a
changed combined head. PROD still requires installed-browser/data and
explicit promotion acceptance. Do not disable automatic DEV to work
around conflicts; resolve the integration before merging.

## Engineering workflow

Use `AGENTS.md` as a **router**, not a second copy of these rules. Load only
the relevant product and shared contracts for the task. Development is on
non-protected branches; CI, strict TypeScript/Vue, Biome, unit and artifact
checks are required before independent review. The implementer must not merge
its own PR. All changes require a clear `Target extension` and affected
consumers, as described in [issue routing](../ISSUE_ROUTING.md).

Validation levels must be distinct: source review, local tests, built artifacts,
installed-browser runtime, data recovery and production acceptance.
