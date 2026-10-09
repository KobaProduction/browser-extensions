import type {FeatureRuntime, FeatureStatus} from '@kobaproduction/browser-core'
const CSS=`
:host{all:initial;font:14px/1.5 system-ui,-apple-system,sans-serif;color:#182437;--bg:#fff;--muted:#657187;--border:#dce3ef;--accent:#365ba2}
*{box-sizing:border-box}
.shell{position:fixed;right:18px;bottom:18px;z-index:2147483647;font:inherit;pointer-events:auto}
.launch{border:1px solid var(--border);border-radius:16px;background:var(--accent);color:#fff;padding:12px;box-shadow:0 10px 30px #0003;cursor:pointer}
.panel{width:min(410px,calc(100vw - 32px));border:1px solid var(--border);background:var(--bg);box-shadow:0 22px 55px #0004;border-radius:18px;padding:18px;margin-bottom:10px}
.head{display:flex;align-items:center;justify-content:space-between;gap:10px}.title{font-size:17px;font-weight:700}
.sub{font-size:12px;color:var(--muted);margin:6px 0 14px}.feature{padding:12px 0;border-top:1px solid var(--border)}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px}.feature b{font-size:14px}
.feature p{font-size:12px;color:var(--muted);margin:4px 0 8px}
button{font:inherit;cursor:pointer;border:1px solid var(--border);background:#f1f4fb;border-radius:9px;padding:6px 10px;color:inherit}button:disabled{opacity:.5;cursor:not-allowed}
.primary{background:var(--accent);color:#fff;border-color:var(--accent)}.badge{font-size:11px;color:var(--muted)}
@media(prefers-color-scheme:dark){:host{--bg:#202734;--muted:#a4b3c8;--border:#49556b;--accent:#789bd6;color:#eef3ff}.launch{color:#0d1b34}button{background:#303c51;color:#fff}.primary{color:#0c1a34}}
`
export interface ControlCenterOptions {runtime:FeatureRuntime;title?:string;launcher?:boolean}
export interface ControlCenter {open():void;close():void;destroy():void}
export function mountControlCenter(opts:ControlCenterOptions):ControlCenter {
 const host=document.createElement('div');host.id='koba-browser-tools-root';host.style.cssText='position:fixed;inset:0;width:0;height:0;z-index:2147483646;pointer-events:none';
 const shadow=host.attachShadow({mode:'open'});const style=document.createElement('style');style.textContent=CSS;shadow.append(style);
 const shell=document.createElement('section');shell.className='shell';shadow.append(shell);
 let opened=false;const refresh=()=>{
  shell.replaceChildren();const panel=document.createElement('div');panel.className='panel';panel.hidden=!opened;
  const header=document.createElement('div');header.className='head';const title=document.createElement('strong');title.className='title';title.textContent=opts.title??'Koba Browser Tools';header.append(title);
  const closeBtn=document.createElement('button');closeBtn.textContent='Закрыть';closeBtn.onclick=()=>{opened=false;refresh()};header.append(closeBtn);panel.append(header);
  const sub=document.createElement('p');sub.className='sub';sub.textContent='Модули текущего сайта · единый центр управления';panel.append(sub);
  for(const status of opts.runtime.list())panel.append(featureRow(status));shell.append(panel);
  if(opts.launcher){const launcher=document.createElement('button');launcher.className='launch';launcher.textContent='Инструменты';launcher.title='Открыть Koba Browser Tools';launcher.onclick=()=>{opened=!opened;refresh()};shell.append(launcher)}
 };
 const featureRow=(st:FeatureStatus):HTMLElement=>{
  const container=document.createElement('article');container.className='feature';const row=document.createElement('div');row.className='row';const name=document.createElement('b');name.textContent=st.title;row.append(name);
  const badge=document.createElement('span');badge.className='badge';badge.textContent=st.state==='active'?'Готово':st.reason??st.state;row.append(badge);container.append(row);
  const desc=document.createElement('p');desc.textContent=st.description;container.append(desc);
  const controls=document.createElement('div');controls.className='row';
  const enable=document.createElement('input');enable.type='checkbox';enable.checked=st.state!=='disabled';enable.disabled=st.state==='unsupported';enable.setAttribute('aria-label',`Включить ${st.title}`);
  enable.onchange=()=>void opts.runtime.setEnabled(st.id,enable.checked).then(refresh);controls.append(enable);
  const open=document.createElement('button');open.className='primary';open.textContent='Открыть';open.disabled=st.state!=='active';open.onclick=()=>void opts.runtime.open(st.id);controls.append(open);container.append(controls);return container
 };
 document.documentElement.append(host);refresh();return{open(){opened=true;refresh()},close(){opened=false;refresh()},destroy(){host.remove()}}
}
