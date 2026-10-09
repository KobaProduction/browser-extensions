/* Browser folder persistence driver; no VK provider knowledge. */
export function createArchiveFiles(getRoot){
const json=async(name)=>{try{return JSON.parse(await (await (await getRoot().getFileHandle(name)).getFile()).text())}catch(e){if(e.name==='NotFoundError')return null;throw e}};
async function write(name,data,dir=getRoot()){
 const h=await dir.getFileHandle(name,{create:true}),w=await h.createWritable();
 try{await w.write(typeof data==='string'||data instanceof Uint8Array||data instanceof Blob?data:JSON.stringify(data,null,2)+'\n');await w.close();}
 catch(e){await w.abort().catch(()=>{});throw e;}
}
async function dir(name,parent=getRoot()){return parent.getDirectoryHandle(name,{create:true})}
return {json,write,dir};
}
