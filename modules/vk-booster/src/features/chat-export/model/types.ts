export type ArchiveMode = 'recent' | 'incremental' | 'backfill'
export interface ArchiveOptions {
  peerId:number;mode:ArchiveMode;limit:number;from:string;through:string
  pageSize:number;delay:number;media:boolean
}
export interface ArchiveProgress {
  phase:string;done:number;total:number;newCount?:number;downloaded?:number
  failed?:number;error?:string
}
export interface ArchiveStatus {
  version:string;folder:string|null;busy:boolean;options:ArchiveOptions
  progress:ArchiveProgress;messages:number;checkpoint:{status?:string}|null
}
export interface ArchiveApi {
  readonly version:string
  status():ArchiveStatus
  subscribe(listener:(status:ArchiveStatus)=>void):()=>void
  selectFolder():Promise<unknown>
  run(options:Partial<ArchiveOptions>):Promise<unknown>
  resume():Promise<unknown>
  stop():void
  show():void
  destroy():void
}
declare global {interface Window {VKExport?:ArchiveApi}}
export function archiveApi():ArchiveApi|undefined {
  return window.VKExport
}
