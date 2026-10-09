import {test,expect} from 'bun:test'
import {readFile} from 'node:fs/promises'
test('single shell style follows ChatGPT Booster semantic tokens rather than custom blue palette',async()=>{
 const css=await readFile(new URL('../../shell/src/styles.css',import.meta.url),'utf8')
 expect(css).toContain('--primary: oklch(')
 expect(css).toContain('.booster-launcher')
 expect(css).toContain('.booster-modal-backdrop')
 expect(css).toContain('.booster-settings-nav')
 expect(css).not.toContain('#315aa7')
})
