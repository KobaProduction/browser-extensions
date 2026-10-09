/* VK Archive v2 — one standalone browser userscript; no external dependencies. */
export function installVkArchive() {
'use strict';
const VERSION='2.0.0', GLOBAL='VKExport';
if(globalThis[GLOBAL]?.version===VERSION)return;
const initialPeer=()=>Number(location.pathname.match(/\/im\/convo\/(\d+)/)?.[1])||0;
const cfg={peerId:initialPeer(),mode:'recent',limit:10,from:'',through:'',pageSize:50,delay:450,media:true};
let root=null,meta=null,rows=[],token='',busy=false,stopRequested=false,box=null;
let prog={phase:'Ожидание',done:0,total:0,newCount:0,downloaded:0,failed:0};
const ts=()=>new Date().toISOString(), sleep=ms=>globalThis.__VK_EXPORT_TEST_MODE?Promise.resolve():new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validDay=d=>!d||/^\d{4}-\d\d-\d\d$/.test(d)&&new Date(Date.parse(d+'T00:00:00+03:00')+10800000).toISOString().slice(0,10)===d;
const unixDay=d=>d?Math.floor(Date.parse(d+'T00:00:00+03:00')/1000):null;
const safe=s=>{
  const raw=String(s||'file').normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/^\.+/,'_').trim();
  let out='',n=0;for(const ch of raw){let m=new TextEncoder().encode(ch).length;if(n+m>150)break;out+=ch;n+=m;}
  return out||'file';
};
const ext=(s,fallback='bin')=>String(s||fallback).replace(/[^a-zA-Z0-9]/g,'').toLowerCase()||fallback;
const fileStem=(name,fallback)=>safe(name||fallback);
const join=(...x)=>x.join('/');
const known=()=>new Map(rows.map(m=>[m.id,m]));
const blank=()=>({schema:2,version:VERSION,peer_id:cfg.peerId,updated:ts(),total:0,checkpoint:null,files:{},runs:[],conversation:null});
const json=async(name)=>{try{return JSON.parse(await (await (await root.getFileHandle(name)).getFile()).text())}catch(e){if(e.name==='NotFoundError')return null;throw e}};
async function write(name,data,dir=root){
 const h=await dir.getFileHandle(name,{create:true}),w=await h.createWritable();
 try{await w.write(typeof data==='string'||data instanceof Uint8Array||data instanceof Blob?data:JSON.stringify(data,null,2)+'\n');await w.close();}
 catch(e){await w.abort().catch(()=>{});throw e;}
}
async function dir(name,parent=root){return parent.getDirectoryHandle(name,{create:true})}
const sorted=()=>rows.sort((a,b)=>a.date-b.date||a.id-b.id);
async function checkpoint(){
 sorted();meta.total=rows.length;meta.updated=ts();
 meta.lastMessageDate=rows.length?new Date(rows.at(-1).date*1000).toISOString():null;
 await write('messages.json',{schema:2,peer_id:cfg.peerId,messages:rows});
 await write('metadata.json',meta);
 refresh();
}
function status(){return {version:VERSION,folder:root?.name||null,busy,options:{...cfg},
 progress:{...prog},messages:rows.length,checkpoint:meta?.checkpoint||null};}
