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
    const focusedScreen=(await srv.api('/api/screen')).body;
    assert.equal((await srv.api('/api/action',{kind:'type_focused',text:'1234'})).status,409);
    assert.equal((await srv.api('/api/action',{kind:'type_focused',text:'',screenId:focusedScreen.screenId})).status,400);
    const typed=await srv.api('/api/action',{kind:'type_focused',text:'1234',screenId:focusedScreen.screenId,capturePolicy:'fast'});
    assert.equal(typed.status,200);assert.equal(typed.body.timings.policy,'fast');
    assert.equal((await srv.api('/api/action',{kind:'type_focused',text:'1234',screenId:focusedScreen.screenId})).status,409);
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
test('Quick type submits the entire value once, captures once, and stores only a secret reference', {timeout:60_000,skip:!pw?'Requires Playwright; skipped, not passed':false},async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vortex-quick-type-'));
  const srv=await startServer(path.join(tmp,'state'),path.join(tmp,'out'));
  const browser=await pw.chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1600,height:1000}});
    const actions:any[]=[];let extraScreens=0;
    page.on('request',(request:any)=>{
      if(request.url().endsWith('/api/action'))actions.push(request.postDataJSON());
      if(request.url().endsWith('/api/screen'))extraScreens++;
    });
    await page.goto(srv.base);await page.locator('#inspectList button').first().waitFor();
    const initialScreens=extraScreens;
    await page.locator('#capturePolicy').selectOption('stable');
    await page.locator('#modeQuickType').click();
    await page.locator('#textInputValue').fill('1234');
    await page.locator('#textInputDlg button[value="submit"]').click();
    await page.waitForFunction("document.querySelectorAll('#steps .step').length===1");
    assert.equal(actions.length,1);assert.equal(actions[0].kind,'type_focused');
    assert.equal(actions[0].text,'1234');assert.equal(actions[0].capturePolicy,'fast');
    assert.equal(extraScreens,initialScreens);
    let data=(await srv.api('/api/draft')).body.data;
    for(let n=0;n<30&&!data?.steps?.length;n++){await page.waitForTimeout(100);data=(await srv.api('/api/draft')).body.data;}
    assert.equal(data.steps[0].type,'type_focused');assert.equal(data.steps[0].secretEnv,'VORTEX_SECRET_FOCUSED_TEXT');
    assert.ok(!JSON.stringify(data).includes('1234'));
  }finally{await browser.close();await stopServer(srv.child);fs.rmSync(tmp,{recursive:true,force:true});}
});
test('keypad taps use the clicked point even when app controls overlap behind the keyboard', {timeout:60_000,skip:!pw?'Requires Playwright; skipped, not passed':false},async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vortex-keypad-ui-'));
  const srv=await startServer(path.join(tmp,'state'),path.join(tmp,'out'));
  const browser=await pw.chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1600,height:1000}});
    let tapped:any;
    page.on('request',(request:any)=>{if(request.url().endsWith('/api/action'))tapped=request.postDataJSON();});
    await page.route('**/api/screen',async(route:any)=>{
      const response=await route.fetch();const screen=await response.json();
      // The provider exposes overlapping app controls, with no keyboard keys.
      screen.nodes=[0,1].map(id=>({id,parentId:null,depth:0,type:'android.widget.Button',text:'Behind keyboard '+id,rect:{x:0,y:0,w:1080,h:2400},target:{kind:'testId',quality:100,expr:'screen.getByTestId("background")',parts:{by:'id',value:'background'}}}));
      await route.fulfill({response,json:screen});
    });
    await page.goto(srv.base);
    await page.locator('#inspectList button').first().waitFor();
    await page.locator('#modeKeypad').click();
    assert.equal(await page.locator('#tapStyle').inputValue(),'coord');
    const box=await page.locator('#ov').boundingBox();assert.ok(box);
    await page.locator('#ov').click({position:{x:box.width/2,y:box.height*0.79}});
    await page.waitForFunction("document.querySelectorAll('#steps .step').length===1");
    assert.equal(tapped.kind,'tap');
    assert.ok(Math.abs(tapped.x-540)<=2);assert.ok(Math.abs(tapped.y-1896)<=2);
    let data=(await srv.api('/api/draft')).body.data;
    for(let n=0;n<30&&!data?.steps?.length;n++){await page.waitForTimeout(100);data=(await srv.api('/api/draft')).body.data;}
    assert.equal(data.steps[0].target.kind,'coordinate');assert.equal(data.steps[0].mode,'coord');
    assert.equal(data.steps[0].x,tapped.x);assert.equal(data.steps[0].y,tapped.y);
    const generated=await srv.api('/api/project/preview',{steps:data.steps,name:'keypad',module:'regression',pkg:'com.yourname.tradehub',frameworks:['mobilewright'],mode:'plain'});
    assert.equal(generated.status,200);assert.ok(JSON.stringify(generated.body).includes(`screen.tap(${tapped.x}, ${tapped.y})`));
  }finally{await browser.close();await stopServer(srv.child);fs.rmSync(tmp,{recursive:true,force:true});}
});
test('autocomplete capture opens Type, records text and generates fill', {timeout:60_000,skip:!pw?'Requires Playwright; skipped, not passed':false},async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vortex-autocomplete-ui-'));
  const srv=await startServer(path.join(tmp,'state'),path.join(tmp,'out'));
  const browser=await pw.chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1600,height:1000}});
    const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
    // Simulated TradeHub: reproduce the concrete autocomplete class at the
    // HTTP capture boundary without changing a real device or account.
    await page.route('**/api/screen',async(route:any)=>{
      const response=await route.fetch();const screen=await response.json();
      const input=screen.nodes.find((n:any)=>n.identifier?.endsWith('home_search_input'));
      assert.ok(input);input.type='android.widget.AutoCompleteTextView';
      await route.fulfill({response,json:screen});
    });
    await page.goto(srv.base);
    await page.locator('#inspectSearch').fill('home_search_input');
    await page.locator('#inspectList button').first().click();
    await page.locator('[data-ins-action="type"]').click();
    await page.locator('#textInputValue').fill('autocomplete regression');
    await page.locator('#textInputDlg button[value="submit"]').click();
    await page.waitForFunction("document.querySelectorAll('#steps .step').length===1");
    assert.match(await page.locator('#steps').innerText(),/Type into/);
    let data=(await srv.api('/api/draft')).body.data;
    for(let n=0;n<30&&!data?.steps?.length;n++){await page.waitForTimeout(100);data=(await srv.api('/api/draft')).body.data;}
    assert.equal(data.steps[0].type,'type');
    assert.equal(data.steps[0].args.text,'autocomplete regression');
    const generated=await srv.api('/api/project/preview',{steps:data.steps,name:'autocomplete',module:'regression',pkg:'com.yourname.tradehub',frameworks:['mobilewright'],mode:'plain'});
    assert.equal(generated.status,200);
    assert.ok(JSON.stringify(generated.body).includes('.fill('));
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await stopServer(srv.child);fs.rmSync(tmp,{recursive:true,force:true});}
});
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
