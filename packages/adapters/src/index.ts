import type { SettingsStore, DeliveryTarget } from '@kobaproduction/browser-core'
export function createSettingsStore(target:DeliveryTarget, namespace='koba-browser'):SettingsStore {
  if(target==='chromium') return {
    async get(key){const data=await chrome.storage.local.get(`${namespace}:${key}`);return data[`${namespace}:${key}`] as boolean|undefined},
    async set(key,enabled){await chrome.storage.local.set({[`${namespace}:${key}`]:enabled})}
  }
  return {
    async get(key){try{const value=localStorage.getItem(`${namespace}:${key}`);return value===null?undefined:value==='true'}catch{return undefined}},
    async set(key,enabled){localStorage.setItem(`${namespace}:${key}`,String(enabled))}
  }
}
export interface ProxyProfile {id:string;name:string;scheme:'http'|'https'|'socks4'|'socks5';host:string;port:number;bypass?:string[]}
export function validateProxyProfile(v:ProxyProfile):ProxyProfile {
 if(!v||!['http','https','socks4','socks5'].includes(v.scheme)||!/^[a-z\d.-]+$/i.test(v.host)||!Number.isInteger(v.port)||v.port<1||v.port>65535)throw new Error('Invalid proxy profile')
 return v
}
// The userscript target cannot access browser-wide proxy settings. Chromium
// requires the manifest permission and a background-only adapter.
export function proxyAvailable(target:DeliveryTarget,granted:ReadonlySet<string>){return target==='chromium'&&granted.has('proxy')}