function configure(v={}){
 if(busy)throw Error('Заверши или приостанови выгрузку');
 let o={...cfg,...v};if(!['recent','incremental','backfill'].includes(o.mode))throw Error('Режим');
 if(!Number.isSafeInteger(o.limit)||o.limit<1||o.limit>100000)throw Error('Количество: 1–100000');
 if(!Number.isSafeInteger(o.pageSize)||o.pageSize<1||o.pageSize>100)throw Error('Пачка: 1–100');
 if(!Number.isSafeInteger(o.delay)||o.delay<300)throw Error('Пауза: от 300 мс');
 if(!validDay(o.from)||!validDay(o.through)||(o.from&&o.through&&o.from>o.through))throw Error('Диапазон дат');
 if(root&&o.peerId!==meta.peer_id)throw Error('Для другого диалога нужна отдельная папка');
 Object.assign(cfg,o);return status();
}
async function useFolder(handle){
 if(!cfg.peerId)throw Error('Открой диалог VK перед выбором папки');
 if(busy)throw Error('Выгрузка идёт');
 root=handle;const previous=await json('metadata.json');
 if(!previous){
  // v1 stores state.json and pages; reject before creating v2 files.
  try{await root.getFileHandle('state.json');root=null;throw Error('Обнаружен старый архив v1. Используй отдельную утилиту миграции.')}
  catch(e){if(e.name!=='NotFoundError')throw e}
  try{await root.getDirectoryHandle('pages');root=null;throw Error('Обнаружен старый каталог pages/. Сначала выполни миграцию.')}
  catch(e){if(e.name!=='NotFoundError')throw e}
 }
 if(previous && (previous.schema!==2||previous.peer_id!==cfg.peerId)){
  root=null;throw Error('Старая папка несовместима. Мигрируй её отдельной утилитой в новую папку.');
 }
 meta=previous||blank();const existing=await json('messages.json');
 if(existing && (existing.schema!==2||existing.peer_id!==cfg.peerId||!Array.isArray(existing.messages))){
  root=null;throw Error('Неверный формат messages.json');
 }
 rows=existing?.messages||[];sorted();
 if(!previous)await checkpoint();
 refresh();return status();
}
async function selectFolder(){
 if(!globalThis.showDirectoryPicker)throw Error('Нужен Chrome и HTTPS');
 // This must run synchronously from a real user button click.
 const h=await showDirectoryPicker({id:'vk-archive-v2',mode:'readwrite'});
 if(await h.requestPermission({mode:'readwrite'})!=='granted')throw Error('Нет разрешения на запись');
 return useFolder(h);
}
function vkTokens(){
 const result=[],seen=new Set();
 const add=v=>{if(typeof v==='string'&&v.length>=16&&v.length<4096&&!seen.has(v)){seen.add(v);result.push(v)}};
 const dive=(o,depth=0)=>{
  if(!o||typeof o!=='object'||depth>4)return;
  for(const [k,v]of Object.entries(o).slice(0,100)){
   if(/^(access_?token|vk_?access_?token|oauth_?token|token)$/i.test(k))add(v);
   else if(v&&typeof v==='object')dive(v,depth+1);
  }
 };
 for(const store of [globalThis.localStorage,globalThis.sessionStorage]){
  try{for(let i=0;i<Math.min(store?.length||0,400);i++){
   const k=store.key(i);if(!/auth|oauth|token|session|vk/i.test(k))continue;
   const v=store.getItem(k);if(!v||v.length>300000)continue;
   if(/token/i.test(k)&&!v.startsWith('{'))add(v);
   try{dive(JSON.parse(v))}catch{}
  }}catch{}
 }
 return result.slice(0,8);
}
async function api(method,p,attempt=0){
 const body=new URLSearchParams({...p,access_token:token});
 const resp=await fetch('https://web.api.vk.ru/method/'+method+'?v=5.289&client_id=6287487',
   {method:'POST',credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body,signal:AbortSignal.timeout(25000)});
 if(resp.status===429||resp.status>=500){if(attempt<2){await sleep(1000*(attempt+1));return api(method,p,attempt+1)}}
 if(!resp.ok)throw Error('VK HTTP '+resp.status);
 const out=await resp.json();if(out.error)throw Error('VK API '+out.error.error_code);
 return out.response;
}
async function auth(){
 if(token)return true;
 for(const t of vkTokens())try{
   token=t;const r=await api('messages.getHistory',{peer_id:cfg.peerId,count:1,offset:0,rev:0});
   if(Array.isArray(r?.items)){refresh();return true}
 }catch{}
 token='';
 // Reuse the already authenticated v1 browser object if present:
 if(globalThis.VKArchive?.state?.().authenticated&&globalThis.VKArchive.state().peer_id===cfg.peerId)return true;
 refresh();return false;
}
async function history(offset,count){
 if(token){const r=await api('messages.getHistory',{peer_id:cfg.peerId,count,offset,rev:0});
   if(!Array.isArray(r.items))throw Error('Неверный ответ истории');return r}
 const a=globalThis.VKArchive;if(!a?.state?.().authenticated)throw Error('Не найдена авторизация VK');
 const from='1970-01-01',through='2099-12-31';let chunk;
 try{chunk=a.getPart(from,through)}catch{}
 while((chunk?.next_offset||0)<offset+count&&!chunk?.complete){
  const prev=chunk?.next_offset||0;
  await a.captureRange({from,through,maxPages:1,pageSize:Math.min(100,count),delayMs:450});
  chunk=a.getPart(from,through);if(chunk.next_offset<=prev)break;
 }
 const all=[...(chunk?.messages||[])].sort((a,b)=>b.date-a.date||b.id-a.id);
 return {items:all.slice(offset,offset+count),count:chunk?.conversation_total||all.length};
}
function assets(m){
 const out=[];
 function descend(n,ctx,depth){
  if(!n||depth>8)return;
  (n.attachments||[]).forEach((att,i)=>{
   const t=att.type||'unknown',v=att[t]||{},key=[m.id,ctx,i,t].join(':');
   const choice=[];
   const add=(url,name,size=null)=>{if(typeof url==='string'&&/^https?:\/\//i.test(url))
     choice.push({url,name:safe(name),size});};
   if(t==='doc'&&(v.preview?.audio_msg||v.type===5)){
    const a=v.preview?.audio_msg||{};add(a.link_ogg,'Голосовое.ogg');add(a.link_mp3,'Голосовое.mp3');
    if(!choice.length)add(v.url,'Голосовое.'+ext(v.ext,'ogg'),v.size);
   }else if(t==='doc')add(v.url,fileStem(v.title,'Документ')+
     (String(v.title||'').toLowerCase().endsWith('.'+ext(v.ext))?'':'.'+ext(v.ext)),v.size);
   else if(t==='photo'){
    const s=[...(v.sizes||[])].filter(x=>x.url).sort((a,b)=>b.width*b.height-a.width*a.height)[0];
    add(s?.url,'Фото.'+ext(s?.url?.split('?')[0].match(/\.([a-z0-9]{3,4})$/i)?.[1],'jpg'));
   }else if(t==='audio_message'){add(v.link_ogg,'Голосовое.ogg');add(v.link_mp3,'Голосовое.mp3');}
   else if(t==='audio')add(v.url,'Аудио.mp3');
   else if(t==='graffiti')add(v.url,'Граффити.png');
   else if(t==='sticker')add((v.images_with_background||v.images||[]).at(-1)?.url,'Стикер.png');
   else if(t==='video'){
    const f=Object.entries(v.files||{}).filter(([k,u])=>/^mp4_\d+$/.test(k)&&typeof u==='string')
      .sort(([a],[b])=>parseInt(b.slice(4))-parseInt(a.slice(4)));
    add(f[0]?.[1],'Видео.mp4');
   }
   out.push({key,rootId:m.id,type:t,choices:choice,sourceId:n.id??null,context:ctx,
    external:t==='link' && /^https?:\/\//i.test(v.url||'')?v.url:null,
    transcript:t==='audio_message'?v.transcript||null:(t==='doc'?v.preview?.audio_msg?.transcript||null:null)});
  });
  if(n.reply_message)descend(n.reply_message,ctx+'.reply',depth+1);
  (n.fwd_messages||[]).forEach((f,i)=>descend(f,ctx+'.fwd'+i,depth+1));
 }
 descend(m,'root',0);return out;
}
async function download(a){
 const prev=meta.files[a.key];
 if(prev?.status==='saved'){
  try{const d=await dir(String(a.rootId),await dir('media'));
      const file=await (await d.getFileHandle(prev.name)).getFile();
      if(file.size===prev.size)return 'existing';}catch{}
 }
 const result={type:a.type,message_id:a.rootId,source_id:a.sourceId,status:'unavailable'};
 if(a.type==='link'){result.status='link';meta.files[a.key]=result;return 'link'}
 let failures=0;
 for(const v of a.choices){
  try{
   const response=await fetch(v.url,{method:'GET',credentials:'omit',signal:AbortSignal.timeout(60000)});
   if(!response.ok)throw Error('HTTP '+response.status);
   if((response.headers.get('content-type')||'').includes('text/html'))throw Error('Вместо файла HTML');
   const cap=64*1048576,reader=response.body?.getReader();if(!reader)throw Error('Нет файла');
   const chunks=[];let n=0;while(true){
    const {done,value}=await reader.read();if(done)break;
    n+=value.byteLength;if(n>cap){await reader.cancel();throw Error('Превышен размер 64 МБ')}
    chunks.push(value);
   }
   if(!n||(v.size!==null&&v.size!==n))throw Error('Размер не совпал');
   const bytes=new Uint8Array(n);let pos=0;for(const b of chunks){bytes.set(b,pos);pos+=b.length}
   const digest=await crypto.subtle.digest('SHA-256',bytes);
   const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
   const media=await dir(String(a.rootId),await dir('media'));
   let name=v.name,index=2;
   const occupied=new Set(Object.entries(meta.files).filter(([k,f])=>k!==a.key&&f.message_id===a.rootId&&f.status==='saved').map(([,f])=>f.name));
   while(occupied.has(name)){const i=v.name.lastIndexOf('.');name=i>0?v.name.slice(0,i)+' ('+index+++')'+v.name.slice(i):v.name+' ('+index+++')'}
   await write(name,bytes,media);
   Object.assign(result,{status:'saved',name,size:n,sha256:hash,
     path:join('media',String(a.rootId),name),mime:response.headers.get('content-type')||''});
   meta.files[a.key]=result;return 'saved';
  }catch{failures++}
  await sleep(300);
 }
 if(failures)result.status='failed';
 meta.files[a.key]=result;return result.status;
}
function attachmentView(m){
 return assets(m).map(a=>({type:a.type,key:a.key,media:meta.files[a.key]?.path||null,
  status:meta.files[a.key]?.status||'missing',external:a.external,transcript:a.transcript,
  name:meta.files[a.key]?.name||a.choices[0]?.name||a.type}));
}
// Local file:// pages cannot fetch JSON from neighbouring files without browser flags.
// Embed a *render-only* snapshot in index.html; messages.json remains authoritative.
function viewerHTML(){
 const snapshot=rows.map(m=>({id:m.id,author:m.from_id,out:!!m.out,date:m.date,text:m.text||'',
  media:attachmentView(m),reply:m.reply_message?{text:m.reply_message.text||'',from:m.reply_message.from_id}:null,
  forwards:(m.fwd_messages||[]).map(f=>({text:f.text||'',from:f.from_id}))}));
 const embed=JSON.stringify(snapshot).replace(/</g,'\\u003c');
 return `<!DOCTYPE html><html lang="ru"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VK Archive — диалог ${cfg.peerId}</title><style>
:root{color-scheme:light;font:15px/1.5 system-ui,sans-serif;background:#f3f5fa;color:#202838}
*{box-sizing:border-box}body{margin:0}.top{position:sticky;top:0;background:white;border-bottom:1px solid #d8deeb;padding:14px 18px;z-index:5}
h1{font-size:19px;margin:0 0 8px}.stats{color:#68758b;font-size:13px}.search{width:100%;max-width:630px;border:1px solid #c4cee1;border-radius:9px;padding:10px}
main{max-width:860px;margin:18px auto;padding:0 14px}.msg{background:white;border:1px solid #e1e5ed;border-radius:12px;margin:9px 0;padding:12px 16px;max-width:85%;overflow-wrap:anywhere}
.msg.mine{margin-left:auto;background:#e6f0ff}.by{font-size:12px;color:#65738b;margin-bottom:5px}.content{white-space:pre-wrap}
.file{display:block;margin-top:6px;color:#2154a5}.file img{display:block;max-width:min(100%,390px);max-height:360px;border-radius:8px}
.file audio{width:min(100%,380px)}.quote{border-left:3px solid #8da9d8;padding-left:10px;color:#5b6881;margin:7px 0}
</style><header class="top"><h1>Архив переписки VK</h1><div class="stats" id="stats"></div><input class="search" id="q" placeholder="Поиск по сообщениям…"></header><main id="list"></main>
<script>const entries=${embed};const list=document.getElementById('list'),q=document.getElementById('q'),stats=document.getElementById('stats');
function elt(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
function link(path){return path.split('/').map(encodeURIComponent).join('/')}
function render(){const filter=q.value.toLowerCase(),found=entries.filter(m=>!filter||m.text.toLowerCase().includes(filter));list.replaceChildren();
const fragment=document.createDocumentFragment();for(const m of found){const box=elt('article','msg'+(m.out?' mine':''));box.append(elt('div','by',(m.out?'Вы':'ID '+m.author)+' · '+new Date(m.date*1000).toLocaleString('ru-RU')));
if(m.reply)box.append(elt('div','quote','↪ '+(m.reply.text||'Ответ на сообщение')));
for(const f of m.forwards)box.append(elt('div','quote','Переслано: '+(f.text||'Вложение')));
const content=elt('div','content');
for(const part of m.text.split(/(https?:\\/\\/[^\\s]+)/g)){
 if(/^https?:\\/\\//.test(part)){
  const a=elt('a',null,part);a.href=part.replace(/[),.;!?]+$/,'');a.target='_blank';a.rel='noopener noreferrer';content.append(a);
 }else content.append(document.createTextNode(part));
}
box.append(content);for(const a of m.media){if(a.media){const tag=elt('a','file','📎 '+a.name);tag.href=link(a.media);tag.target='_blank';tag.rel='noopener noreferrer';
if(/\\.(jpe?g|png|webp|gif)$/i.test(a.name)){const img=elt('img');img.src=link(a.media);img.loading='lazy';tag.append(img)}
else if(/\\.(ogg|mp3|wav|m4a)$/i.test(a.name)){const audio=elt('audio');audio.controls=true;audio.preload='none';audio.src=link(a.media);box.append(audio)}
box.append(tag)}else if(a.external){const external=elt('a','file','🔗 '+a.external);external.href=a.external;external.target='_blank';external.rel='noopener noreferrer';box.append(external)}
else box.append(elt('div','by','Вложение ('+a.type+'): '+a.status));
if(a.transcript)box.append(elt('div','quote','Расшифровка: '+a.transcript))}
fragment.append(box)}
list.append(fragment);stats.textContent=found.length+' / '+entries.length+' сообщений · локальный архив'}
q.addEventListener('input',render);render();</script></html>`;
}
async function buildViewer(){sorted();await write('index.html',viewerHTML());return {messages:rows.length}}
function progress(phase,done,total,extra={}){prog={phase,done,total,...extra};refresh()}
function stop(){stopRequested=true;refresh()}
async function run(options={}){
 if(busy)throw Error('Выгрузка уже запущена');
 if(!cfg.peerId)throw Error('Открой диалог VK перед выгрузкой');
 if(!root)throw Error('Сначала выбери папку');
 const resume=options.resume===true;
 if(!resume)configure(options);
 if(!await auth())throw Error('Не удалось авторизовать VK API из хранилища');
 busy=true;stopRequested=false;
 if(resume && meta.checkpoint?.settings)Object.assign(cfg,meta.checkpoint.settings);
 const index=known(),lower=unixDay(cfg.from),upper=cfg.through?unixDay(cfg.through)+86400:null;
 const countTarget=cfg.limit;
 let cp=resume&&meta.checkpoint&&['paused','running'].includes(meta.checkpoint.status)
   ? meta.checkpoint : {
      mode:cfg.mode,target:countTarget,offset:cfg.mode==='backfill'?(meta.backfillOffset||0):0,
      matched:0,scanned:0,newCount:0,phase:'messages',fileCursor:0,status:'running',totalVK:null,started:ts(),settings:{...cfg}
    };
 meta.checkpoint=cp;cfg.mode=cp.mode;progress('Сообщения',cp.matched,cp.target);
 try{
  if(!meta.conversation && token){try{meta.conversation=await api('messages.getConversationsById',{peer_ids:String(cfg.peerId),extended:0})}catch{}}
  if(cp.phase==='messages'){
   while(!stopRequested && cp.matched<cp.target){
    const batch=await history(cp.offset,cfg.pageSize);
    cp.totalVK=batch.count;
    if(!batch.items.length||cp.offset>=batch.count){cp.phase='media';break}
    let consumed=0,end=false;
    for(const m of batch.items){
     consumed++;cp.scanned++;
     if(upper!==null&&m.date>=upper)continue; // skip newer than selected range
     if(lower!==null&&m.date<lower){end=true;break}
     const present=index.has(m.id);
     if(cp.mode==='incremental'&&present){end=true;break}
     if(cp.mode==='backfill'&&present)continue;
     cp.matched++;
     if(!present){index.set(m.id,m);cp.newCount++}
     if(cp.matched>=cp.target)break;
    }
    cp.offset+=consumed;
    rows=[...index.values()];sorted();
    if(cp.mode==='backfill')meta.backfillOffset=cp.offset;
    if(cp.mode==='incremental'){meta.backfillOffset=(meta.backfillOffset||0)+cp.newCount-(cp.shifted||0);cp.shifted=cp.newCount}
    if(cp.mode==='recent')meta.backfillOffset=Math.max(meta.backfillOffset||0,cp.offset);
    if(cp.mode==='incremental')meta.backfillOffset=(meta.backfillOffset||0)+Math.max(0,cp.newCount-(cp.shifted||0));
    cp.shifted=cp.newCount;
    cp.status='running';meta.checkpoint=cp;
    await checkpoint();progress('Сообщения',cp.matched,cp.target,{newCount:cp.newCount,scanned:cp.scanned});
    if(end||cp.offset>=batch.count||batch.items.length<cfg.pageSize){cp.phase='media';break}
    if(!stopRequested)await sleep(cfg.delay);
   }
   if(cp.matched>=cp.target)cp.phase='media';
  }
  if(stopRequested){cp.status='paused';await checkpoint();return {paused:true,progress:status().progress}}
  if(cp.phase==='media'){
   const queue=cfg.media?rows.flatMap(assets).filter(a=>a.type!=='link'):[];
   progress('Файлы',cp.fileCursor,queue.length,{newCount:cp.newCount});
   for(let i=cp.fileCursor;i<queue.length;i++){
    if(stopRequested)break;
    const outcome=await download(queue[i]);
    cp.fileCursor=i+1;meta.checkpoint=cp;
    await write('metadata.json',meta); // file-by-file resume; messages are not re-written
    const vals=Object.values(meta.files);
    progress('Файлы',cp.fileCursor,queue.length,{downloaded:vals.filter(f=>f.status==='saved').length,
      failed:vals.filter(f=>f.status==='failed').length,newCount:cp.newCount});
    if(!stopRequested && outcome!=='existing')await sleep(250);
   }
  }
  if(stopRequested){cp.status='paused';await checkpoint();return {paused:true,progress:status().progress}}
  cp.status='done';cp.phase='done';cp.finished=ts();meta.checkpoint=cp;
  meta.runs.push({mode:cp.mode,target:cp.target,matched:cp.matched,newCount:cp.newCount,finished:ts()});
  if(meta.runs.length>30)meta.runs=meta.runs.slice(-30);
  await checkpoint();await buildViewer();
  progress('Готово',cp.target,cp.target,{newCount:cp.newCount,downloaded:Object.values(meta.files).filter(f=>f.status==='saved').length});
  return {matched:cp.matched,newCount:cp.newCount,saved:rows.length,files:prog.downloaded,folder:root.name};
 }catch(e){
   cp.status='paused';cp.error=String(e.message||e).slice(0,180);
   try{await checkpoint()}catch{}progress('Ошибка',cp.matched,cp.target,{error:cp.error});
   throw e;
 }finally{busy=false;refresh()}
}
function refresh(){
 if(!box)return;
 const $=s=>box.querySelector(s);
 const ready=root?'Папка: '+root.name:'Выбери папку архива';
 $('#folder-name').textContent=ready;
 $('#state').textContent=prog.error||prog.phase;
 const pc=prog.total?Math.min(100,Math.floor(prog.done/prog.total*100)):prog.phase==='Готово'?100:0;
 $('#percent').textContent=pc+'%';
 $('#bar').style.width=pc+'%';
 $('#counts').textContent=prog.done+' / '+prog.total+(prog.newCount!==undefined?' · новых '+prog.newCount:'')+
  (prog.downloaded!==undefined?' · файлов '+prog.downloaded:'')+
  (prog.failed?' · ошибок '+prog.failed:'');
 $('#run').disabled=busy||!root;
 $('#stop').disabled=!busy;
 $('#resume').disabled=busy||!root||meta?.checkpoint?.status!=='paused';
 $('#summary').textContent='Сохранено сообщений: '+rows.length+' · файлов: '+Object.values(meta?.files||{}).filter(x=>x.status==='saved').length;
}
function show(){
 if(!root && !busy){const p=initialPeer();if(p!==cfg.peerId)cfg.peerId=p}
 if(!box)mount();
 if(box){box.hidden=false;box.querySelector('#dialog').textContent=cfg.peerId?'Диалог '+cfg.peerId:'Сначала открой диалог VK';refresh()}
}
function hide(){if(box)box.hidden=true}
function mount(){
 if(!document.body||box)return;
 const div=document.createElement('section');
 div.id='vk-archive-v2';
 div.style.cssText='position:fixed;z-index:2147483647;right:16px;top:55px;width:min(440px,calc(100vw - 32px));max-height:88vh;overflow:auto;font:14px system-ui,sans-serif;color:#202a3c;background:white;border:1px solid #d7e0f0;box-shadow:0 14px 50px #0004;border-radius:16px;padding:20px';
 div.innerHTML=`<style>#vk-archive-v2 *{box-sizing:border-box}#vk-archive-v2 button{border:0;border-radius:8px;padding:10px 13px;background:#e7edfa;color:#264479;cursor:pointer;font:inherit}
#vk-archive-v2 button.main{background:#315cad;color:white}#vk-archive-v2 button:disabled{opacity:.45;cursor:default}
#vk-archive-v2 label{display:flex;flex-direction:column;gap:5px;color:#647084;font-size:12px}#vk-archive-v2 input,#vk-archive-v2 select{border:1px solid #cbd5e5;border-radius:8px;padding:9px;color:#16233c;background:white;font:inherit;width:100%}
#vk-archive-v2 .pair{display:grid;grid-template-columns:1fr 110px;gap:10px;margin:14px 0}#vk-archive-v2 .buttons{display:flex;gap:8px;flex-wrap:wrap}
#vk-archive-v2 .dim{color:#647084;font-size:12px}#vk-archive-v2 .track{height:11px;border-radius:20px;background:#e9edf5;overflow:hidden}
#vk-archive-v2 #bar{height:100%;background:#315cad;width:0;transition:width .18s}#vk-archive-v2 details{border-top:1px solid #e4e9f1;padding-top:12px;margin-top:14px}
#vk-archive-v2[hidden]{display:none}</style>
<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:19px">VK Archive</b><button id="hide">Закрыть</button></div>
<div class="dim" id="dialog"></div><p><button id="folder">Выбрать папку</button> <span id="folder-name" class="dim">Не выбрана</span></p>
<div class="pair"><label>Что выгружать<select id="mode"><option value="recent">Последние N сообщений</option><option value="incremental">Только новые</option><option value="backfill">Продолжить историю</option></select></label><label>Количество<input id="limit" type="number" min="1" max="100000" value="10"></label></div>
<div class="buttons"><button id="run" class="main">Начать</button><button id="stop">Пауза</button><button id="resume">Продолжить</button></div>
<div style="margin:16px 0 7px;display:flex;justify-content:space-between"><b id="state">Ожидание</b><b id="percent">0%</b></div>
<div class="track"><div id="bar"></div></div><p class="dim" id="counts">0 / 0</p><p class="dim" id="summary"></p>
<details><summary style="cursor:pointer">Дополнительные настройки</summary><div class="pair" style="grid-template-columns:1fr 1fr"><label>С даты<input id="from" type="date"></label><label>По дату<input id="through" type="date"></label><label>Сообщений за запрос<input id="size" type="number" value="50" min="1" max="100"></label><label>Пауза, мс<input id="delay" type="number" value="450" min="300"></label></div><label><input id="media" type="checkbox" checked style="width:auto">Скачивать медиафайлы</label></details>
<div id="error" style="color:#b42332;margin-top:9px;white-space:pre-wrap"></div><p class="dim">Архив: metadata.json · messages.json · index.html · media/</p>`;
 document.body.append(div);box=div;box.hidden=true;
 const $=id=>box.querySelector('#'+id);
 $('hide').onclick=hide;
 $('folder').onclick=()=>{selectFolder().catch(e=>{$('error').textContent=e.message});};
 $('stop').onclick=stop;
 $('run').onclick=()=>execute(false);
 $('resume').onclick=()=>execute(true);
 async function execute(resume){
  $('error').textContent='';
  try{
   const v=resume?{resume:true}:{mode:$('mode').value,limit:Number($('limit').value),from:$('from').value,
      through:$('through').value,pageSize:Number($('size').value),delay:Number($('delay').value),media:$('media').checked};
   await run(v);
  }catch(e){$('error').textContent=String(e.message||e).slice(0,250)}
  refresh();
 }
 refresh();
}
const apiObject={version:VERSION,configure,selectFolder,useFolder,run,resume:()=>run({resume:true}),stop,status,show,hide,buildViewer,getMessages:()=>[...rows],destroy(){box?.remove();box=null;if(globalThis[GLOBAL]===apiObject)delete globalThis[GLOBAL]}};
globalThis[GLOBAL]=Object.freeze(apiObject);
// Entry points live in @kobaproduction/browser-ui and target adapters.
if(!globalThis.__VK_EXPORT_TEST_MODE){
 if(document.body)mount();else document.addEventListener('DOMContentLoaded',mount,{once:true});
}
}
