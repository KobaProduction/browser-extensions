<script setup lang="ts">
import Archive from 'lucide-vue-next/dist/esm/icons/archive.js'
import Settings2 from 'lucide-vue-next/dist/esm/icons/settings-2.js'
import FloatingInfoPopover from './FloatingInfoPopover.vue'
import type { ScopeArchiveControlModel } from './scope-archive-control'
import { translate } from './i18n'

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
    :class="{ 'is-enabled': model.effectiveEnabled }"
    :title="label()"
    aria-hidden="true"
  />

  <FloatingInfoPopover v-else mode="click" :label="label()">
    <template #trigger>
      <span
        class="booster-project-status-badge"
        :class="model.effectiveEnabled ? 'is-enabled' : 'is-disabled'"
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
        <button type="button" @click="model.onSetEnabled(!model.effectiveEnabled)">
          {{ t(model.effectiveEnabled ? 'capture.off' : 'capture.on') }}
        </button>
        <button v-if="model.hasOverride" type="button" @click="model.onInherit()">
          {{ t('capture.inherit') }}
        </button>
        <button type="button" @click="model.onSettings()">
          <Settings2 class="size-3.5" />{{ t('scope.settings') }}
        </button>
      </div>
    </section>
  </FloatingInfoPopover>
</template>
