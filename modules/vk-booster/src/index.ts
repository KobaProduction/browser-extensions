import type {Feature} from '@kobaproduction/browser-core'
import {installVkArchive} from './archive-runtime.js'

export const vkBoosterFeature:Feature={
 id:'vk-booster',title:'VK Booster',description:'История переписки, вложения и офлайн-просмотр',
 targets:['userscript','chromium'],requiredCapabilities:['page-dom','origin-storage','local-files'],
 match:url=>/^(vk\.ru|vk\.com)$/.test(url.hostname)&&url.pathname.startsWith('/im'),
 start(){installVkArchive()},
 open(){window.VKExport?.show()},
 stop(){window.VKExport?.destroy?.()}
}
