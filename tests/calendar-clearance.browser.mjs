import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {extname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const root=new URL('../',import.meta.url);
const engine=process.env.STORAGE_TEST_BROWSER||'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const baseline=process.env.CALENDAR_BASELINE==='1';
const directory=process.env.CALENDAR_SCREENSHOTS;
const server=createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/cloud-runtime-config.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end('window.REGULA_RUSTICA_CLOUD_CONFIG={};');return;}
 try{const file=new URL(`.${pathname==='/'?'/index.html':pathname}`,root);if(!file.href.startsWith(root.href))throw Error('Invalid path');const content=await readFile(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png'})[extname(file.pathname)]||'application/octet-stream'});res.end(content);}catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const stamp='2026-10-14T16:00:00.000Z';
const data={schemaVersion:14,settings:{homesteadName:'Willow Brook Homestead',onboarding:{version:1,completed:true,step:8}},records:[],tasks:[],people:[],documents:[],attachments:[],events:[],notes:[],ledger:[],ledgerAllocations:[],relationships:[],assignments:[],calendarEvents:[],yieldEntries:[],choreWindows:[]};
const measurements=[];
async function capture(page,state,width){if(!directory)return;await mkdir(directory,{recursive:true});const path=`${directory}/${engine}-${state}-${width}.png`;await page.screenshot({path});measurements.push({path,state,width,scroll:await page.evaluate(()=>scrollY)});}
async function visible(page,selector){return page.locator(selector).evaluate(el=>{const r=el.getBoundingClientRect();const top=document.querySelector('.top').getBoundingClientRect();const utility=document.querySelector('.app-navigation')?.getBoundingClientRect();const bottom=document.querySelector('.mobile-primary-nav')?.getBoundingClientRect();const footer=bottom&&bottom.height?bottom.top:innerHeight;const ceiling=Math.max(top.top<=0?top.bottom:0,utility?.bottom||0);const hits=[.2,.5,.8].map(f=>document.elementFromPoint(r.x+r.width*f,r.y+r.height/2));return {bounds:r.toJSON(),ceiling,footer,hit:hits.every(hit=>el===hit||el.contains(hit)),clear:r.top>=ceiling&&r.bottom<=footer};});}
let browser;
try{
 browser=await require('playwright')[engine].launch({headless:true});
 for(const width of [360,390,1440]){
  const context=await browser.newContext({viewport:{width,height:844}});
  await context.addInitScript(data=>localStorage.setItem('regulaRusticaV5',JSON.stringify(data)),data);
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(()=>window.RegulaRustica&&!document.querySelector('.device-storage-startup'));
  const nav=width<=800?'.mobile-primary-nav':'.nav';
  await page.locator(`${nav} [data-view=calendar]`).click();await page.evaluate(()=>scrollTo(0,0));
  await capture(page,'month-empty',width);
  const title=await page.locator('#calendarPageTitle').boundingBox();
  measurements.push({state:'title',width,title});
  if(!baseline){assert.ok(title.width>width*.45,'no absent-seal grid column may crush heading');assert.equal(await page.locator('.calendar-month-counts').count(),0);}
  await page.locator('#cellarerDeskToggle').focus();await page.keyboard.press('Enter');await page.locator('#cellarerDesk').waitFor({state:'visible'});await capture(page,'cyril-open',width);
  const desk=await page.locator('#cellarerDesk').boundingBox();measurements.push({state:'desk-bounds',width,desk});if(!baseline){assert.ok(desk.x>=0&&desk.x+desk.width<=width);assert.ok(desk.y>=0&&desk.y+desk.height<=844-(width<=800?68:0));}
  await page.keyboard.press('Escape');assert.equal(await page.locator('#cellarerDeskToggle').getAttribute('aria-expanded'),'false');assert.equal(await page.evaluate(()=>document.activeElement.id),'cellarerDeskToggle');
  if(!baseline){
   await page.evaluate(async()=>{
    const local=window.RegulaRusticaLocal.read();const now=new Date();const date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
    local.choreWindows=[{id:'synthetic-morning',name:'Morning',startTime:'06:00',endTime:'09:00',enabled:true}];
    local.tasks=[{id:'synthetic-chore',title:'Water garden',dueDate:date,choreWindowId:'synthetic-morning',status:'open',completed:false},{id:'synthetic-other',title:'Repair gate',dueDate:date,status:'open',completed:false}];
    local.calendarEvents=[{id:'synthetic-event',title:'Feed delivery',startDate:date,endDate:date,allDay:true}];
    await window.RegulaRusticaLocal.write(local,'browser-fixture');
   });
   await page.locator(nav+' [data-view=calendar]').click();
   const cell=page.locator('.calendar-month-day.current');await cell.scrollIntoViewIfNeeded();await capture(page,'month-populated',width);
   const label=await cell.getAttribute('aria-label');assert.match(label,/1 chores, 1 other tasks, 1 events/);
   assert.equal(await cell.locator('.calendar-month-counts > span').count(),3);
   const density=await cell.evaluate(el=>[...el.querySelectorAll('.calendar-month-counts span')].map(x=>({text:x.textContent,size:parseFloat(getComputedStyle(x).fontSize),overflow:x.scrollWidth>x.clientWidth})));
   assert.ok(density.every(x=>x.size>=11&&!x.overflow),JSON.stringify(density));measurements.push({state:'populated-counts',width,label,density});
   await cell.focus();await page.keyboard.press('Enter');await page.locator('.calendar-ledger').waitFor({state:'visible'});await capture(page,'day-selected',width);assert.ok((await page.locator('#calendarGrid').innerText()).includes('Feed delivery'));
  }
  await page.locator(`${width<=800?'.top':'.nav'} [data-view=settings]`).click();await page.locator('[data-settings-category=identity]').click();
  await page.locator('#homesteadName').waitFor({state:'visible'}).catch(()=>{});
  const buttons=await page.locator('#settingIdentity button').all();const target=buttons.at(-1);
  const targetId=await target.getAttribute('id');
  await target.evaluate(el=>{const r=el.getBoundingClientRect();const nav=document.querySelector('.mobile-primary-nav').getBoundingClientRect();const bottom=nav.height?nav.top:innerHeight;window.scrollBy(0,r.top-(bottom-r.height-12));});
  await capture(page,'identity-scroll',width);measurements.push({state:'identity-action',width,targetId,...await visible(page,`#${targetId}`)});
  if(!baseline){const status=await visible(page,`#${targetId}`);assert.ok(status.hit&&status.clear,JSON.stringify(status));}
  if(!baseline){
   await page.evaluate(async()=>{const local=window.RegulaRusticaLocal.read();const sample=local.tasks.find(x=>x.id==='synthetic-other');local.tasks.push(...Array.from({length:32},(_,i)=>({...sample,id:'synthetic-long-'+i,title:'Inspect irrigation section '+(i+1)})));await window.RegulaRusticaLocal.write(local,'browser-fixture');});
   await page.locator(nav+' [data-view=calendar]').click();await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));assert.ok(await page.evaluate(()=>scrollY>1000),'fixture must exercise a long working page');
   const launch=await page.locator('#cellarerDeskToggle').boundingBox();assert.ok(launch.y>=0&&launch.y+launch.height<844);await page.mouse.click(launch.x+launch.width/2,launch.y+launch.height/2);await page.locator('#cellarerDesk').waitFor({state:'visible'});assert.ok(await page.evaluate(()=>scrollY>1000),'opening Cyril must preserve working scroll');await capture(page,'long-scroll-cyril',width);await page.keyboard.press('Escape');
   await page.locator(nav+' [data-view=calendar]').click();await page.evaluate(()=>scrollTo(0,0));await page.locator('.calendar-view-pills label').filter({hasText:/^Week$/}).click();assert.equal(await page.locator('.calendar-week .calendar-summary-day').count(),7);
   await page.locator('#addCalendarEvent').click();await page.locator('#modal').waitFor({state:'visible'});assert.ok(await page.locator('#modal').isVisible());await page.locator('#modalCancel').click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log(JSON.stringify(measurements,null,2));
}finally{if(directory){await mkdir(directory,{recursive:true});await writeFile(`${directory}/${engine}-manifest.json`,JSON.stringify(measurements,null,2));}await browser?.close();await new Promise(resolve=>server.close(resolve));}
