import {test,expect,beforeAll,afterAll} from 'bun:test';
import {installVkArchive} from './archive-runtime.js';
class MockFile{
 constructor(){this.bytes=new Uint8Array(0);this.kind='file'}
 async getFile(){const b=this.bytes;return {size:b.length,text:async()=>new TextDecoder().decode(b),arrayBuffer:async()=>b.slice().buffer}}
 async createWritable(){const f=this;let pending=null;return {async write(data){pending=typeof data==='string'?new TextEncoder().encode(data):data instanceof Uint8Array?data:new Uint8Array(await data.arrayBuffer())},async close(){f.bytes=pending},async abort(){}}}
}
class MockDir{
 constructor(name){this.name=name;this.kind='directory';this.files=new Map;this.dirs=new Map}
 async getFileHandle(name,opt={}){if(!this.files.has(name)){if(!opt.create){const e=new Error('Missing');e.name='NotFoundError';throw e}this.files.set(name,new MockFile)}return this.files.get(name)}
 async getDirectoryHandle(name,opt={}){if(!this.dirs.has(name)){if(!opt.create){const e=new Error('Missing');e.name='NotFoundError';throw e}this.dirs.set(name,new MockDir(name))}return this.dirs.get(name)}
}

const save={document:globalThis.document,location:globalThis.location,localStorage:globalThis.localStorage,sessionStorage:globalThis.sessionStorage,fetch:globalThis.fetch,flag:globalThis.__VK_EXPORT_TEST_MODE};
globalThis.__VK_EXPORT_TEST_MODE=true;
globalThis.document={};globalThis.location={pathname:'/im/convo/7654321'};
const peer=7654321,tok='test-origin-token-123456789';
const all=Array.from({length:3100},(_,i)=>({id:3100-i,date:1791500000-i*500,from_id: i%2?peer:123,peer_id:peer,out:i%2,text:i===5?'</script><img src=x onerror=alert(1)> https://example.com/paper':'Message '+(3100-i),attachments:[]}));
const originalName='Исходный_документ.pdf';
const bytes=new TextEncoder().encode('%PDF-1.7\nReal binary content\n%%EOF');
all[3].attachments=[{type:'doc',doc:{id:45,owner_id:12,url:'https://cdn.mock/original.pdf',title:originalName,ext:'pdf',size:bytes.length}}];
all[9].attachments=[{type:'audio_message',audio_message:{link_ogg:'https://cdn.mock/voice.ogg',duration:3,transcript:'Проверочное аудио'}}];
all[11].attachments=[{type:'link',link:{url:'https://example.org/docs',title:'Документы'}}];
const ogg=new TextEncoder().encode('OggS-synthetic-audio');
const stores={length:1,key:()=> 'vk_auth',getItem:()=>JSON.stringify({access_token:tok})};
globalThis.localStorage=stores;globalThis.sessionStorage={length:0,key:()=>null,getItem:()=>null};
let apiCalls=0,mediaCalls=0,pauseAfter=0;
globalThis.fetch=async (url,o)=>{
 if(String(url).includes('/method/')){
  const p=new URLSearchParams(o.body);expect(p.get('access_token')).toBe(tok);
  apiCalls++;
  if(pauseAfter && apiCalls===pauseAfter){queueMicrotask(()=>globalThis.VKExport.stop())}
  const offset=Number(p.get('offset')),count=Number(p.get('count'));
  return new Response(JSON.stringify({response:{items:all.slice(offset,offset+count),count:all.length}}),{status:200});
 }
 mediaCalls++;return new Response(String(url).endsWith('.ogg')?ogg:bytes,{status:200,headers:{'content-type':String(url).endsWith('.ogg')?'audio/ogg':'application/pdf'}});
};
const reload=()=>{delete globalThis.VKExport;installVkArchive();return globalThis.VKExport};
let a,folder;
beforeAll(async()=>{a=reload();folder=new MockDir('VK_Archive_v2');await a.useFolder(folder)});
afterAll(()=>{Object.assign(globalThis,{document:save.document,location:save.location,localStorage:save.localStorage,sessionStorage:save.sessionStorage,fetch:save.fetch,__VK_EXPORT_TEST_MODE:save.flag});delete globalThis.VKExport});
const read=async name=>JSON.parse(await (await folder.getFileHandle(name)).getFile().then(f=>f.text()));
test('exact N=3000 even if previously saved, and only two JSON outputs',async()=>{
 const r=await a.run({mode:'recent',limit:3000,pageSize:50,media:false,delay:300});
 expect(r.matched).toBe(3000);expect(r.newCount).toBe(3000);
 const m=await read('messages.json');expect(m.messages).toHaveLength(3000);
 const md=await read('metadata.json');expect(md.total).toBe(3000);
 expect(md.checkpoint.status).toBe('done');
 expect([...folder.files.keys()].sort()).toEqual(['index.html','messages.json','metadata.json']);
 expect(a.status().progress.done).toBe(3000);
});
test('repeat last N does not terminate on first existing ID or create duplicates',async()=>{
 const before=mediaCalls;
 const r=await a.run({mode:'recent',limit:3000,pageSize:100,media:false,delay:300});
 expect(r.matched).toBe(3000);expect(r.newCount).toBe(0);
 expect((await read('messages.json')).messages).toHaveLength(3000);
 expect(mediaCalls).toBe(before);
});
test('incremental stops at first known message and adds newest ID',async()=>{
 all.unshift({id:3101,date:1791500100,peer_id:peer,from_id:123,text:'Newest',attachments:[]});
 const r=await a.run({mode:'incremental',limit:200,pageSize:50,media:false,delay:300});
 expect(r.newCount).toBe(1);
 expect((await read('messages.json')).messages).toHaveLength(3001);
});
test('pause and resume backfill without losing checkpoint',async()=>{
 pauseAfter=apiCalls+2;
 const r=await a.run({mode:'backfill',limit:80,pageSize:20,media:false,delay:300});
 expect(r.paused).toBe(true);
 expect((await read('metadata.json')).checkpoint.status).toBe('paused');
 pauseAfter=0;
 const r2=await a.resume();
 expect(r2.matched).toBe(80);
 expect((await read('metadata.json')).checkpoint.status).toBe('done');
});
test('original names, offline HTML, media path and hashes',async()=>{
 const r=await a.run({mode:'recent',limit:12,pageSize:20,media:true,delay:300});
 expect(r.matched).toBe(12);
 const md=await read('metadata.json');
 const saved=Object.values(md.files).filter(x=>x.status==='saved');
 expect(saved.length).toBe(2);
 expect(saved.some(x=>x.name===originalName)).toBe(true);
 expect(saved.every(x=>/^[0-9a-f]{64}$/.test(x.sha256))).toBe(true);
 expect(md.files[Object.keys(md.files).find(x=>x.includes('audio_message'))].name).toBe('Голосовое.ogg');
 const html=await (await folder.getFileHandle('index.html')).getFile().then(f=>f.text());
 expect(html).toContain('target=\'_blank\'');
 expect(html).toContain('Поиск по сообщениям');
 expect(html).toContain('media/');
 expect(html).toContain('https://example.org/docs');
 expect(html).toContain('Проверочное аудио');
 expect(html).not.toContain('</script><img src=x');
 const block=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 expect(block).toBeTruthy();
 expect(()=>new Function(block)).not.toThrow();
 expect(block).toContain('target=');
});
test('reconnect folder after simulated reload reads only two files',async()=>{
 const old=folder;
 a=reload();await a.useFolder(old);
 expect(a.status().messages).toBeGreaterThanOrEqual(3000);
 expect(a.status().checkpoint.status).toBe('done');
});
test('legacy v1 folder rejected without deleting its contents',async()=>{
 const d=new MockDir('old');
 const f=await d.getFileHandle('metadata.json',{create:true}),w=await f.createWritable();
 await w.write(JSON.stringify({schema:1,peer_id:peer}));await w.close();
 await expect(a.useFolder(d)).rejects.toThrow();
});
test('date filters include the full through day in Moscow timezone',async()=>{
 const backup=[...all];
 const time=s=>Math.floor(Date.parse(s)/1000);
 const items=[
  {id:5,date:time('2026-10-09T21:00:00Z'),text:'next day excluded'},  // Moscow 2026-10-10
  {id:4,date:time('2026-10-09T20:59:00Z'),text:'through 23:59'},    // Moscow 2026-10-09
  {id:3,date:time('2026-10-07T21:00:00Z'),text:'from midnight'},   // Moscow 2026-10-08
  {id:2,date:time('2026-10-07T20:59:00Z'),text:'before excluded'},
 ].map(m=>({...m,peer_id:peer,from_id:123,attachments:[]}));
 all.splice(0,all.length,...items);
 try{
  a=reload();const f=new MockDir('date-filter');await a.useFolder(f);
  const r=await a.run({mode:'recent',limit:10,from:'2026-10-08',through:'2026-10-09',pageSize:4,delay:300,media:false});
  expect(r.matched).toBe(2);expect(r.saved).toBe(2);
  expect((await (await f.getFileHandle('messages.json')).getFile().then(x=>x.text())).includes('"id": 4')).toBe(true);
 }finally{all.splice(0,all.length,...backup)}
});

