import {test,expect} from 'bun:test'
import {affectedModules} from './catalog'
import {hasRelevantChange} from './release-plan'
test('only Vk Archive and combiner rebuild when VK code changes',()=>expect(affectedModules(['modules/vk-booster/src/index.ts'])).toEqual(['vk-booster','all-in-one']))
test('changes to core force rebuilding every module',()=>expect(affectedModules(['packages/core/src/index.ts'])).toEqual(['vk-booster','proxy-switcher','all-in-one']))
test('shared archive selector changes rebuild consumers',()=>expect(affectedModules(['packages/archive/src/index.ts'])).toEqual(['vk-booster','proxy-switcher','all-in-one']))
test('proxy-only changes do not rebuild VK',()=>expect(affectedModules(['modules/proxy-switcher/src/index.ts'])).toEqual(['proxy-switcher']))
test('docs do not trigger rebuild',()=>expect(affectedModules(['docs/ARCHITECTURE.md'])).toEqual([]))
test('scoped release plan skips unchanged modules',()=>{
 expect(hasRelevantChange(['modules/proxy-switcher/src/x.ts'],['modules/vk-booster/','packages/'])).toBe(false)
 expect(hasRelevantChange(['packages/core/src/index.ts'],['modules/vk-booster/','packages/'])).toBe(true)
})
