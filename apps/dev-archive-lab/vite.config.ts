import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const root = fileURLToPath(new URL('../../', import.meta.url))
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@kobaproduction/browser-core': root + 'packages/core/src/index.ts',
      '@kobaproduction/browser-ui': root + 'packages/ui/src/index.ts',
      '@kobaproduction/browser-adapters': root + 'packages/adapters/src/index.ts',
      '@kobaproduction/browser-archive': root + 'packages/archive/src/index.ts',
      '@kobaproduction/browser-widgets/styles.css': root + 'apps/dev-archive-lab/src/widgets.css',
      '@kobaproduction/browser-widgets': root + 'packages/widgets/src/index.ts',
      '@kobaproduction/browser-shell': root + 'packages/shell/src/index.ts',
    },
  },
  server: { host: '127.0.0.1', port: 5187, strictPort: true },
})
