import { ref } from 'vue'
/** VK-only routing instructions; the shared QuickMenu owns no VK UI state. */
export const vkRequestedView = ref<'capture' | 'reader' | 'settings' | 'collect' | 'export' | null>(null)
