import {readArchiveMedia} from '@kobaproduction/browser-archive'
/* VK media metadata mapping and byte downloader (provider-specific). */
const safe=s=>{
  const raw=String(s||'file').normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/^\.+/,'_').trim();
  let out='',n=0;for(const ch of raw){let m=new TextEncoder().encode(ch).length;if(n+m>150)break;out+=ch;n+=m;}
  return out||'file';
};
const ext=(s,fallback='bin')=>String(s||fallback).replace(/[^a-zA-Z0-9]/g,'').toLowerCase()||fallback;
const fileStem=(name,fallback)=>safe(name||fallback);
const join=(...x)=>x.join('/');
export function assets(m){
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
export async function download(a,{meta,dir,write,sleep}){
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
   const payload=await readArchiveMedia(response,{maxBytes:64*1048576,expectedBytes:v.size});
   const {bytes,size:n,sha256:hash,mime}=payload;
   const media=await dir(String(a.rootId),await dir('media'));
   let name=v.name,index=2;
   const occupied=new Set(Object.entries(meta.files).filter(([k,f])=>k!==a.key&&f.message_id===a.rootId&&f.status==='saved').map(([,f])=>f.name));
   while(occupied.has(name)){const i=v.name.lastIndexOf('.');name=i>0?v.name.slice(0,i)+' ('+index+++')'+v.name.slice(i):v.name+' ('+index+++')'}
   await write(name,bytes,media);
   Object.assign(result,{status:'saved',name,size:n,sha256:hash,
     path:join('media',String(a.rootId),name),mime});
   meta.files[a.key]=result;return 'saved';
  }catch{failures++}
  await sleep(300);
 }
 if(failures)result.status='failed';
 meta.files[a.key]=result;return result.status;
}
