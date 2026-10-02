<script setup lang="ts">
import { ref } from 'vue'

const open = ref(false)
</script>

<template>
  <div class="booster-shell">
    <div v-if="open" class="booster-panel">
      <h2>ChatGPT Booster</h2>
      <p>Foundation loaded. Feature modules will appear here as they are added.</p>
    </div>
    <button class="booster-button" type="button" title="ChatGPT Booster" @click="open = !open">
      B
    </button>
  </div>
</template>
