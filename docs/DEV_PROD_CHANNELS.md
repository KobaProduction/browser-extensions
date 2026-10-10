# DEV prereleases, PROD releases and simultaneous installations

## Authority and flow

`main` remains the reviewed source branch. `dev` and `prod` are *distribution
branches*, not competing writable code branches. This prevents a channel
promotion from inventing source history or causing endless build-on-push loops.

- Every successful, trusted `main` push CI triggers `.github/workflows/dev.yml`.
  The source diff from the first parent determines which products have changed.
  Each changed product is built, validated and published as a GitHub
  **prerelease** with immutable tag `<product>/v<base>-dev.<run>`.
  Its `dev/userscripts/<product>.user.js` and
  `dev/extensions/<product>-extension.zip` are advanced. Untouched products
  keep their existing channel files and version.
- Production is never advanced by a DEV push or an ordinary merge.
  After installed-product acceptance, explicit `approve_release=true` on
  `main` publishes absent stable product version tags, and promotes **only
  eligible products** to the `prod` channel.
- The old `distribution` update URLs are kept as a **PROD-only compatibility
  mirror** so existing userscripts do not lose their stable update path.
  DEV never updates `distribution`, `prod` or their GitHub stable tags.
- Dependencies follow `apps/all-in-one.json`: a VK-only source change
  builds/versions VK and aggregate, but not ChatGPT; ChatGPT-only changes
  affect ChatGPT and aggregate; common runtime, packaging and storage
  changes affect all real consumers. Docs-only changes release nothing.
- Base product semver remains independent. Only the build's DEV metadata
  receives `-dev.<run>` (Chromium `version` uses a legal fourth numeric
  component). A new stable `X.Y.Z` requires the product's own version bump.
  DEV run counters above Chromium's fourth-component limit fail closed.
- Channel publication is serialized; neither workflow is authorized to
  commit to the reserved source branch.

## Installed identity matrix

| Installed product | PROD | DEV |
| --- | --- | --- |
| VK Booster | Legacy standalone VK archive identity, isolated from others | Separate VK DEV scope |
| ChatGPT Booster | Existing standalone v3/v4 IndexedDB names (no implicit migration) | Separate ChatGPT DEV scope and v3/v4 names |
| All-in-one | Separate aggregate storage, root and events on both hosts | Separate aggregate DEV storage, root and events |

- Source-bundle instance IDs have the form `<product>:<channel>`.
  The shared control center root, launcher-position key, settings, provider
  shell events and relevant ChatGPT transport signals are scoped by this ID.
  The old standalone PROD ChatGPT database names
  (`chatgpt-booster-archive`, `chatgpt-booster-archive-v4`) and settings
  remain unchanged; aggregate and DEV do not import, overwrite or delete
  those archives automatically.
- DEV MV3 packages embed independent, fixed **public** extension identity
  keys for VK, ChatGPT and aggregate; their `chrome.storage.local` stores
  are physically separate. PROD MV3 does **not** change legacy extension
  identity: keep the same unpacked installation directory for upgrades.
  No private signing keys are stored in source.
- Tampermonkey DEV script names/namespaces and updater URLs differ from PROD;
  existing PROD names/namespaces remain stable. Chrome users should not run
  a Tampermonkey and MV3 copy of the **same product and channel** together.
- VK v2 folder archives keep their existing schema. New owned folders include
  an `instance_scope` stamp. DEV and aggregate refuse unowned legacy folders
  or a folder stamped for another installation; only the original PROD VK
  standalone may reopen unstamped v2 archives. Never point two live instances
  at the same archive output directory.

## Acceptance / safety boundary

Static separation of names and compilation is **not** a live concurrency
guarantee. Before advertising co-installation as accepted, test all six
installable combinations in one browser profile, verify separate extension IDs,
v3/v4 persistence, visible controls, page events, real user authorization,
VK v2 folder guards, and restart/update/rollback. Do not publish an
untested PROD change solely on source/build success. Existing browser data
are never auto-migrated between extension IDs or channels.
