import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'
import { finalizeUserscript } from './scripts/finalize-userscript.ts'

function userscriptMetadataPlugin(): Plugin {
  return {
    name: 'chatgpt-booster-userscript-metadata',
    apply: 'build',
    async writeBundle() {
      await finalizeUserscript()
    },
  }
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), userscriptMetadataPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'ChatGptBooster',
      formats: ['iife'],
      fileName: () => 'chatgpt-booster.user.js',
    },
  },
})
