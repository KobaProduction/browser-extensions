import { ref } from 'vue'
/** VK-only routing instructions; the shared QuickMenu owns no VK UI state. */
export const vkRequestedView = ref<'capture' | 'reader' | 'settings' | 'collect' | 'export' | null>(null)
/** Presentation only: remounting a service-bound view cannot replay an operation. */
export const vkActiveView = ref<'capture' | 'reader' | 'settings'>('capture')
