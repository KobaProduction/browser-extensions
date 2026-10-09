import {test,expect} from 'bun:test'
import {FeatureRuntime,FeatureSettings,defaultCapabilities,type Feature} from './index'
test('feature runtime isolates exceptions and supports enable/disable',async()=>{
 const memory=new Map<string,boolean>();const settings=new FeatureSettings({async get(k){return memory.get(k)},async set(k,v){memory.set(k,v)}})
 let opens=0,starts=0,stops=0
 const good:Feature={id:'working',title:'Working',description:'fine',match:()=>true,targets:['userscript'],requiredCapabilities:['page-dom'],start(){starts++},open(){opens++},stop(){stops++}}
 const bad:Feature={id:'broken',title:'Broken',description:'fails',match:()=>true,targets:['userscript'],requiredCapabilities:[],start(){throw Error('bad module')}}
 const runtime=new FeatureRuntime([good,bad],{target:'userscript',url:new URL('https://vk.ru/im'),capabilities:defaultCapabilities('userscript'),settings});
 await runtime.start();expect(runtime.list().map(x=>x.state)).toEqual(['active','failed']);await runtime.open('working');expect(opens).toBe(1)
 await runtime.setEnabled('working',false);expect(runtime.list()[0]?.state).toBe('disabled');expect(stops).toBe(1)
 await runtime.setEnabled('working',true);expect(starts).toBe(2)
});
test('unsupported browser capability is not enabled in Tampermonkey',async()=>{
 const settings=new FeatureSettings({async get(){return true},async set(){}});
 const proxy:Feature={id:'proxy',title:'Proxy',description:'',match:()=>true,targets:['chromium'],requiredCapabilities:['proxy-settings'],start(){throw Error('should not run')}};
 const runtime=new FeatureRuntime([proxy],{target:'userscript',url:new URL('https://example.org'),capabilities:defaultCapabilities('userscript'),settings});await runtime.start();expect(runtime.list()[0]?.state).toBe('unsupported');
});
