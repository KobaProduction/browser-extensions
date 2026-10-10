import { isChatGptPage } from '@chatgpt-booster/core'
import ChatGptPanel from '@kobaproduction/module-chatgpt-booster/ui'
import { vkBoosterFeature } from '@kobaproduction/module-vk-booster'
import ArchivePanel from '@kobaproduction/module-vk-booster/ui'
import { createChatGptUserscriptFeature } from './chatgpt-booster'
import { bootstrapUserscript } from './runtime'

// Exactly one page runtime and one shared Control Center per eligible host.
if (isChatGptPage())
  bootstrapUserscript([createChatGptUserscriptFeature()], 'Koba Browser Tools', {
    'chatgpt-booster': ChatGptPanel,
  })
else if (vkBoosterFeature.match(new URL(location.href)))
  bootstrapUserscript([vkBoosterFeature], 'Koba Browser Tools', { 'vk-booster': ArchivePanel })
