<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../lib/utils'
import { Card } from '../ui/card'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'

const props = defineProps<{
  id: string
  title: string
  description?: string
  modelValue: boolean
  disabled?: boolean
  flat?: boolean
  class?: HTMLAttributes['class']
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <component :is="flat ? 'div' : Card" :class="cn('flex min-w-0 items-start justify-between gap-3', flat ? 'border-t pt-3' : 'p-3', props.class)">
    <div class="min-w-0 flex-1 space-y-1">
      <Label :for="id" class="block text-sm font-medium leading-5">{{ title }}</Label>
      <p v-if="description" :id="`${id}-description`" class="text-xs leading-5 text-muted-foreground">{{ description }}</p>
      <slot />
    </div>
    <Switch :id="id" class="mt-0.5 shrink-0" :model-value="modelValue" :disabled="disabled"
      :aria-describedby="description ? `${id}-description` : undefined"
      @update:model-value="emit('update:modelValue', $event)" />
  </component>
</template>
