import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'
import { finalizeUserscript } from './scripts/finalize-userscript.ts'

const variant = process.env.CHATGPT_BOOSTER_VARIANT === 'dev' ? 'dev' : 'prod'
const buildSha = process.env.CHATGPT_BOOSTER_BUILD_SHA ?? ''
const isDev = variant === 'dev'
const outputFile = isDev ? 'chatgpt-booster.dev.user.js' : 'chatgpt-booster.user.js'

function userscriptMetadataPlugin(): Plugin {
  return {
    name: `chatgpt-booster-userscript-metadata-${variant}`,
    apply: 'build',
    async writeBundle() {
      await finalizeUserscript({ variant })
    },
  }
}

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __BOOSTER_BUILD_SHA__: JSON.stringify(buildSha),
    'process.env': '{}',
  },
  plugins: [vue(), tailwindcss(), userscriptMetadataPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: !isDev,
    sourcemap: isDev,
    minify: !isDev,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'ChatGptBooster',
      formats: ['iife'],
      fileName: () => outputFile,
    },
  },
})
