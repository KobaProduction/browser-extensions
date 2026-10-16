import { type InjectionKey, inject } from 'vue'

/** The host supplies a container inside its ShadowRoot. Ordinary apps keep Reka's body default. */
export const UI_PORTAL_TARGET: InjectionKey<HTMLElement> = Symbol('koba.ui.portal-target')
export function useUiPortalTarget(): HTMLElement | undefined {
  return inject(UI_PORTAL_TARGET, undefined)
}
