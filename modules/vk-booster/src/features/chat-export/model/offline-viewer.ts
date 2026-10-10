import type { VkAttachmentView, VkMessage } from './types'
/* Offline HTML viewer: render-only, never fetches sibling JSON over file://. */
export function viewerHTML(
  rows: readonly VkMessage[],
  peerId: number,
  attachmentView: (message: VkMessage) => VkAttachmentView[],
): string {
  const snapshot = rows.map((m) => ({
    id: m.id,
    author: m.from_id,
    out: !!m.out,
    date: m.date,
    text: m.text || '',
    media: attachmentView(m),
    reply: m.reply_message ? { text: m.reply_message.text || '', from: m.reply_message.from_id } : null,
    forwards: (m.fwd_messages || []).map((f) => ({ text: f.text || '', from: f.from_id })),
  }))
  const embed = JSON.stringify(snapshot).replace(/</g, '\\u003c')
  return `<!DOCTYPE html><html lang="ru"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VK Booster — диалог ${peerId}</title><style>
:root{color-scheme:light;font:15px/1.5 system-ui,sans-serif;background:#f3f5fa;color:#202838}
*{box-sizing:border-box}body{margin:0}.top{position:sticky;top:0;background:white;border-bottom:1px solid #d8deeb;padding:14px 18px;z-index:5}
h1{font-size:19px;margin:0 0 8px}.stats{color:#68758b;font-size:13px}.search{width:100%;max-width:630px;border:1px solid #c4cee1;border-radius:9px;padding:10px}
main{max-width:860px;margin:18px auto;padding:0 14px}.msg{background:white;border:1px solid #e1e5ed;border-radius:12px;margin:9px 0;padding:12px 16px;max-width:85%;overflow-wrap:anywhere}
.msg.mine{margin-left:auto;background:#e6f0ff}.by{font-size:12px;color:#65738b;margin-bottom:5px}.content{white-space:pre-wrap}
.file{display:block;margin-top:6px;color:#2154a5}.file img{display:block;max-width:min(100%,390px);max-height:360px;border-radius:8px}
.file audio{width:min(100%,380px)}.quote{border-left:3px solid #8da9d8;padding-left:10px;color:#5b6881;margin:7px 0}
</style><header class="top"><h1>VK Booster · Архив переписки</h1><div class="stats" id="stats"></div><input class="search" id="q" placeholder="Поиск по сообщениям…"></header><main id="list"></main>
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
q.addEventListener('input',render);render();</script></html>`
}
