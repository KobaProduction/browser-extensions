#!/usr/bin/env bash
# Narrow, immutable-version channels: dev is continuous prerelease, prod is approved.
set -euo pipefail
id="${1:?product required}"
channel="${2:?channel dev/prod required}"
[[ "$id" =~ ^(vk-booster|chatgpt-booster|all-in-one)$ ]] || { echo "Invalid product" >&2; exit 2; }
[[ "$channel" == dev || "$channel" == prod ]] || { echo "Invalid channel" >&2; exit 2; }
root="$(git rev-parse --show-toplevel)"
source_js="$root/dist/$id/$id.user.js"
source_zip="$root/dist/$id/$id-extension.zip"
test -s "$source_js"
test -s "$source_zip"
url="https://raw.githubusercontent.com/KobaProduction/browser-extensions/$channel/userscripts/$id.user.js"
grep -Fqx "// @updateURL    $url" "$source_js"
grep -Fqx "// @downloadURL  $url" "$source_js"
worktree="$(mktemp -d)"
cleanup() {
  git -C "$root" worktree remove --force "$worktree" >/dev/null 2>&1 || true
  rmdir "$worktree" 2>/dev/null || true
}
trap cleanup EXIT
git fetch origin "refs/heads/$channel:refs/remotes/origin/$channel" 2>/dev/null || true
if git show-ref --verify --quiet "refs/remotes/origin/$channel"; then
  git worktree add --detach "$worktree" "refs/remotes/origin/$channel" >/dev/null
  git -C "$worktree" switch -C "$channel" >/dev/null
else
  git worktree add --detach "$worktree" HEAD >/dev/null
  git -C "$worktree" switch --orphan "$channel" >/dev/null
  git -C "$worktree" rm -rf --ignore-unmatch . >/dev/null
fi
mkdir -p "$worktree/userscripts" "$worktree/extensions"
cp "$source_js" "$worktree/userscripts/$id.user.js"
cp "$source_zip" "$worktree/extensions/$id-extension.zip"
git -C "$worktree" add "userscripts/$id.user.js" "extensions/$id-extension.zip"
if ! git -C "$worktree" diff --cached --quiet; then
  git -C "$worktree" -c user.name='github-actions[bot]'     -c user.email='41898282+github-actions[bot]@users.noreply.github.com'     commit -m "build($channel): advance $id" >/dev/null
  git -C "$worktree" push origin "HEAD:refs/heads/$channel"
fi
echo "$channel published: $id"

# Legacy installed prod userscripts must not lose their old updater during cutover.
# This mirror is prod-only; dev never touches the existing distribution branch.
if [[ "$channel" == prod ]]; then
  git fetch origin refs/heads/distribution:refs/remotes/origin/distribution 2>/dev/null || true
  if git show-ref --verify --quiet refs/remotes/origin/distribution; then
    git -C "$worktree" switch -C distribution refs/remotes/origin/distribution >/dev/null
    mkdir -p "$worktree/userscripts"
    cp "$source_js" "$worktree/userscripts/$id.user.js"
    git -C "$worktree" add "userscripts/$id.user.js"
    if ! git -C "$worktree" diff --cached --quiet; then
      git -C "$worktree" -c user.name='github-actions[bot]'         -c user.email='41898282+github-actions[bot]@users.noreply.github.com'         commit -m "build(distribution): migrate $id to prod update channel" >/dev/null
      git -C "$worktree" push origin HEAD:refs/heads/distribution
    fi
  fi
fi
