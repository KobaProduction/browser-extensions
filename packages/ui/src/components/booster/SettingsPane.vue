<script setup lang="ts">
defineProps<{ embedded?: boolean }>()
</script>

<template>
  <component :is="embedded ? 'div' : 'main'" class="booster-settings-content @container grid min-h-0 min-w-0 content-start gap-3" :class="{ 'p-3': !embedded }">
    <slot />
  </component>
</template>
