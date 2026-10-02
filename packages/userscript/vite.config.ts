import { resolve } from 'node:path'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

const header = `// ==UserScript==
// @name         ChatGPT Booster
// @namespace    https://github.com/KobaProduction/chatgpt-booster
// @version      0.1.0
// @description  Open-source UI and productivity toolkit for ChatGPT.
// @author       KobaProduction
// @match        https://chatgpt.com/*
// @grant        none
// @updateURL    https://github.com/KobaProduction/chatgpt-booster/releases/latest/download/chatgpt-booster.user.js
// @downloadURL  https://github.com/KobaProduction/chatgpt-booster/releases/latest/download/chatgpt-booster.user.js
// ==/UserScript==
`

export default defineConfig({
  plugins: [vue()],
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
    rollupOptions: {
      output: {
        banner: header,
      },
    },
  },
})
