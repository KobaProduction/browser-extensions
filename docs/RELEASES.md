# Release operations

[DEV/PROD channels](DEV_PROD_CHANNELS.md) owns publication, retention,
installation identity, updater compatibility and PROD acceptance.
[Independent versions](INDEPENDENT_RELEASES.md) owns version impact across products.
Use [Git Workflow](https://github.com/ArthurKoba/ai-agent-workflow/blob/main/skills/git-workflow.md)
for commit/push/PR operations and [repository development](../README.md#development-and-releases)
for local commands and hooks.

## Operational entry points

| Operation | Implementation |
| --- | --- |
| Validate a source push or PR | [ci.yml](../.github/workflows/ci.yml) |
| Publish affected DEV products after successful main-push CI | [dev.yml](../.github/workflows/dev.yml) |
| Explicitly promote selected validated products to PROD | [release.yml](../.github/workflows/release.yml) |
| Determine affected products and independent versions | [channel-plan.ts](../scripts/channel-plan.ts), [version-policy.ts](../scripts/version-policy.ts) |
| Publish product-specific update files | [publish-channel.sh](../scripts/publish-channel.sh) |
| Prune obsolete DEV release records | [prune-dev-releases.ts](../scripts/prune-dev-releases.ts) |

Inspect current workflow inputs, source SHA and checks before dispatching.
After publication verify the workflow result, release tag/source SHA, assets
and the published product's userscript version at its own channel URL.
Do not use repository-wide `releases/latest` as an updater: products advance
independently. Channel URLs and legacy mirrors are defined by the channel contract.
