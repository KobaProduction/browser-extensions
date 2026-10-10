# VK Booster isolated development and integration plan

This is the VK Booster implementation lane for the shared browser-extension
platform. It does not own the ChatGPT Booster migration or its live workspace.

## Recovery point and ownership

- Recovered source baseline: `b940b8d`, VK Booster 2.3.2,
  all-in-one 0.4.2 (the existing v2 archive format).
- Local working branch: `agent/vk-booster-isolated`; its working directory
  is independent from the ChatGPT migration checkout.
- Primary scope: `modules/vk-booster/**`, VK-owned test fixtures and
  VK-specific documentation.
- Changes to `packages/archive`, `packages/storage`, `packages/widgets`,
  `packages/shell`, apps/target entrypoints and root build configuration
  require inspecting the active ChatGPT branch first, because both products
  consume these shared contracts. Prefer provider-specific adapters until
  a neutral shared contract is accepted.
- Do not modify the other agent's checkout or branch, migrate ChatGPT
  IndexedDB data, rewrite existing VK v2 archive output, or publish directly
  to `main`.

## Work sequence

1. Re-run strict source checks and produce fresh VK Booster and all-in-one
   Tampermonkey/MV3 artifacts in this worktree. Validate manifests, packaging
   and declared module versions.
2. Continue only VK-owned product and safety behavior: conversation identity
   guards, resumable export, media preservation, folder validation and
   consistent Control Center presentation. Add narrow regressions for each
   changed invariant.
3. Validate the real browser boundary separately, with an authorized VK test
   account and test archive only; TypeScript checks and packaging are not
   browser acceptance.
4. Before integration, compare both branch heads and their merge base.
   Review the shared package and entrypoint diff together with the ChatGPT
   agent's accepted changes. Resolve conflicting package/interface contracts
   explicitly rather than overwriting either implementation.
5. Propose one consolidated reviewed PR when the VK lane is source/build
   ready. An independent reviewer owns the merge, and release readiness
   requires separate browser acceptance.

## First isolated VK change

- VK Booster 2.3.3: reserve concurrent export operation before asynchronous
  authorization and release the reservation on failed authorization. Added
  two VK-only regression scenarios; there are no common package edits.

## Latest known risks

- The shared folder driver cannot atomically commit the two VK v2 JSON files.
  Preserve acknowledged checkpoint/resume semantics and never describe them
  as filesystem ACID writes.
- ChatGPT migration may change common package contracts and import paths;
  rebuilding against the eventual integration branch is mandatory.
- Do not read, log or export cookies, API tokens or real personal messages.
- Prior build attempts were blocked by the old terminal container's process
  limit; a restarted container is not itself proof that the VK bundles build.
