#!/usr/bin/env bash
# Publish a verified module userscript to the stable distribution branch.
set -euo pipefail
id="$1"
[[ "$id" =~ ^[a-z][a-z0-9-]+$ ]] || { echo "Invalid module" >&2; exit 2; }
source_file="dist/$id/$id.user.js"
test -s "$source_file"
url="https://raw.githubusercontent.com/KobaProduction/browser-extensions/distribution/userscripts/$id.user.js"
grep -Fqx "// @updateURL    $url" "$source_file"
grep -Fqx "// @downloadURL  $url" "$source_file"
root="$(git rev-parse --show-toplevel)"
worktree="$(mktemp -d)"
cleanup() {
  git -C "$root" worktree remove --force "$worktree" >/dev/null 2>&1 || true
  rmdir "$worktree" 2>/dev/null || true
}
trap cleanup EXIT

git fetch origin refs/heads/distribution:refs/remotes/origin/distribution 2>/dev/null || true
if git show-ref --verify --quiet refs/remotes/origin/distribution; then
  git worktree add --detach "$worktree" refs/remotes/origin/distribution >/dev/null
  git -C "$worktree" switch -C distribution >/dev/null
else
  git worktree add --detach "$worktree" HEAD >/dev/null
  git -C "$worktree" switch --orphan distribution >/dev/null
  git -C "$worktree" rm -rf --ignore-unmatch . >/dev/null
fi
mkdir -p "$worktree/userscripts"
cp "$root/$source_file" "$worktree/userscripts/$id.user.js"
git -C "$worktree" add "userscripts/$id.user.js"
if git -C "$worktree" diff --cached --quiet; then
  echo "Channel unchanged: $id"
  exit 0
fi
git -C "$worktree" -c user.name='github-actions[bot]' \
  -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
  commit -m "build(distribution): update $id userscript" >/dev/null
git -C "$worktree" push origin HEAD:refs/heads/distribution
echo "Published stable userscript: $url"
