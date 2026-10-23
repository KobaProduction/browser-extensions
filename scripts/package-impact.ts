/** Script aliases change the quality gate, not shipped code or dependencies. */
export function onlyPackageScriptsChanged(before: string, after: string): boolean {
  try {
    const left = JSON.parse(before)
    const right = JSON.parse(after)
    if (!left || !right || Array.isArray(left) || Array.isArray(right)) return false
    const changed = JSON.stringify(left.scripts) !== JSON.stringify(right.scripts)
    delete left.scripts
    delete right.scripts
    return changed && JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}
