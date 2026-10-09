import {selectArchivePage} from '@kobaproduction/browser-archive'
import {createArchiveFiles} from '@kobaproduction/browser-adapters'
import {viewerHTML} from './offline-viewer.js'
import {createVkProvider} from '../api/vk-provider.js'
import {assets,download as downloadVkAsset} from '../api/vk-media.js'
/* VK Booster v2 — one standalone browser userscript; no external dependencies. */
export function installVkArchive() {
'use strict';
const VERSION='2.2.0', GLOBAL='VKExport';
if(globalThis[GLOBAL]?.version===VERSION)return;
const initialPeer=()=>Number(location.pathname.match(/\/im\/convo\/(\d+)/)?.[1])||0;
const cfg={peerId:initialPeer(),mode:'recent',limit:10,from:'',through:'',pageSize:50,delay:450,media:true};
let root=null,meta=null,rows=[],busy=false,stopRequested=false;
let prog={phase:'Ожидание',done:0,total:0,newCount:0,downloaded:0,failed:0};
const subscribers=new Set();
let uiError='';
const ts=()=>new Date().toISOString(), sleep=ms=>globalThis.__VK_EXPORT_TEST_MODE?Promise.resolve():new Promise(r=>setTimeout(r,ms));
const validDay=d=>!d||/^\d{4}-\d\d-\d\d$/.test(d)&&new Date(Date.parse(d+'T00:00:00+03:00')+10800000).toISOString().slice(0,10)===d;
const unixDay=d=>d?Math.floor(Date.parse(d+'T00:00:00+03:00')/1000):null;
const known=()=>new Map(rows.map(m=>[m.id,m]));
const blank=()=>({schema:2,version:VERSION,peer_id:cfg.peerId,updated:ts(),total:0,checkpoint:null,files:{},runs:[],conversation:null});
const {json,write,dir}=createArchiveFiles(()=>root);
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
const vk=createVkProvider(cfg,{sleep,refresh});
const auth=()=>vk.auth();
const history=(offset,count)=>vk.history(offset,count);
const api=(method,p)=>vk.api(method,p);
const download=a=>downloadVkAsset(a,{meta,dir,write,sleep});
function attachmentView(m){
 return assets(m).map(a=>({type:a.type,key:a.key,media:meta.files[a.key]?.path||null,
  status:meta.files[a.key]?.status||'missing',external:a.external,transcript:a.transcript,
  name:meta.files[a.key]?.name||a.choices[0]?.name||a.type}));
}
// Local file:// pages cannot fetch JSON from neighbouring files without browser flags.
// Embed a *render-only* snapshot in index.html; messages.json remains authoritative.
async function buildViewer(){sorted();await write('index.html',viewerHTML(rows,cfg.peerId,attachmentView));return {messages:rows.length}}
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
 const index=known(),identities=new Set([...index.keys()].map(String));
 const lower=unixDay(cfg.from),upper=cfg.through?unixDay(cfg.through)+86400:null;
 const countTarget=cfg.limit;
 let cp=resume&&meta.checkpoint&&['paused','running'].includes(meta.checkpoint.status)
   ? meta.checkpoint : {
      mode:cfg.mode,target:countTarget,offset:cfg.mode==='backfill'?(meta.backfillOffset||0):0,
      matched:0,scanned:0,newCount:0,phase:'messages',fileCursor:0,status:'running',totalVK:null,started:ts(),settings:{...cfg}
    };
 meta.checkpoint=cp;cfg.mode=cp.mode;progress('Сообщения',cp.matched,cp.target);
 try{
  if(!meta.conversation && vk.hasToken()){try{meta.conversation=await api('messages.getConversationsById',{peer_ids:String(cfg.peerId),extended:0})}catch{}}
  if(cp.phase==='messages'){
   while(!stopRequested && cp.matched<cp.target){
    const batch=await history(cp.offset,cfg.pageSize);
    cp.totalVK=batch.count;
    if(!batch.items.length||cp.offset>=batch.count){cp.phase='media';break}
    const selection=selectArchivePage({
      mode:cp.mode,records:batch.items,knownKeys:identities,
      keyOf:m=>String(m.id),timestampOf:m=>m.date,
      fromInclusive:lower,toExclusive:upper,remaining:cp.target-cp.matched
    });
    cp.scanned+=selection.consumed;
    cp.matched+=selection.matched;
    for(const item of selection.added){index.set(item.id,item);identities.add(String(item.id));cp.newCount++}
    cp.offset+=selection.consumed;
    rows=[...index.values()];sorted();
    if(cp.mode==='backfill')meta.backfillOffset=cp.offset;
    if(cp.mode==='incremental')meta.backfillOffset=(meta.backfillOffset||0)+cp.newCount-(cp.shifted||0);
    if(cp.mode==='recent')meta.backfillOffset=Math.max(meta.backfillOffset||0,cp.offset);
    cp.shifted=cp.newCount;
    cp.status='running';meta.checkpoint=cp;
    await checkpoint();progress('Сообщения',cp.matched,cp.target,{newCount:cp.newCount,scanned:cp.scanned});
    if(selection.boundaryReached||cp.offset>=batch.count||batch.items.length<cfg.pageSize){cp.phase='media';break}
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
 const snapshot=status();
 for(const listener of subscribers)try{listener(snapshot)}catch{}
}
function subscribe(listener){subscribers.add(listener);listener(status());return()=>subscribers.delete(listener)}
function show(){window.dispatchEvent(new CustomEvent('koba:open-feature',{detail:{id:'vk-booster'}}))}
function hide(){/* Single control-center shell owns visibility. */}
const apiObject={version:VERSION,configure,selectFolder,useFolder,run,resume:()=>run({resume:true}),stop,status,show,hide,subscribe,buildViewer,getMessages:()=>[...rows],destroy(){subscribers.clear();if(globalThis[GLOBAL]===apiObject)delete globalThis[GLOBAL]}};
globalThis[GLOBAL]=Object.freeze(apiObject);
// Entry points live in @kobaproduction/browser-ui and target adapters.

}
