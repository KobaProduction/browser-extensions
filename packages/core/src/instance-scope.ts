/** Build identity is injected by the final product bundle, never read from page state. */
declare const __BOOSTER_INSTANCE_SCOPE__: string | undefined
declare const __BOOSTER_DELIVERY_TARGET__: string | undefined

export function instanceScope(): string {
  return typeof __BOOSTER_INSTANCE_SCOPE__ === 'string' ? __BOOSTER_INSTANCE_SCOPE__ : ''
}

/** Tests pass an explicit scope; runtime callers use the compiled per-bundle scope. */
export function scopedIdentity(base: string, scope: string, legacyOwner?: string): string {
  if (!scope || (legacyOwner && scope === legacyOwner)) return base
  if (!/^(vk-booster|chatgpt-booster|all-in-one):(dev|prod)$/.test(scope))
    throw new Error('Unsupported Booster instance scope')
  return `${base}:${scope}`
}

export function instanceKey(base: string, legacyOwner?: string): string {
  return scopedIdentity(base, instanceScope(), legacyOwner)
}

/** DOM, page events and shell layout belong to one delivery installation.
 * Persistent provider/database keys continue to use instanceKey. */
export function scopedShellIdentity(base: string, scope: string, target: string): string {
  if (target && target !== 'chromium' && target !== 'userscript')
    throw new Error('Unsupported Booster delivery target')
  const identity = scopedIdentity(base, scope)
  return target ? `${identity}:${target}` : identity
}

export function shellInstanceKey(base: string): string {
  const target = typeof __BOOSTER_DELIVERY_TARGET__ === 'string' ? __BOOSTER_DELIVERY_TARGET__ : ''
  return scopedShellIdentity(base, instanceScope(), target)
}
