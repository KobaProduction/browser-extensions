import {
  APPLICATION_LOCALE,
  type ApplicationLanguagePreference,
  type ApplicationLocaleController,
  resolveApplicationLocale,
} from '@kobaproduction/browser-core'
import { computed, inject, onBeforeUnmount, ref } from 'vue'

/** Shared shell injection is authoritative; legacy standalone surfaces retain a read fallback. */
export function useApplicationLocale(fallback: () => ApplicationLanguagePreference = () => 'auto') {
  const controller = inject<ApplicationLocaleController | null>(APPLICATION_LOCALE, null)
  const revision = ref(0)
  if (controller) onBeforeUnmount(controller.subscribe(() => revision.value++))
  return computed(() => {
    void revision.value
    return resolveApplicationLocale(controller?.current() ?? fallback())
  })
}
