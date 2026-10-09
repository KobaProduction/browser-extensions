import {test,expect} from 'bun:test'
import {readFile} from 'node:fs/promises'
const read=async(name:string)=>readFile(new URL(name,import.meta.url),'utf8')
test('shared launcher uses the ChatGPT Booster draggable overlay contract',async()=>{
 const source=await read('./Overlay.vue')
 expect(source).toContain('onPointerDown')
 expect(source).toContain('onPointerMove')
 expect(source).toContain('savePosition')
 expect(source).toContain('ModalSurface')
 expect(source).toContain('surface-class="booster-modal-surface"')
 const modal=await read('../../ui/src/components/booster/ModalSurface.vue')
 expect(modal).toContain('booster-modal-backdrop')
 expect(modal).toContain('aria-modal="true"')
 expect(source).toContain('ControlCenterPanel')
})
test('central shell allows supplied feature views without provider-specific imports',async()=>{
 const source=await read('./ControlCenterPanel.vue')
 expect(source).toContain('views:Record<string,Component>')
 expect(source).toContain('booster-settings-nav')
 expect(source).not.toContain('VKArchive')
 expect(source).not.toContain('chatgpt.com')
})
