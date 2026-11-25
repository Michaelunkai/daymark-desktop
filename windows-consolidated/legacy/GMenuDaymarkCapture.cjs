'use strict';
// Called only for the explicitly selected, closed Daymark application.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');
const {DatabaseSync}=require('node:sqlite');
let stage='open-profile';
async function main(){
 const profile=path.resolve(process.argv[2]),destination=path.resolve(process.argv[3]);
 const host='daymark-desktop.michaelovsky55555.chatgpt.site';
 const cookieFile=path.join(profile,'Partitions/daymark/Network/Cookies'),snapshot=destination+'.cookies';
 for(const suffix of ['','-journal','-wal','-shm']) if(fs.existsSync(cookieFile+suffix)) fs.copyFileSync(cookieFile+suffix,snapshot+suffix);
 let row,db;
 try{
  // SQLite may need to recover its shutdown journal. Recover the private copy only.
  db=new DatabaseSync(snapshot);
  row=db.prepare('SELECT value,encrypted_value FROM cookies WHERE host_key=? AND name=?').get(host,'daymark.sync-key');
 }finally{
  if(db)db.close();
  for(const suffix of ['','-journal','-wal','-shm'])if(fs.existsSync(snapshot+suffix))fs.unlinkSync(snapshot+suffix);
 }
 if(!row)throw Error();
 stage='decrypt-cookie';
 let syncKey=row.value;
 if(!syncKey){
  const state=JSON.parse(fs.readFileSync(path.join(profile,'Local State'),'utf8'));
  const protectedKey=Buffer.from(state.os_crypt.encrypted_key,'base64');
  if(protectedKey.subarray(0,5).toString()!=='DPAPI')throw Error();
  const result=cp.spawnSync(path.join(__dirname,'TodoistSessionWindows.exe'),['unprotect-key'],{input:protectedKey.subarray(5).toString('base64'),encoding:'utf8',windowsHide:true});
  if(result.status!==0)throw Error();
  const key=Buffer.from(result.stdout.trim(),'base64'),data=Buffer.from(row.encrypted_value);
  try{
   if(data.subarray(0,3).toString()!=='v10')throw Error();
   const cipher=crypto.createDecipheriv('aes-256-gcm',key,data.subarray(3,15));cipher.setAuthTag(data.subarray(-16));
   const clear=Buffer.concat([cipher.update(data.subarray(15,-16)),cipher.final()]);
   const hash=crypto.createHash('sha256').update(host).digest();
   syncKey=(clear.subarray(0,32).equals(hash)?clear.subarray(32):clear).toString();clear.fill(0);
  }finally{key.fill(0);}
 }
 if(!/^[A-Za-z0-9_-]{22}$/.test(syncKey))throw Error();
 stage='verify-sync';
 const response=await fetch('https://'+host+'/api/sync/'+syncKey,{redirect:'error',signal:AbortSignal.timeout(30000)});
 if(response.status!==200)throw Error();
 const body=await response.json();
 if(!body.state||!body.state.tasks||typeof body.state.tasks!=='object')throw Error();
 const count=value=>Array.isArray(value)?value.length:Object.keys(value||{}).length;
 stage='write-encrypted-package-metadata';
 fs.writeFileSync(destination,JSON.stringify({SyncKey:syncKey,Tasks:count(body.state.tasks),Projects:count(body.state.projects),Revision:body.revision}),{flag:'wx'});
 console.log('DAYMARK_CAPTURE_VERIFIED tasks='+count(body.state.tasks)+' projects='+count(body.state.projects));
}
main().catch(error=>{console.error(JSON.stringify({status:'DAYMARK_CAPTURE_FAILED',stage,errorType:error.name,code:error.code||null,sqliteStatus:error.errstr||null}));process.exitCode=1;});
