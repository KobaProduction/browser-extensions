/** Build identity is injected by the final product bundle, never read from page state. */
declare const __BOOSTER_INSTANCE_SCOPE__: string | undefined

export function instanceScope(): string {
  return typeof __BOOSTER_INSTANCE_SCOPE__ === 'string' ? __BOOSTER_INSTANCE_SCOPE__ : ''
}

/** Tests pass an explicit scope; runtime callers use the compiled per-bundle scope. */
export function scopedIdentity(base: string, scope: string, legacyOwner?: string): string {
  if (!scope || (legacyOwner && scope === legacyOwner)) return base
  if (!/^(vk-booster|chatgpt-booster|all-in-one):(dev|prod)$/.test(scope))
    throw new Error('Unsupported Booster instance scope')
  return base + ':' + scope
}

export function instanceKey(base: string, legacyOwner?: string): string {
  return scopedIdentity(base, instanceScope(), legacyOwner)
}
