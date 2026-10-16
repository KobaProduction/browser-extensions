import { createApp } from 'vue'
import './lab.css'

document.documentElement.classList.add('dark')

function showLabFailure(error: unknown) {
  const root = document.getElementById('app')
  if (root) {
    root.replaceChildren()
    const section = document.createElement('section')
    section.style.cssText = 'padding:24px;color:#ff9d9d;background:#1e1111;white-space:pre-wrap'
    section.setAttribute('role', 'alert')
    section.textContent = `UI Acceptance Lab failed to mount: ${error instanceof Error ? error.message : String(error)}`
    root.append(section)
  }
}
window.addEventListener('error', (event) => showLabFailure(event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => showLabFailure(event.reason))
void import('./App.vue')
  .then(({ default: App }) => {
    const app = createApp(App)
    app.config.errorHandler = (error) => showLabFailure(error)
    app.mount('#app')
  })
  .catch(showLabFailure)
