import {vkBoosterFeature} from '@kobaproduction/module-vk-booster'
import {bootstrapUserscript} from './runtime'
// As new modules become production-ready, add them to this registry; modules
// with privileged-only permissions must never run in the userscript.
bootstrapUserscript([vkBoosterFeature], 'Koba Browser Tools')
