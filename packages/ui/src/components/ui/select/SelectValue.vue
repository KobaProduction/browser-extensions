<script setup lang="ts">
import { reactiveOmit } from '@vueuse/core'
import type { SelectValueProps } from 'reka-ui'
import { SelectValue } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../lib/utils'

const props = defineProps<SelectValueProps & { class?: HTMLAttributes['class'] }>()
const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <SelectValue v-bind="delegatedProps" :class="cn('min-w-0 flex-1 truncate text-start', props.class)">
    <slot />
  </SelectValue>
</template>
