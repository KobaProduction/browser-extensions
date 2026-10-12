/** Vite .vue/.css modules for root TypeScript; Vue SFCs are checked by vue-tsc. */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
declare module '*?inline' {
  const source: string
  export default source
}
