#!/usr/bin/env bash
# Reserve once before building. A failed/retried CI run reuses this exact SHA assignment.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
test -s "$root/.release-versions.json"
worktree="$(mktemp -d)"
cleanup() {
  git -C "$root" worktree remove --force "$worktree" >/dev/null 2>&1 || true
  rmdir "$worktree" 2>/dev/null || true
}
trap cleanup EXIT
git fetch origin refs/heads/dev:refs/remotes/origin/dev
git worktree add --detach "$worktree" refs/remotes/origin/dev >/dev/null
cp "$root/.release-versions.json" "$worktree/release-versions.json"
git -C "$worktree" add release-versions.json
if ! git -C "$worktree" diff --cached --quiet; then
  git -C "$worktree" -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    commit -m "build: assign release versions for $GITHUB_SHA" >/dev/null
  git -C "$worktree" push origin HEAD:refs/heads/dev
fi
