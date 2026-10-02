<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { chromeSettings } from '../settings'

const enabled = ref(true)
const ready = ref(false)

onMounted(async () => {
  enabled.value = (await chromeSettings.get()).enabled
  ready.value = true
})

async function updateEnabled() {
  await chromeSettings.set({ enabled: enabled.value })
}
</script>

<template>
  <main>
    <header>
      <strong>ChatGPT Booster</strong>
      <span>0.1.0</span>
    </header>

    <label v-if="ready">
      <span>
        <b>Page integration</b>
        <small>Show Booster controls on ChatGPT.</small>
      </span>
      <input v-model="enabled" type="checkbox" @change="updateEnabled" />
    </label>

    <p>Open ChatGPT to use injected tools.</p>
  </main>
</template>

<style>
:root {
  color-scheme: light dark;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

body {
  margin: 0;
  min-width: 310px;
  background: #18181b;
  color: #f4f4f5;
}

main {
  padding: 16px;
}

header,
label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

header {
  margin-bottom: 16px;
}

header span,
small,
p {
  color: #a1a1aa;
  font-size: 12px;
}

label {
  padding: 12px;
  border: 1px solid #3f3f46;
  border-radius: 12px;
}

label span {
  display: grid;
  gap: 3px;
}

p {
  margin: 14px 2px 0;
}
</style>
