import ArchivePanel from '@kobaproduction/module-vk-booster/ui'
import {vkBoosterFeature} from '@kobaproduction/module-vk-booster'
import {bootstrapUserscript} from './runtime'
bootstrapUserscript([vkBoosterFeature], 'VK Booster',{'vk-booster':ArchivePanel})
