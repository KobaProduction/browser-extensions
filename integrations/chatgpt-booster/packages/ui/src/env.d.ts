declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
declare module 'lucide-vue-next/dist/esm/icons/*.js' {
  import type { Component } from 'vue'

  const component: Component
  export default component
}
