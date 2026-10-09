import type { DefineComponent } from 'vue'
/** Reused ChatGPT Booster button (shadcn-vue conventions). */
export declare const Button: DefineComponent<{
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'default' | 'sm' | 'icon'
}>
/** Reused ChatGPT Booster badge. */
export declare const Badge: DefineComponent<{
  variant?: 'default' | 'secondary' | 'outline'
}>

export declare const ModalSurface: DefineComponent<{
  label: string
  wide?: boolean
  surfaceClass?: string
}>
export declare const JsonViewer: DefineComponent<{ value: unknown }>
export declare const FloatingInfoPopover: DefineComponent<{
  label: string
  mode?: 'hover' | 'click' | 'hover-click'
  align?: 'start' | 'end'
  triggerClass?: string
}>
