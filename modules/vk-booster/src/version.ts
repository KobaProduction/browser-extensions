declare const __VK_BUILD_VERSION__: string | undefined
/** CI-assigned release version; unbundled source has no published identity. */
export const VK_BASE_VERSION =
  typeof __VK_BUILD_VERSION__ === 'string' && __VK_BUILD_VERSION__ ? __VK_BUILD_VERSION__ : '0.0.0-local'
