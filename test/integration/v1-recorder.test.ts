import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadPlaywright } from '../fixtures/webview-host.mjs';
import { startServer,stopServer } from '../support/server.ts';

test('v1 HTTP draft revisions, fast captures, stale screens and mixed-app batch protection',async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vortex-v1-api-'));
  const srv=await startServer(path.join(tmp,'state'),path.join(tmp,'out'));
  try{
    const pkg='com.yourname.tradehub';
    assert.equal((await srv.api('/api/draft')).body.revision,0);
    const draft={pkg,device:'mock-device',name:'draft',steps:[{type:'type',secretEnv:'VORTEX_SECRET_VALUE',args:{text:'never-store-me'}}]};
    assert.equal((await srv.api('/api/draft',{revision:0,data:draft})).status,200);
    assert.equal((await srv.api('/api/draft',{revision:0,data:draft})).status,409);
    assert.ok(!JSON.stringify((await srv.api('/api/draft')).body).includes('never-store-me'));
    const screen=(await srv.api('/api/screen')).body;
    const bad=await srv.api('/api/action',{kind:'tap',x:-1,y:20,screenId:screen.screenId});assert.equal(bad.status,400);
    const acted=await srv.api('/api/action',{kind:'tap',x:20,y:20,screenId:screen.screenId,capturePolicy:'fast'});
    assert.equal(acted.status,200);assert.equal(acted.body.timings.policy,'fast');assert.equal(acted.body.timings.stable,false);
    assert.ok(acted.body.timings.totalMs>=acted.body.timings.actionMs);
    assert.equal((await srv.api('/api/action',{kind:'tap',x:20,y:20,screenId:screen.screenId})).status,409);
    const steps=[{type:'launch_app'}];
    for(const [name,app] of [['one',pkg],['two','com.other.app']]){
      assert.equal((await srv.api('/api/project/save',{steps,name,module:'v1',pkg:app,frameworks:['mobilewright'],mode:'plain'})).status,200);
    }
    const run=await srv.api('/api/runs',{engine:'mobilewright',scope:'all'});
    assert.equal(run.status,409);assert.equal(run.body.code,'MIXED_APP_BATCH');
  }finally{await stopServer(srv.child);fs.rmSync(tmp,{recursive:true,force:true});}
});

// The browser and actual MobileWright runner use simulated TradeHub data; no phone or account is mutated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pw=loadPlaywright() as any;
const project=process.env.VORTEX_MOBILEWRIGHT_DIR;
test('v1 browser: record, edit, reorder, restore server draft, save and replay', {timeout:120_000,skip:!pw||!project?'Requires VORTEX_PLAYWRIGHT and VORTEX_MOBILEWRIGHT_DIR; skipped, not passed':false},async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vortex-v1-ui-'));
  const out=fs.mkdtempSync(path.join(project!,'.vortex-v1-ui-'));
  const srv=await startServer(path.join(tmp,'state'),out);
  const browser=await pw.chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1600,height:1000}});
    const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
    page.on('dialog',(d:{type():string;accept(v?:string):Promise<void>})=>d.accept(d.type()==='prompt'?'brass':undefined));
    await page.goto(srv.base);
    await page.locator('#inspectSearch').fill('home_search_input');
    await page.locator('#inspectList button').first().click();
    await page.locator('[data-ins-action="type"]').click();
    await page.locator('#textInputValue').fill('steel');
    await page.locator('#textInputDlg button[value="submit"]').click();
    await page.waitForFunction("document.querySelectorAll('#steps .step').length===1");
    await page.locator('[data-edit="0"]').click();await page.locator('#editText').fill('brass');
    await page.locator('#stepEditForm button[type="submit"]').click();
    assert.match(await page.locator('#steps').innerText(),/brass/);
    await page.locator('[data-duplicate="0"]').click();
    await page.locator('[data-move="1"][data-offset="-1"]').click();
    await page.locator('[data-del="1"]').click();
    await page.locator('#inspectSearch').fill('home_search_input');await page.locator('#inspectList button').first().click();
    await page.locator('[data-check-at="0"][data-side="after"]').click();
    await page.waitForFunction("document.querySelectorAll('#steps .step').length===2");
    for(let n=0;n<40;n++){const draft=await srv.api('/api/draft');if(draft.body.data?.steps?.length===2)break;await page.waitForTimeout(100);}
    assert.equal((await srv.api('/api/draft')).body.data.steps.length,2);
    await page.evaluate(()=>localStorage.clear());await page.reload();
    await page.locator('#btnRestore').click();
    await page.waitForFunction("document.querySelectorAll('#steps .step').length===2");
    await page.locator('#tname').fill('v1 browser edits');await page.locator('#tmodule').fill('v1');
    await page.locator('#mode').selectOption('both');await page.locator('#btnSave').click();
    await page.locator('[data-runnow="mobilewright"]').click();
    await page.waitForFunction("document.querySelector('#rResult')?.textContent?.includes('PASSED')",{},{timeout:45_000});
    assert.deepEqual(errors,[]);
    await page.locator('#runDlg button[data-close]').click();
    if(await page.locator('#saveDlg').evaluate((node:{open:boolean})=>node.open))await page.locator('#saveDlg button[data-close]').click();
    await page.screenshot({path:path.join(os.tmpdir(),'vortex-mobilewright-v1-ui.png'),fullPage:true});
  }finally{await browser.close();await stopServer(srv.child);fs.rmSync(tmp,{recursive:true,force:true});fs.rmSync(out,{recursive:true,force:true});}
});
