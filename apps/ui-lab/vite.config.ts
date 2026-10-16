import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
// Local Bun cache contains the actual Lucide CJS barrel but lacks ESM icon JS
// alongside its source maps. Use the real CJS icons for standalone lab previews.
const directIconPattern = /^lucide-vue-next\/dist\/esm\/icons\/([a-z0-9-]+)\.js$/
const iconPlugin = {
  name: 'ui-lab-lucide-cache-compat',
  enforce: 'pre' as const,
  resolveId(id: string) {
    const match = id.match(directIconPattern)
    return match ? `\0ui-lab-icon:${match[1]}` : null
  },
  load(id: string) {
    if (!id.startsWith('\0ui-lab-icon:')) return null
    const pascal = id
      .slice('\0ui-lab-icon:'.length)
      .split('-')
      .map((part) => part[0]?.toUpperCase() + part.slice(1))
      .join('')
    return `import * as icons from 'lucide-vue-next'; export default icons[${JSON.stringify(pascal)}];`
  },
}
const fromRepo = (file: string) => resolve(root, '../..', file)
const sourceAliases: [string, string][] = [
  ['@kobaproduction/browser-widgets/styles.css', 'apps/ui-lab/src/widget-styles.css'],
  ['@kobaproduction/browser-ui/theme.css', 'packages/ui/src/theme.css'],
  ['@kobaproduction/browser-ui/styles.css', 'packages/ui/src/styles.css'],
  ['@kobaproduction/browser-core', 'packages/core/src/index.ts'],
  ['@kobaproduction/browser-ui', 'packages/ui/src/index.ts'],
  ['@kobaproduction/browser-widgets', 'packages/widgets/src/index.ts'],
  ['@kobaproduction/browser-archive', 'packages/archive/src/index.ts'],
  ['@kobaproduction/browser-storage', 'packages/storage/src/index.ts'],
  ['@kobaproduction/browser-adapters', 'packages/adapters/src/index.ts'],
  ['@chatgpt-booster/core', 'modules/chatgpt-booster/packages/core/src/index.ts'],
  ['@chatgpt-booster/features', 'modules/chatgpt-booster/packages/features/src/index.ts'],
  ['@chatgpt-booster/chatgpt', 'modules/chatgpt-booster/packages/chatgpt/src/index.ts'],
  ['@chatgpt-booster/observer', 'modules/chatgpt-booster/packages/observer/src/index.ts'],
  ['@chatgpt-booster/ui', 'modules/chatgpt-booster/packages/ui/src/index.ts'],
]

export default defineConfig({
  root,
  plugins: [iconPlugin, vue(), tailwindcss()],
  resolve: {
    alias: [
      ...sourceAliases.map(([find, path]) => ({
        // Entry-point aliases must not turn CSS subpaths into index.ts/theme.css.
        find: new RegExp(`^${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`),
        replacement: fromRepo(path),
      })),
      // Bun's local icon cache lacks the package ESM barrel; use its real CJS barrel.
      {
        find: /^lucide-vue-next$/,
        replacement: fromRepo('node_modules/lucide-vue-next/dist/cjs/lucide-vue-next.js'),
      },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: { allow: [fromRepo('.')], strict: true },
  },
  build: {
    outDir: resolve(root, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: { index: resolve(root, 'index.html'), preview: resolve(root, 'preview.html') },
    },
  },
  define: {
    __BOOSTER_INSTANCE_SCOPE__: JSON.stringify('all-in-one:dev'),
    __BOOSTER_DELIVERY_TARGET__: JSON.stringify('chromium'),
  },
})