test('v1 folder with state.json and pages is rejected before v2 files are created',async()=>{
 a=reload();
 const old=new MockDir('original-v1');
 await old.getFileHandle('state.json',{create:true});
 await old.getDirectoryHandle('pages',{create:true});
 await expect(a.useFolder(old)).rejects.toThrow('старый архив v1');
 expect([...old.files.keys()]).toEqual(['state.json']);
 expect([...old.dirs.keys()]).toEqual(['pages']);
});

test('rejecting malformed new folder preserves previously selected archive',async()=>{
 a=reload();await a.useFolder(folder);
 const before=a.status();
 const invalid=new MockDir('bad-metadata');
 const writer=await (await invalid.getFileHandle('metadata.json',{create:true})).createWritable();
 await writer.write('{not-json');await writer.close();
 await expect(a.useFolder(invalid)).rejects.toThrow();
 expect(a.status().folder).toBe(before.folder);
 expect(a.status().messages).toBe(before.messages);
 expect([...invalid.files.keys()]).toEqual(['metadata.json']);
 const result=await a.run({mode:'recent',limit:2,pageSize:2,media:false,delay:300});
 expect(result.saved).toBe(before.messages);
});

test('failed metadata commit does not advance visible cursor or silently keep unsaved rows',async()=>{
 a=reload();
 const scratch=new MockDir('write-failure');
 await a.useFolder(scratch);
 const md=await scratch.getFileHandle('metadata.json');
 const originalWritable=md.createWritable.bind(md);
 let failOnce=true;
 md.createWritable=async()=>{
  const writer=await originalWritable();
  return {...writer,async write(data){
   if(failOnce){failOnce=false;throw Error('synthetic metadata disk failure')}
   await writer.write(data);
  }}
 };
 await expect(a.run({mode:'recent',limit:12,pageSize:12,media:false,delay:300})).rejects.toThrow('synthetic metadata disk failure');
 expect(a.status().messages).toBe(0);
 expect((await (await scratch.getFileHandle('messages.json')).getFile().then(f=>f.text())).includes('"messages": []')).toBe(true);
 const cp=(await (await scratch.getFileHandle('metadata.json')).getFile().then(f=>f.text()));
 expect(JSON.parse(cp).checkpoint.offset).toBe(0);
 const resumed=await a.resume();
 expect(resumed.saved).toBe(12);
});
