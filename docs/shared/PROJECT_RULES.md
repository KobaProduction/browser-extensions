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
- **VK Booster's base version is fixed at 3.0.0 during development**, by explicit
  product-owner decision. Do not produce 3.0.1/3.1.0 automatically. DEV may
  advance `3.0.0-dev.N`. See [VK product rules](../vk-booster/README.md).
- Historical ChatGPT PROD v3/v4 data contracts must not be silently destroyed.
  VK has no required prototype v2 compatibility.
- No private message data, credentials, access tokens, cookies or attachments
  in telemetry, build logs or tracked fixtures. Synthetic fixtures only.
- Permissions are explicit capabilities. MV3 privileges are not assumed by
  userscripts; proxy capability is not shipped without a validated background.

## Engineering workflow

Use `AGENTS.md` as a **router**, not a second copy of these rules. Load only
the relevant product and shared contracts for the task. Development is on
non-protected branches; CI, strict TypeScript/Vue, Biome, unit and artifact
checks are required before independent review. The implementer must not merge
its own PR. All changes require a clear `Target extension` and affected
consumers, as described in [issue routing](../ISSUE_ROUTING.md).

Validation levels must be distinct: source review, local tests, built artifacts,
installed-browser runtime, data recovery and production acceptance.
