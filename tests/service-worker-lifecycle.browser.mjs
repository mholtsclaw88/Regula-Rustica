import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {extname,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {waitForControlledWorker} from './helpers/controlled-worker.mjs';
const require=createRequire(import.meta.url),root=new URL('../',import.meta.url);
const engine=process.env.STORAGE_TEST_BROWSER||'chromium';
const deferred=()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};};
const installRequested=deferred(),installRelease=deferred(),htmlRequested=deferred(),htmlRelease=deferred();
let holdHTML=false;
const server=createServer(async(request,response)=>{
 const pathname=new URL(request.url,'http://localhost').pathname;
 // This precache-only asset holds first installation without delaying the app UI.
 if(pathname==='/icons/icon-512-maskable.png'){installRequested.release();await installRelease.promise;}
 if(pathname==='/'&&holdHTML){htmlRequested.release();await htmlRelease.promise;}
 if(pathname==='/cloud-runtime-config.js'){response.writeHead(200,{'Content-Type':'text/javascript'});response.end('window.REGULA_RUSTICA_CLOUD_CONFIG={};');return;}
 try{const file=new URL(`.${pathname==='/'?'/index.html':pathname}`,root);if(!file.href.startsWith(root.href))throw Error('Invalid path');const content=await readFile(file);response.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png'})[extname(file.pathname)]||'application/octet-stream','Cache-Control':'no-cache'});response.end(content);}catch{response.writeHead(404);response.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`,screenshots=[];
const browser=await require('playwright')[engine].launch({headless:true});
async function bounded(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`${label} timed out`)),30_000);})]);}finally{clearTimeout(timer);}}
async function ready(page){await page.waitForFunction(()=>window.RegulaRustica&&window.RegulaRusticaSync&&!document.querySelector('.device-storage-startup'),undefined,{timeout:15_000});}
async function state(page){return page.evaluate(()=>{const data=window.RegulaRusticaLocal.read();return {records:data.records.map(({id,name})=>({id,name})),ledger:data.ledger.map(({id,description,amount})=>({id,description,amount}))};});}
async function capture(page,phase){
 if(!process.env.SW_LIFECYCLE_SCREENSHOTS)return;const directory=resolve(process.env.SW_LIFECYCLE_SCREENSHOTS);await mkdir(directory,{recursive:true});
 for(const view of ['ledger']){await page.locator(`button[data-view=${view}]:visible`).first().click();await page.getByText(view==='records'?'Maple':'Lifecycle first',{exact:true}).waitFor({state:'visible'});
  for(const width of [360,390,1440]){await page.setViewportSize({width,height:844});const path=`${directory}/${phase}-${view}-${width}.png`;await page.screenshot({path});screenshots.push({path,phase,view,width,userState:await state(page),worker:await page.evaluate(()=>({controller:navigator.serviceWorker.controller?.state,scriptURL:navigator.serviceWorker.controller?.scriptURL}))});}
 }
 await writeFile(`${directory}/manifest.json`,JSON.stringify(screenshots,null,2));await page.setViewportSize({width:390,height:844});
}
try{
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addInitScript(()=>{if(sessionStorage.getItem('lifecycle-seeded'))return;sessionStorage.setItem('lifecycle-seeded','true');localStorage.setItem('regulaRusticaV5',JSON.stringify({schemaVersion:14,settings:{homesteadName:'Offline lifecycle fixture',onboarding:{version:1,completed:true,step:8}},records:[{id:'native-maple',name:'Maple',type:'Animal',status:'Active',identity:{species:'Cattle',purpose:'Dairy',managedAs:'Individual'},stewardship:{}}],ledger:[{id:'native-ledger-1',description:'Lifecycle first',kind:'expense',amount:2,date:'2026-11-17'},{id:'native-ledger-2',description:'Lifecycle second',kind:'expense',amount:3,date:'2026-11-17'}],tasks:[],people:[],documents:[],attachments:[],events:[],notes:[],ledgerAllocations:[],relationships:[],assignments:[],calendarEvents:[],yieldEntries:[],choreWindows:[]}));});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await ready(page);await bounded(installRequested.promise,'Precache gate');
 const installing=await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();return {installing:registration?.installing?.state,controller:navigator.serviceWorker.controller?.state||null};});
 assert.equal(installing.installing,'installing');assert.equal(installing.controller,null);
 installRelease.release();
 // This barrier is the same lifecycle precondition used before the storage-suite
 // reload. It completes first activation/claim before a navigation can begin.
 await waitForControlledWorker(page);
 const source=await readFile(new URL('../service-worker.js',import.meta.url),'utf8');
 const assets=[...source.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
 assert.ok(assets.length>=38);
 const expectedAssets=await Promise.all(assets.map(async path=>{const pathname=new URL(path,url).pathname,file=new URL(`.${pathname==='/'?'/index.html':pathname}`,root);return {path,url:new URL(path,url).href,sha256:createHash('sha256').update(await readFile(file)).digest('hex')};}));
 const before=await state(page);assert.equal(before.records[0].name,'Maple');assert.equal(before.ledger.length,2);
  assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller?.state),'activated');
  holdHTML=true;const reload=page.reload();
  const [response]=await Promise.all([reload,bounded(htmlRequested.promise,'Controlled reload HTML gate').then(()=>htmlRelease.release())]);await ready(page);
 assert.equal(response.fromServiceWorker(),true);assert.equal(await page.evaluate(()=>navigator.serviceWorker.controller?.state),'activated');assert.deepEqual(await state(page),before);await capture(page,'online');
 await new Promise(resolve=>server.close(resolve));
 const offline=await page.reload();await ready(page);assert.equal(offline.fromServiceWorker(),true);assert.deepEqual(await state(page),before);
 // Verify actual bytes through the worker with the origin stopped. This avoids
 // relying on a window CacheStorage handle to inspect a worker-owned cache.
 const workerResponses=new Map(),expectedURLs=new Set(expectedAssets.map(asset=>asset.url));let allResponses;
 const responseBarrier=new Promise(resolve=>allResponses=resolve);
 const observe=response=>{if(expectedURLs.has(response.url())){workerResponses.set(response.url(),response.fromServiceWorker());if(workerResponses.size===expectedURLs.size)allResponses();}};
 page.on('response',observe);
 const offlineAssets=await bounded(page.evaluate(async assets=>Promise.all(assets.map(async asset=>{const response=await fetch(asset.url);const bytes=await response.arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);return {path:asset.path,url:asset.url,status:response.status,sha256:[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')};})),expectedAssets),'Offline asset byte fetch');
 await bounded(responseBarrier,'Required offline asset responses');page.off('response',observe);
 assert.equal(offlineAssets.length,expectedAssets.length);
 for(const asset of offlineAssets){const expected=expectedAssets.find(value=>value.url===asset.url);assert.equal(asset.status,200,asset.path);assert.equal(asset.sha256,expected.sha256,asset.path+' cached bytes');assert.equal(workerResponses.get(asset.url),true,asset.path+' must be served by worker');}

 assert.deepEqual(await page.evaluate(async()=>{const raw=(await window.RegulaRusticaStorage.backend.readAll()).get('regulaRusticaV5');const data=JSON.parse(raw);return {records:data.records.map(({id,name})=>({id,name})),ledger:data.ledger.map(({id,description,amount})=>({id,description,amount}))};}),before,'native committed Farm Book remains exact');
 await capture(page,'offline');
 const negative=await browser.newContext(),unregistered=await negative.newPage();await assert.rejects(unregistered.goto(url));await negative.close();assert.deepEqual(errors,[]);await context.close();
 console.log(`PASS ${engine} gated first installation/claim before reload; all required offline asset bytes served by worker; stopped-origin worker reload preserves Maple and two native Ledger rows; fresh context rejects`);
}finally{installRelease.release();htmlRelease.release();await browser.close();await new Promise(resolve=>server.close(resolve));}
