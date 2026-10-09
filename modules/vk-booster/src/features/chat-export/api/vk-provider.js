/* VK-only API and authorization adapter. Browser credentials never leave this closure. */
export function createVkProvider(cfg,{sleep,refresh}){
let token='';
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
return {auth,history,api,hasToken:()=>Boolean(token)};
}
