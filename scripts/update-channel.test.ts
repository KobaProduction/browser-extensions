import { test, expect } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { manifest } from './catalog'
for (const id of ['vk-booster','all-in-one']){
  test(id+': separate stable Tampermonkey channel',async()=>{
    const raw=await readFile('dist/'+id+'/'+id+'.user.js','utf8')
    const data=await manifest(id)
    expect(raw).toContain('// @name         '+data.name)
    expect(raw).toContain('// @version      '+data.version)
    const stable='https://raw.githubusercontent.com/KobaProduction/browser-extensions/distribution/userscripts/'+id+'.user.js'
    expect(raw).toContain('// @updateURL    '+stable)
    expect(raw).toContain('// @downloadURL  '+stable)
    expect(raw).not.toContain('releases/latest')
  })
}
