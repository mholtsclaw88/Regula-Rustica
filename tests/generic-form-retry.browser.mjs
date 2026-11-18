import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {extname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const root=new URL('../',import.meta.url);
const engine=process.env.STORAGE_TEST_BROWSER||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const server=createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/cloud-runtime-config.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end('window.REGULA_RUSTICA_CLOUD_CONFIG={};');return;}
 try{const file=new URL(`.${pathname==='/'?'/index.html':pathname}`,root);if(!file.href.startsWith(root.href))throw Error('Invalid path');const content=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'})[extname(file.pathname)]||'application/octet-stream'});res.end(content);}catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const stamp='2026-10-14T16:00:00.000Z';
const data={schemaVersion:14,settings:{homesteadName:'Generic retry test',onboarding:{version:1,completed:true,step:8}},records:[{id:'00000000-0000-4000-8000-000000000001',name:'Maple',type:'Animal',status:'Active',identity:{species:'Cattle',purpose:'Dairy',managedAs:'Individual'},stewardship:{},createdAt:stamp,updatedAt:stamp}],tasks:[],people:[],documents:[],attachments:[],events:[],notes:[],ledger:[],ledgerAllocations:[],relationships:[],assignments:[],calendarEvents:[],yieldEntries:[],choreWindows:[]};
const pdf='%PDF-1.4\nSynthetic retry attachment\n';
const replacementPdf=pdf.replace('Synthetic','Different');
const pdfFile=(name,content)=>({name,mimeType:'application/pdf',buffer:Buffer.from(content)});
const blobIds=page=>page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('regula-rustica-attachments');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;const keys=db.transaction('blobs','readonly').objectStore('blobs').getAllKeys();keys.onsuccess=()=>{db.close();resolve(keys.result.sort());};keys.onerror=()=>reject(keys.error);};}));
const shots=[];
async function capture(page,mode,state){
 const directory=process.env.GENERIC_FORM_SCREENSHOTS;if(!directory)return;
 await mkdir(directory,{recursive:true});
 for(const width of [360,390,1440]){await page.setViewportSize({width,height:844});const path=`${directory}/${mode}-${state}-${width}.png`;await page.screenshot({path});shots.push({path,mode,state,width,ui:await page.evaluate(()=>({error:document.querySelector('#modalSaveError').textContent,open:document.querySelector('#modal').open,form:Object.fromEntries(new FormData(document.querySelector('#modalForm')))}))});}
 await writeFile(`${directory}/manifest.json`,JSON.stringify(shots,null,2));await page.setViewportSize({width:390,height:844});
}
let browser;
const failures=[];
try{
 browser=await require('playwright')[engine].launch({headless:true});
 for(const mode of ['note','event','document']){
 const context=await browser.newContext({viewport:{width:390,height:844}});
 try{
 await context.addInitScript(({data,mode})=>{if(sessionStorage.getItem('seeded'))return;sessionStorage.setItem('seeded','yes');const local=structuredClone(data);local.records.push({...local.records[0],id:'00000000-0000-4000-8000-000000000002',name:'Oak'});if(mode==='event')Object.assign(local.records[0],{type:'Work',identity:{workType:'Construction'},status:'Active'});localStorage.setItem('regulaRusticaV5',JSON.stringify(local));},{data,mode});
 const page=await context.newPage();page.on('console', message=>{if(message.type()==='warning')console.log('BROWSER_WARNING',mode,message.text());});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);
 await page.waitForFunction(()=>window.RegulaRustica&&!document.querySelector('.device-storage-startup'));
 await page.evaluate(mode=>window.openModal(mode,null,window.RegulaRusticaLocal.read().records[0].id),mode);
 if(mode==='note')await page.locator('#modalForm [name=text]').fill('First note draft');
 if(mode==='event'){await page.locator('#modalForm [name=eventType]').selectOption('Completed');await page.locator('#modalForm [name=details]').fill('First event draft');}
 if(mode==='document'){await page.locator('#modalForm [name=title]').fill('First document draft');await page.locator('#modalForm [name=body]').fill('First document body');await page.locator('#modalForm input[type=file]').setInputFiles({name:'retry.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdf)});}
 await page.evaluate(()=>{const storage=window.RegulaRusticaStorage;window.repairCommit=storage.backend.commit.bind(storage.backend);window.failedCommits=0;storage.backend.commit=async batch=>{if(batch.has('regulaRusticaV5')){window.failedCommits++;throw Error('simulated main commit failure');}return window.repairCommit(batch);};});
 await page.locator('#modalSubmit').click();await page.waitForFunction(()=>document.querySelector('#modalForm').dataset.saving==='false'&&(window.failedCommits>=1||document.querySelector('#modalSaveError').textContent.includes('Attachments could not finish')));assert.equal(await page.evaluate(()=>window.failedCommits),1,'first failure must reach the simulated main Farm Book commit');
 await page.locator('#modalSaveError').waitFor({state:'visible'});await capture(page,mode,'failed');
 const collection=mode==='note'?'notes':mode==='event'?'events':'documents';
 const first=await page.evaluate(collection=>window.RegulaRusticaLocal.read()[collection],collection);assert.equal(first.length,1);const id=first[0].id;
 const firstAttachments=await page.evaluate(()=>window.RegulaRusticaLocal.read().attachments);
 if(mode==='note')await page.locator('#modalForm [name=text]').fill('Edited note draft');
 if(mode==='event'){await page.locator('#modalForm [name=eventType]').selectOption('Other');await page.locator('#modalForm [name=details]').fill('Edited event draft');}
 if(mode==='document'){await page.locator('#modalForm [name=title]').fill('Edited document draft');await page.locator('#modalForm [name=body]').fill('Edited document body');}
 await page.locator('#modalSubmit').click();await page.waitForFunction(()=>window.failedCommits>=2&&document.querySelector('#modalForm').dataset.saving==='false');
 const second=await page.evaluate(collection=>window.RegulaRusticaLocal.read()[collection],collection);
 const attachments=await page.evaluate(()=>window.RegulaRusticaLocal.read().attachments);
 console.log('RETRY_STATE',JSON.stringify({mode,firstIds:first.map(x=>x.id),secondIds:second.map(x=>x.id),attachments:attachments.map(x=>({id:x.id,documentId:x.documentId,filename:x.filename}))}));
 assert.equal(second.length,1,`${mode} failed retry must keep exactly one draft`);assert.equal(second[0].id,id);assert.equal(second[0].createdAt,first[0].createdAt);
  if(mode==='event'){
   assert.equal(await page.evaluate(()=>window.RegulaRusticaLocal.read().records[0].status),'Active');
   await page.locator('#modalForm [name=eventType]').selectOption('Completed');await page.locator('#modalSubmit').click();await page.waitForFunction(()=>window.failedCommits>=3&&document.querySelector('#modalForm').dataset.saving==='false');
   await page.evaluate(async()=>{const local=window.RegulaRusticaLocal.read();local.records[0].status='Planned';local.records[0].updatedAt='2030-01-01T00:00:00.000Z';try{await window.RegulaRusticaLocal.write(local,'sync');}catch{}});
   await page.locator('#modalForm [name=eventType]').selectOption('Other');await page.locator('#modalSubmit').click();await page.waitForFunction(()=>window.failedCommits>=5&&document.querySelector('#modalForm').dataset.saving==='false');
   assert.equal(await page.evaluate(()=>window.RegulaRusticaLocal.read().records[0].status),'Planned');
 }
 let finalAttachmentId=firstAttachments[0]?.id;
 if(mode==='document'){assert.equal(attachments.length,1);assert.equal(attachments[0].id,firstAttachments[0].id);assert.equal(attachments[0].documentId,id);assert.equal(await page.locator('#modalForm input[type=file]').evaluate(el=>el.files.length),1);assert.equal(await page.evaluate(async id=>(await window.RegulaRusticaDocuments.readLocal(id)).blob.text(),attachments[0].id),pdf);}
 if(mode==='document'){
   await page.evaluate(()=>{
     window.invalidReads=0;window.invalidStores=0;window.guardArrayBuffer=File.prototype.arrayBuffer;window.guardPut=IDBObjectStore.prototype.put;
     File.prototype.arrayBuffer=function(...args){if(['oversized.pdf','unsupported.txt'].includes(this.name))window.invalidReads++;return window.guardArrayBuffer.apply(this,args);};
     IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name==='regula-rustica-attachments'&&['oversized.pdf','unsupported.txt'].includes(args[0].filename))window.invalidStores++;return window.guardPut.apply(this,args);};
   });
   for(const invalid of ['unsupported','oversized']){
     await page.evaluate(invalid=>{const file=invalid==='oversized'?new File([new Uint8Array(window.RegulaRusticaDocuments.MAX_FILE_BYTES+1)],'oversized.pdf',{type:'application/pdf'}):new File(['unsupported'],'unsupported.txt',{type:'text/plain'});const transfer=new DataTransfer();transfer.items.add(file);const input=document.querySelector('#modalForm input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));},invalid);
     await page.locator('#modalSubmit').click();await page.waitForFunction(()=>document.querySelector('#modalForm').dataset.saving==='false'&&document.querySelector('#modalSaveError').textContent.includes('Attachments could not finish'));
     assert.equal(await page.evaluate(()=>window.invalidReads),0);assert.equal(await page.evaluate(()=>window.invalidStores),0);assert.equal(await page.evaluate(()=>window.failedCommits),2);assert.deepEqual(await blobIds(page),[firstAttachments[0].id]);
   }
   await page.evaluate(()=>{File.prototype.arrayBuffer=window.guardArrayBuffer;IDBObjectStore.prototype.put=window.guardPut;});
   await page.evaluate(()=>{window.originalBlobPut=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){const request=window.originalBlobPut.apply(this,args);if(this.transaction.db.name==='regula-rustica-attachments'&&args[0].filename==='blocked.pdf')this.transaction.abort();return request;};});
   await page.locator('#modalForm input[type=file]').setInputFiles([pdfFile('retry.pdf',pdf),pdfFile('added.pdf',pdf),pdfFile('blocked.pdf',pdf)]);
   await page.locator('#modalSubmit').click();await page.waitForFunction(()=>document.querySelector('#modalSaveError').textContent.includes('Attachments could not finish')&&document.querySelector('#modalForm').dataset.saving==='false');
   assert.deepEqual(await blobIds(page),[firstAttachments[0].id]);
   assert.equal(await page.locator('#modalForm input[type=file]').evaluate(el=>el.files.length),3);
   await page.evaluate(()=>{IDBObjectStore.prototype.put=window.originalBlobPut;});
   await page.locator('#modalForm input[type=file]').setInputFiles([pdfFile('retry.pdf',pdf),pdfFile('added.pdf',pdf)]);
   await page.locator('#modalSubmit').click();await page.waitForFunction(()=>window.failedCommits>=3&&document.querySelector('#modalForm').dataset.saving==='false');
   const added=await page.evaluate(()=>window.RegulaRusticaLocal.read().attachments);assert.equal(added.length,2);assert.equal(added.find(a=>a.filename==='retry.pdf').id,firstAttachments[0].id);
   await page.locator('#modalForm input[type=file]').setInputFiles(pdfFile('retry.pdf',replacementPdf));
   await page.locator('#modalSubmit').click();await page.waitForFunction(()=>window.failedCommits>=4&&document.querySelector('#modalForm').dataset.saving==='false');
   const replaced=await page.evaluate(()=>window.RegulaRusticaLocal.read().attachments);assert.equal(replaced.length,1);assert.notEqual(replaced[0].id,firstAttachments[0].id);assert.equal(replaced[0].size,firstAttachments[0].size);finalAttachmentId=replaced[0].id;
 }
 await page.evaluate(()=>{window.RegulaRusticaStorage.backend.commit=window.repairCommit;});
 await page.locator('#modalCancel').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'modalSubmit');await page.keyboard.press('Enter');await page.waitForFunction(()=>!document.querySelector('#modal').open);
 assert.equal(await page.locator('#modalSaveError').textContent(),'');await page.evaluate(()=>window.openRecord(window.RegulaRusticaLocal.read().records[0].id));await page.locator('[data-record-section=journal]').click();await capture(page,mode,'saved');
 await page.reload();await page.waitForFunction(()=>window.RegulaRustica&&!document.querySelector('.device-storage-startup'));
 const final=await page.evaluate(collection=>window.RegulaRusticaLocal.read()[collection],collection);assert.equal(final.length,1);assert.equal(final[0].id,id);assert.equal(final[0].createdAt,first[0].createdAt);
 if(mode==='note')assert.equal(final[0].text,'Edited note draft');
 if(mode==='event'){assert.equal(final[0].details,'Edited event draft');assert.equal(final[0].eventType,'Other');assert.equal(await page.evaluate(()=>window.RegulaRusticaLocal.read().records[0].status),'Planned');}
 if(mode==='document'){assert.equal(final[0].title,'Edited document draft');assert.equal(final[0].body,'Edited document body');const saved=await page.evaluate(()=>window.RegulaRusticaLocal.read().attachments);assert.equal(saved.length,1);assert.equal(saved[0].id,finalAttachmentId);assert.equal(saved[0].documentId,id);assert.equal(await page.evaluate(async id=>(await window.RegulaRusticaDocuments.readLocal(id)).blob.text(),saved[0].id),replacementPdf);assert.deepEqual(await blobIds(page),[finalAttachmentId]);}
 if(mode==='document'){
   const shape=await page.evaluate(async id=>{const stored=await window.RegulaRusticaDocuments.readLocal(id);return {filename:stored.filename,mimeType:stored.mimeType,size:stored.size,blobType:stored.blob.type,blobSize:stored.blob.size,hasBytes:'bytes' in stored};},finalAttachmentId);
   assert.deepEqual(shape,{filename:'retry.pdf',mimeType:'application/pdf',size:Buffer.byteLength(replacementPdf),blobType:'application/pdf',blobSize:Buffer.byteLength(replacementPdf),hasBytes:false});
   if(engine==='chromium'){
     await page.evaluate(async content=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('regula-rustica-attachments');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{await new Promise((resolve,reject)=>{const tx=db.transaction('blobs','readwrite');tx.objectStore('blobs').put({id:'legacy-blob',blob:new Blob([content],{type:'application/pdf'}),filename:'legacy.pdf',mimeType:'application/pdf',size:content.length});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}},pdf);
     const legacy=await page.evaluate(async()=>{const stored=await window.RegulaRusticaDocuments.readLocal('legacy-blob');return {content:await stored.blob.text(),type:stored.blob.type,filename:stored.filename};});
     assert.deepEqual(legacy,{content:pdf,type:'application/pdf',filename:'legacy.pdf'});await page.evaluate(()=>window.RegulaRusticaDocuments.removeLocal(['legacy-blob']));
   }
 }
 await page.evaluate(mode=>window.openModal(mode,null,window.RegulaRusticaLocal.read().records[1].id),mode);
 if(mode==='note')await page.locator('#modalForm [name=text]').fill('New deliberate note');
 if(mode==='event'){await page.locator('#modalForm [name=eventType]').selectOption('Other');await page.locator('#modalForm [name=details]').fill('New deliberate event');}
 if(mode==='document'){await page.locator('#modalForm [name=title]').fill('New deliberate document');await page.locator('#modalForm input[type=file]').setInputFiles(pdfFile('retry.pdf',replacementPdf));}
 await page.locator('#modalSubmit').click();await page.waitForFunction(()=>!document.querySelector('#modal').open);
 const deliberate=await page.evaluate(collection=>window.RegulaRusticaLocal.read()[collection],collection);assert.equal(deliberate.length,2);assert.equal(new Set(deliberate.map(item=>item.id)).size,2);assert.ok(deliberate.some(item=>item.id===id));assert.ok(deliberate.some(item=>item.recordId==='00000000-0000-4000-8000-000000000002'));
 if(mode==='document'){const both=await page.evaluate(()=>window.RegulaRusticaLocal.read().attachments);assert.equal(both.length,2);assert.equal(new Set(both.map(a=>a.id)).size,2);assert.equal(new Set(both.map(a=>a.documentId)).size,2);assert.equal((await blobIds(page)).length,2);}
 assert.deepEqual(errors,[]);console.log(`PASS ${mode}: failed retry preserves identity, edited content, and one committed entry after reload`);
 }catch(error){failures.push({mode,message:error.message});console.error(`FAIL ${mode}: ${error.stack}`);}finally{await context.close();}
 }
 assert.deepEqual(failures,[]);
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
