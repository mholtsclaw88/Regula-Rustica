import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engineName = process.env.STORAGE_TEST_BROWSER || 'chromium';
assert.ok(['chromium', 'webkit'].includes(engineName));
const root = new URL('../', import.meta.url);
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/cloud-runtime-config.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript' });
    response.end('window.REGULA_RUSTICA_CLOUD_CONFIG = {};'); return;
  }
  try {
    const file = new URL(`.${pathname === '/' ? '/index.html' : pathname}`, root);
    if (!file.href.startsWith(root.href)) throw new Error('Invalid path');
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': ({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'})[extname(file.pathname)] || 'application/octet-stream' });
    response.end(content);
  } catch { response.writeHead(404); response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const fixture = name => ({ schemaVersion:14, settings:{homesteadName:name,onboarding:{version:1,completed:true,step:8}}, records:[], tasks:[], people:[], documents:[], attachments:[], events:[], notes:[], ledger:[], ledgerAllocations:[], relationships:[], assignments:[], calendarEvents:[], yieldEntries:[], choreWindows:[] });
const incoming = fixture('Restored test Homestead');
const backupFile = value => ({name:'test-backup.json',mimeType:'application/json',buffer:Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))});
let browser;
async function ready(page) {
  await page.waitForFunction(() => window.RegulaRustica && window.RegulaRusticaSync && !document.querySelector('.device-storage-startup'));
  await page.evaluate(() => window.RegulaRusticaStorage.flush());
}
async function openControls(page) {
  await page.locator('button[data-view=settings]:visible').click();
  await page.locator('[data-settings-category=cloud]').click();
  await page.locator('.account-cloud-overview [data-account-cloud-open=accountCloudBackupDetails]').click();
}
const snapshot = page => page.evaluate(() => ({working:JSON.stringify(window.RegulaRusticaLocal.read()),stored:window.RegulaRusticaStorage.getItem('regulaRusticaV5'),safety:window.RegulaRusticaStorage.getItem('regulaRusticaBeforeImport')}));
async function selected(page, value = incoming) {
  await page.locator('#importData').setInputFiles(backupFile(value));
  await page.locator('#backupRestoreConfirm').waitFor({state:'visible'});
}
async function status(page, text) { await page.waitForFunction(text => document.querySelector('#backupRestoreStatus').textContent.includes(text), text); }
try {
  browser = await require('playwright')[engineName].launch({headless:true});
  const context = await browser.newContext({viewport:{width:360,height:800}});
  await context.addInitScript(data => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded','yes');
    localStorage.setItem('regulaRusticaV5',JSON.stringify(data));
    localStorage.setItem('regulaRusticaBeforeImport',JSON.stringify({savedAt:'2026-01-01T00:00:00Z',rawValue:'older safety bytes'}));
  }, fixture('Current test Homestead'));
  const page = await context.newPage();
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto(url); await ready(page); await page.evaluate(() => window.RegulaRusticaLocal.write(window.RegulaRusticaLocal.read(), 'browser-fixture')); await openControls(page);
  const original=await snapshot(page);
  const chooserPromise=page.waitForEvent('filechooser');
  await page.locator('#restoreBackup').focus(); await page.keyboard.press('Enter');
  await (await chooserPromise).setFiles(backupFile(incoming));
  await page.locator('#backupRestoreConfirm').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'backupRestoreCancel');
  assert.deepEqual(await snapshot(page), original);
  for (const width of [360,390]) {
    await page.setViewportSize({width,height:800});
    const controls=await page.evaluate(()=>['backupRestoreCancel','backupRestoreReplace'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {height:r.height,left:r.left,right:r.right};}));
    for (const control of controls) {assert.ok(control.height>=44);assert.ok(control.left>=0 && control.right<=width);}
  }
  await page.keyboard.press('Escape'); await status(page,'cancelled');
  assert.deepEqual(await snapshot(page),original);
  assert.equal(await page.locator('#importData').inputValue(),'');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'restoreBackup');
  await selected(page); await page.locator('#backupRestoreCancel').focus(); await page.keyboard.press('Enter');
  await status(page,'cancelled'); assert.deepEqual(await snapshot(page),original);
  console.log('PASS keyboard Restore, safe initial focus, Cancel, Escape, same-file selection preserve exact working and safety bytes');

  for (const invalid of ['{bad json', {notABackup:true}, {...incoming,schemaVersion:999}]) {
    await page.locator('#importData').setInputFiles(backupFile(invalid)); await status(page,'could not');
    assert.equal(await page.locator('#backupRestoreConfirm').isVisible(),false);
    assert.deepEqual(await snapshot(page),original);
  }
  await page.evaluate(()=>{window.originalFileText=File.prototype.text;File.prototype.text=async()=>{throw new Error('Unreadable test file');};});
  await page.locator('#importData').setInputFiles(backupFile(incoming)); await status(page,'Unreadable test file');
  await page.evaluate(()=>{File.prototype.text=window.originalFileText;});
  assert.deepEqual(await snapshot(page),original);
  console.log('PASS malformed, unrelated, unsupported, and unreadable files preserve current data and safety copy');

  await selected(page);
  await page.evaluate(()=>{const storage=window.RegulaRusticaStorage;window.originalCommit=storage.backend.commit.bind(storage.backend);storage.backend.commit=async()=>{throw new Error('Safety disk full');};});
  await page.locator('#backupRestoreReplace').focus(); await page.keyboard.press('Enter'); await status(page,'Safety disk full');
  assert.equal((await snapshot(page)).working,original.working);
  assert.equal(await page.evaluate(async()=>JSON.parse((await window.RegulaRusticaStorage.backend.readAll()).get('regulaRusticaV5')).settings.homesteadName),'Current test Homestead');
  await page.evaluate(()=>{window.RegulaRusticaStorage.backend.commit=window.originalCommit;});
  await page.reload(); await ready(page); await openControls(page);
  assert.equal((await snapshot(page)).safety,original.safety);
  console.log('PASS failed safety-copy commit prevents replacement and retains committed prior safety bytes');

  await selected(page);
  await page.evaluate(()=>{
    const storage=window.RegulaRusticaStorage;const read=storage.backend.readAll.bind(storage.backend);
    window.originalRead=read; storage.backend.readAll=async()=>{const values=await read();values.set('regulaRusticaBeforeImport','{}');return values;};
  });
  await page.locator('#backupRestoreReplace').click(); await status(page,'could not be verified');
  assert.equal((await snapshot(page)).working,original.working);
  await page.evaluate(()=>{window.RegulaRusticaStorage.backend.readAll=window.originalRead;});
  console.log('PASS safety verification mismatch prevents replacement');

  await selected(page);
  await page.evaluate(()=>{
    const storage=window.RegulaRusticaStorage;const commit=storage.backend.commit.bind(storage.backend);window.safetyCommits=0;
    storage.backend.commit=async batch=>{if(batch.has('regulaRusticaBeforeImport')){window.safetyCommits++;await new Promise(resolve=>window.releaseRestore=resolve);}return commit(batch);};
    document.querySelector('#backupRestoreReplace').click();document.querySelector('#backupRestoreReplace').click();
  });
  await page.waitForFunction(()=>typeof window.releaseRestore==='function');
  assert.equal(await page.evaluate(()=>window.safetyCommits),1);
  assert.equal((await snapshot(page)).working,original.working);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#backupRestoreConfirm').isVisible(),true);
  await page.evaluate(()=>window.releaseRestore()); await status(page,'Backup restored');
  assert.equal(await page.evaluate(()=>window.RegulaRusticaLocal.read().settings.homesteadName),incoming.settings.homesteadName);
  assert.equal(await page.evaluate(()=>JSON.parse(window.RegulaRusticaStorage.getItem('regulaRusticaBeforeImport')).rawValue),original.working);
  const downloadPromise=page.waitForEvent('download');await page.locator('#downloadBeforeRestore').click();
  const download=await downloadPromise;assert.equal(await readFile(await download.path(),'utf8'),original.working);
  await page.reload();await ready(page);await openControls(page);
  assert.equal(await page.evaluate(()=>window.RegulaRusticaLocal.read().settings.homesteadName),incoming.settings.homesteadName);
  assert.equal(await page.locator('#downloadBeforeRestore').isVisible(),true);
  assert.ok((await page.locator('#downloadBeforeRestore').boundingBox()).height>=44);
  assert.ok((await page.locator('#restoreBackup').boundingBox()).height>=44);
  console.log('PASS duplicate confirmation commits one verified safety copy; restored data and downloadable prior work survive reload');

  const beforeInterrupted=await snapshot(page); await selected(page, fixture('Interrupted incoming Homestead'));
  await page.evaluate(()=>{const storage=window.RegulaRusticaStorage;const commit=storage.backend.commit.bind(storage.backend);window.repairCommit=commit;storage.backend.commit=async batch=>{if(batch.has('regulaRusticaV5'))throw new Error('Interrupted replacement');return commit(batch);};});
  await page.locator('#backupRestoreReplace').click(); await status(page,'Interrupted replacement');
  assert.ok(!(await page.locator('#backupRestoreStatus').textContent()).startsWith('Backup restored'));
  assert.equal((await snapshot(page)).working,beforeInterrupted.working);
  assert.equal((await snapshot(page)).stored,beforeInterrupted.working);
  assert.equal(await page.evaluate(async()=>JSON.stringify(JSON.parse((await window.RegulaRusticaStorage.backend.readAll()).get('regulaRusticaV5')))),beforeInterrupted.stored);
  assert.equal(await page.evaluate(()=>JSON.parse(window.RegulaRusticaStorage.getItem('regulaRusticaBeforeImport')).rawValue),beforeInterrupted.working);
  await page.evaluate(async()=>{
    const storage=window.RegulaRusticaStorage; storage.backend.commit=window.repairCommit;
    await window.RegulaRusticaLocal.write(window.RegulaRusticaLocal.read(),'ordinary-save-after-restore-failure');
    await storage.flush();
  });
  assert.equal((await snapshot(page)).working,beforeInterrupted.working);
  assert.equal((await snapshot(page)).stored,beforeInterrupted.working);
  assert.equal(await page.evaluate(async()=>(await window.RegulaRusticaStorage.backend.readAll()).get('regulaRusticaV5')),beforeInterrupted.working);
  await selected(page,fixture('Second confirmed Homestead'));
  await page.locator('#backupRestoreReplace').click();await status(page,'Backup restored');
  assert.equal(await page.evaluate(()=>window.RegulaRusticaLocal.read().settings.homesteadName),'Second confirmed Homestead');
  assert.equal(await page.evaluate(()=>JSON.parse(window.RegulaRusticaStorage.getItem('regulaRusticaBeforeImport')).rawValue),beforeInterrupted.working);
  const retryDownloadPromise=page.waitForEvent('download');await page.locator('#downloadBeforeRestore').click();
  assert.equal(await readFile(await (await retryDownloadPromise).path(),'utf8'),beforeInterrupted.working);
  assert.deepEqual(errors,[]);
  console.log('PASS interrupted replacement restores working/staged bytes; ordinary save and same-session restore retry preserve downloadable original work');
  await context.close();
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
