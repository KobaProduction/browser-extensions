import type { ConversationItemMetadataView } from '@chatgpt-booster/core'
import type { App } from 'vue'
import { createApp, reactive } from 'vue'
import type { SupportedLocale } from './i18n'
import RecordMetaBadges from './RecordMetaBadges.vue'
import styles from './styles.css?inline'

export interface MountedMessageMetadata {
  element: HTMLElement
  update(metadata: ConversationItemMetadataView): void
  unmount(): void
}

export function mountMessageMetadata(
  into: HTMLElement,
  metadata: ConversationItemMetadataView,
  locale: SupportedLocale,
  showModel: boolean,
): MountedMessageMetadata {
  const host = document.createElement('span')
  host.dataset.chatgptBooster = 'message-metadata'
  host.style.display = 'inline-flex'
  host.style.alignItems = 'center'
  host.style.height = '32px'
  into.append(host)

  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = styles
  shadow.append(style)
  const mountPoint = document.createElement('span')
  shadow.append(mountPoint)

  const model = reactive({ ...metadata })
  const app: App = createApp(RecordMetaBadges, {
    metadata: model,
    locale,
    showModel,
    compact: true,
  })
  app.mount(mountPoint)

  return {
    element: host,
    update(next) {
      Object.assign(model, next)
    },
    unmount() {
      app.unmount()
      host.remove()
    },
  }
}
