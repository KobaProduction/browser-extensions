<script setup lang="ts">
import { Button, FloatingInfoPopover } from '@kobaproduction/browser-ui'
import Archive from 'lucide-vue-next/dist/esm/icons/archive.js'
import Settings2 from 'lucide-vue-next/dist/esm/icons/settings-2.js'
import { translate } from './i18n'
import type { ScopeArchiveControlModel } from './scope-archive-control'

const props = defineProps<{ model: ScopeArchiveControlModel }>()
const t = (key: Parameters<typeof translate>[1]) => translate(props.model.locale, key)
const label = () =>
  (props.model.context.title ||
    t(props.model.context.scope === 'project' ? 'identity.unknownProject' : 'identity.untitled')) +
  ' · ' +
  t(props.model.effectiveEnabled ? 'dock.autoOn' : 'dock.autoOff')
</script>

<template>
  <span
    v-if="model.context.scope === 'conversation'"
    class="booster-chat-save-marker"
    :class="{ 'is-enabled': model.effectiveEnabled, 'is-work': model.workConversation }"
    :title="label()"
    aria-hidden="true"
  />

  <FloatingInfoPopover v-else mode="click" :label="label()">
    <template #trigger>
      <span
        class="inline-flex items-center"
        :class="model.effectiveEnabled ? 'text-success' : 'text-muted-foreground'"
      >
        <Archive class="size-3.5" />
      </span>
    </template>

    <section class="booster-scope-popover" @click.stop>
      <header>
        <strong class="booster-scope-title">
          {{ model.context.title || t('identity.unknownProject') }}
        </strong>
        <span class="booster-scope-kind">{{ t('capture.project') }}</span>
      </header>

      <div class="booster-meta-lines">
        <strong class="booster-meta-label">{{ t('scope.localArchive') }}</strong>
        <span class="booster-meta-value">
          {{
            model.archivedCount > 0
              ? t('scope.archived') + ' · ' + model.archivedCount
              : t('scope.notArchived')
          }}
        </span>
        <strong class="booster-meta-label">{{ t('capture.policy') }}</strong>
        <span class="booster-meta-value">{{
          t(model.effectiveEnabled ? 'dock.autoOn' : 'dock.autoOff')
        }}</span>
        <strong class="booster-meta-label">{{ t('scope.rule') }}</strong>
        <span class="booster-meta-value">{{
          t(('scope.source.' + model.source) as Parameters<typeof t>[0])
        }}</span>
      </div>

      <div class="booster-scope-actions">
        <Button type="button" size="sm" variant="outline" @click="model.onOpenArchive()">
          <Archive class="size-3.5" />{{ t('reader.title') }}
        </Button>
        <Button type="button" size="sm" variant="outline" @click="model.onSetEnabled(!model.effectiveEnabled)">
          {{ t(model.effectiveEnabled ? 'capture.off' : 'capture.on') }}
        </Button>
        <Button v-if="model.hasOverride" type="button" size="sm" variant="ghost" @click="model.onInherit()">
          {{ t('capture.inherit') }}
        </Button>
        <Button type="button" size="sm" variant="ghost" @click="model.onSettings()">
          <Settings2 class="size-3.5" />{{ t('scope.settings') }}
        </Button>
      </div>
    </section>
  </FloatingInfoPopover>
</template>
