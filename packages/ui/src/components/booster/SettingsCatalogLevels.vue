<script setup lang="ts">
import { ArrowLeft, ChevronRight } from 'lucide-vue-next'
import { computed } from 'vue'
import { useApplicationLocale } from '../../application-locale'
import type { SettingsCatalogEntry, SettingsCatalogGroup } from '../../settings-catalog'
import { Button } from '../ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'

const props = defineProps<{
  groups: readonly SettingsCatalogGroup[]
  groupId: string
  parents: readonly SettingsCatalogEntry[]
  entries: readonly SettingsCatalogEntry[]
  selected: string
}>()
const emit = defineEmits<{ group: [id: string]; back: [depth: number]; enter: [id: string] }>()
const locale = useApplicationLocale()
const text = (ru: string, en: string) => (locale.value === 'ru' ? ru : en)
const activeGroup = computed(() => props.groups.find((group) => group.id === props.groupId))
function chooseGroup(value: string | number) {
  emit('group', String(value))
}
</script>
<template>
  <Tabs :model-value="groupId" activation-mode="manual" class="min-w-0" @update:model-value="chooseGroup">
    <TabsList class="flex h-auto w-full flex-wrap justify-start gap-1" :aria-label="text('Группа настроек','Settings group')">
      <TabsTrigger v-for="group in groups" :key="group.id" :value="group.id" class="h-auto min-h-9 min-w-0 flex-1 whitespace-normal px-3 py-2 text-center text-xs min-[900px]:flex-none [&>span]:min-w-0 [&>span]:whitespace-normal [&>span]:break-words">{{ group.title }}</TabsTrigger>
    </TabsList>
    <TabsContent v-if="activeGroup" :key="activeGroup.id" :value="activeGroup.id" :data-settings-group="activeGroup.id" class="min-w-0 space-y-2" :class="{ 'mt-0': !entries.length }">
      <div v-if="parents.length" class="flex min-w-0 flex-wrap items-center gap-1" :aria-label="text('Путь к разделу','Section path')">
        <Button type="button" variant="ghost" size="sm" class="min-w-0 gap-1.5 px-2 text-xs" @click="emit('back',Math.max(0,parents.length-1))"><ArrowLeft class="size-3.5 shrink-0" />{{ text('Назад','Back') }}</Button>
        <Button type="button" variant="ghost" size="sm" class="min-w-0 whitespace-normal px-2 text-xs" @click="emit('back',0)">{{ text('Все разделы','All sections') }}</Button>
        <template v-for="(parent,index) in parents" :key="parent.id"><ChevronRight class="size-3 shrink-0 text-muted-foreground" /><Button type="button" variant="ghost" size="sm" class="h-auto min-h-8 min-w-0 whitespace-normal px-2 text-xs" @click="emit('back',index+1)">{{ parent.title }}</Button></template>
      </div>
      <div v-if="entries.length" class="grid min-w-0 gap-1 min-[621px]:flex min-[621px]:flex-wrap">
        <Button v-for="entry in entries" :key="entry.id" type="button"
          :variant="entry.id === selected ? 'secondary' : 'ghost'"
          :aria-current="entry.id === selected ? 'page' : undefined"
          class="h-auto min-h-10 min-w-0 justify-start gap-2 whitespace-normal px-3 py-2 text-left text-xs min-[621px]:min-h-9"
          :title="entry.description" @click="emit('enter',entry.id)">
          <span class="grid min-w-0 gap-0.5"><span class="break-words">{{ entry.title }}</span><small v-if="entry.children?.length && entry.description" class="font-normal text-muted-foreground">{{ entry.description }}</small></span>
          <ChevronRight v-if="entry.children?.length" class="ms-auto size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      </div>
    </TabsContent>
  </Tabs>
</template>
