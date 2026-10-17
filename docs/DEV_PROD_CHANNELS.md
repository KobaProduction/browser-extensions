# DEV prereleases, PROD releases and simultaneous installations

## Authority and flow

`main` remains the reviewed source branch. `dev` and `prod` are *distribution
branches*, not competing writable code branches. This prevents a channel
promotion from inventing source history or causing endless build-on-push loops.

- Every successful, trusted `main` push CI triggers `.github/workflows/dev.yml`.
  The source diff from the first parent determines which products have changed.
  Each changed product is built, validated and published as a GitHub
  **prerelease** with immutable tag `dev-<product>/v<major>.<minor>.<counter>`.
  Counters advance independently per published product, including across
  source patch changes. Historical suffix-form DEV tags seed each counter.
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
- Base product semver remains independent, except that initial VK v1 is explicitly
  frozen at 1.0.0 until the first authorized PROD. Only the build's DEV metadata
  receives an independent, increasing **third** numeric component:
  `X.Y.<counter>`. A `dev-` prefix appears in release titles, GitHub tags
  and the Chromium display name. No fourth component is used. The source/PROD
  version remains `X.Y.Z`. The historical stable VK `2.3.8` tag exists: a
  v1.0.0 first-release candidate is numerically lower and **must not** be
  promoted over those installations without separate update/identity acceptance.
  Tampermonkey `@version` and MV3 `version` stay
  numeric so update comparison works; MV3 `version_name` shows
  `dev-X.Y.<counter>`. Counter overflow fails closed. A new stable `X.Y.Z`
  requires a separate authorized product version bump.
- Channel publication is serialized; neither workflow is authorized to
  commit to the reserved source branch.

## Installed identity matrix

Both channels run in normal and incognito windows on their supported hosts.
DEV is not restricted to private browsing. MV3's split incognito mode remains
supported, subject to the browser's user-controlled incognito permission;
userscripts do not carry an incognito-only `@run-in` directive. Channel isolation
is defined by installation identities and storage scopes below.

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
- The installed Tampermonkey DEV `@name` and `@namespace` are preserved
  for in-place upgrades, avoiding duplicate scripts. The `dev-` prefix applies
  to the release title/tag and Chromium display name, not those identities.
- Tampermonkey DEV script names/namespaces and updater URLs differ from PROD;
  existing PROD names/namespaces remain stable. Chrome users should not run
  a Tampermonkey and MV3 copy of the **same product and channel** together.
- Fresh VK Archive v1 folders use schema 1 and an `instance_scope` ownership
  stamp. DEV and aggregate refuse unowned or other-channel folders; only the
  original PROD standalone may load an unscoped compatible schema-1 folder.
  Historical schema-2 and state/pages folders must never be auto-opened as v1
  or rewritten; retain old tags as recovery references. Never point two live
  instances at the same archive output directory.

## Acceptance / safety boundary

Static separation of names and compilation is **not** a live concurrency
guarantee. Before advertising co-installation as accepted, test all six
installable combinations in one browser profile, verify separate extension IDs,
v3/v4 persistence, visible controls, page events, real user authorization,
VK v1 folder guards, historical schema-2 rejection and restart/update/rollback. Do not publish an
untested PROD change solely on source/build success. Existing browser data
are never auto-migrated between extension IDs or channels.

## DEV candidate independence for private workspace version bumps

Bun updates `bun.lock` when a private Booster's workspace packages change
version, even if no shared dependency changed. The DEV channel planner now
compares the old and new lockfile structurally: it ignores **only** an
otherwise byte/structure-equivalent workspace-version-only change belonging
to an explicitly changed product, allowing ChatGPT-only changes to advance
ChatGPT DEV and all-in-one DEV without rebuilding VK DEV. A lockfile-only
change, a shared dependency/config change, an unexpected workspace delta or
a parsing error still triggers the conservative all-consumer path. This
does **not** weaken build validation or alter the independent semver/PROD
approval policy.
