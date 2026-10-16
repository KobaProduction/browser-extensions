<script setup lang="ts">
import { reactiveOmit } from '@vueuse/core'
import type { SelectContentEmits, SelectContentProps } from 'reka-ui'
import { SelectContent, SelectPortal, SelectViewport, useForwardPropsEmits } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../lib/utils'
import { useUiPortalTarget } from '../../../portal-target'
import { SelectScrollDownButton, SelectScrollUpButton } from '.'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<SelectContentProps & { class?: HTMLAttributes['class'] }>(), {
  position: 'popper',
})
const emits = defineEmits<SelectContentEmits>()

const delegatedProps = reactiveOmit(props, 'class')

const forwarded = useForwardPropsEmits(delegatedProps, emits)
const portalTarget = useUiPortalTarget()
</script>

<template>
  <SelectPortal :to="portalTarget">
    <SelectContent
      v-bind="{ ...forwarded, ...$attrs }" :class="cn(
        'relative z-50 max-h-[min(24rem,calc(100dvh_-_20px))] min-w-[min(8rem,calc(100vw_-_20px))] max-w-[calc(100vw_-_20px)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        position === 'popper'
          && 'min-w-[min(8rem,max(0px,var(--reka-select-content-available-width)))] max-w-[max(0px,var(--reka-select-content-available-width))] max-h-[min(24rem,max(0px,var(--reka-select-content-available-height)))] data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1',
        props.class,
      )
      "
    >
      <SelectScrollUpButton />
      <!-- Let options determine height, then shrink/scroll within Reka's available space. -->
      <SelectViewport :class="cn('min-h-0 min-w-0 p-1', position === 'popper' && 'w-full min-w-[min(var(--reka-select-trigger-width),max(0px,var(--reka-select-content-available-width)))]')">
        <slot />
      </SelectViewport>
      <SelectScrollDownButton />
    </SelectContent>
  </SelectPortal>
</template>
