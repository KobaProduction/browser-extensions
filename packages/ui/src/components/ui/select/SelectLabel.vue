<script setup lang="ts">
import { reactiveOmit } from '@vueuse/core'
import type { SelectLabelProps } from 'reka-ui'
import { SelectLabel } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../lib/utils'

const props = defineProps<SelectLabelProps & { class?: HTMLAttributes['class'] }>()
const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <SelectLabel v-bind="delegatedProps" :class="cn('px-2 py-1.5 text-sm font-semibold', props.class)">
    <slot />
  </SelectLabel>
</template>
