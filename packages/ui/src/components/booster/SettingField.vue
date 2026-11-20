<script setup lang="ts">
import { Card } from '../ui/card'
import { Label } from '../ui/label'

defineProps<{ id: string; title: string; description?: string }>()
</script>

<template>
  <Card class="grid min-w-0 gap-3 p-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))] items-center">
    <div class="min-w-0 space-y-1">
      <Label :for="id" class="block text-sm font-medium leading-5">{{ title }}</Label>
      <p v-if="description" :id="`${id}-description`" class="text-xs leading-5 text-muted-foreground">{{ description }}</p>
    </div>
    <slot :description-id="description ? `${id}-description` : undefined" />
  </Card>
</template>
