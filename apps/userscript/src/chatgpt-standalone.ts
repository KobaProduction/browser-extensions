import { isChatGptPage } from '@chatgpt-booster/core'
import ChatGptPanel from '@kobaproduction/module-chatgpt-booster/ui'
import { createChatGptUserscriptFeature } from './chatgpt-booster'
import { bootstrapUserscript } from './runtime'

if (isChatGptPage())
  bootstrapUserscript((telemetry) => [createChatGptUserscriptFeature(telemetry)], 'ChatGPT Booster', {
    'chatgpt-booster': ChatGptPanel,
  })
