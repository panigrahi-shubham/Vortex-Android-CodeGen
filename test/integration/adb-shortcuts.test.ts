import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadPlaywright } from '../fixtures/webview-host.mjs';
import { startServer,stopServer } from '../support/server.ts';

test('ADB API skips capture, returns output, accepts another command and invalidates screen actions',async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vortex-adb-api-'));
  const srv=await startServer(path.join(tmp,'state'),path.join(tmp,'out'));
  try{
    const result=await srv.api('/api/action',{kind:'adb_command',commandArgs:['shell','wm','size']});
    assert.equal(result.status,200);assert.equal(result.body.captureSkipped,true);assert.equal(result.body.screen,null);
    assert.equal(result.body.timings.captureMs,0);assert.match(result.body.output.text,/Simulated/);
    assert.equal((await srv.api('/api/action',{kind:'adb_command',commandArgs:['shell','getprop']})).status,200);
    assert.equal((await srv.api('/api/action',{kind:'key',key:'BACK'})).status,409);
    assert.equal((await srv.api('/api/action',{kind:'adb_command',commandArgs:['-s','other-device','shell','wm','size']})).status,400);
    const captured=await srv.api('/api/action',{kind:'adb_command',commandArgs:['shell','wm','size'],captureAfter:true});
    assert.equal(captured.status,200);assert.equal(captured.body.screen.appVisible,true);
    assert.equal((await srv.api('/api/action',{kind:'key',key:'BACK',screenId:captured.body.screen.screenId})).status,200);
    assert.equal((await srv.api('/api/action',{kind:'adb_command',commandArgs:['shell','wm','size'],timeoutMs:999})).status,400);
    const preview=await srv.api('/api/action',{kind:'adb_command',commandArgs:['shell','wm','size'],previewAfter:true,timeoutMs:60000});
    assert.equal(preview.status,200);assert.equal(preview.body.preview.previewOnly,true);assert.deepEqual(preview.body.preview.nodes,[]);
    assert.equal((await srv.api('/api/action',{kind:'key',key:'BACK'})).status,409);
    const direct=await srv.api('/api/preview',{});assert.equal(direct.status,200);assert.equal(direct.body.previewOnly,true);
    assert.ok((await srv.api('/api/screen')).body.nodes.length>0);
  }finally{await stopServer(srv.child);fs.rmSync(tmp,{recursive:true,force:true});}
});

const pw=loadPlaywright() as any;
test('ADB panel runs or records explicitly; Inspect and script copies contain the chosen content', {timeout:90_000,skip:!pw?'Playwright is unavailable; skipped, not passed':false},async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vortex-adb-ui-'));
  const srv=await startServer(path.join(tmp,'state'),path.join(tmp,'out'));
  const browser=await pw.chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1800,height:1200}});
    const errors:string[]=[];let actions=0,screens=0;
    page.on('pageerror',(error:Error)=>errors.push(error.message));
    page.on('request',(request:any)=>{if(request.url().endsWith('/api/action'))actions++;if(request.url().endsWith('/api/screen'))screens++;});
    await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{(globalThis as any).__copied=value;}}});});
    const copied=()=>page.evaluate(()=>(globalThis as any).__copied as string);
    await page.goto(srv.base);await page.locator('#inspectList button').first().waitFor();
    await page.locator('#inspectAutoCopy').selectOption('locator');
    await page.locator('#inspectSearch').fill('home_search_input');await page.locator('#inspectList button').first().click();
    assert.match(await copied(),/getByTestId/);
    await page.locator('[data-ins-copy="id"]').click();assert.equal(await copied(),'com.yourname.tradehub:id/home_search_input');
    await page.locator('[data-ins-copy="adb"]').click();assert.match(await copied(),/^adb -s mock-device shell input tap/);assert.equal(actions,0);
    await page.locator('#btnAdb').click();await page.locator('#adbPreset').selectOption('size');
    await page.locator('#adbCopy').click();assert.equal(await copied(),'adb -s mock-device shell wm size');
    await page.locator('#adbCopyStep').click();assert.match(await copied(),/adbCommand\(\["shell","wm","size"\]\)/);
    await page.locator('#adbAdd').click();assert.equal(actions,0);assert.equal(await page.locator('#steps .step').count(),1);
    await page.locator('#adbDlg [data-close]').click();await page.locator('[data-edit="0"]').click();
    await page.locator('#editAdbArgs').fill('["shell","getprop","ro.build.version.release"]');await page.locator('#editAdbTimeout').fill('60');await page.locator('#stepEditForm button[type="submit"]').click();
    assert.equal(actions,0);await page.locator('#btnAdb').click();await page.locator('#adbPreset').selectOption('size');
    const initialScreens=screens;
    await page.locator('#adbRun').evaluate((button:{click():void})=>{button.click();button.click();});await page.waitForFunction("document.querySelector('#adbStatus').textContent.includes('Run only ·')");
    assert.equal(actions,1);assert.equal(screens,initialScreens);assert.equal(await page.locator('#steps .step').count(),1);
    await page.locator('#adbRunRecord').click();await page.waitForFunction("document.querySelector('#adbStatus').textContent.includes('Run and recorded ·')");
    assert.equal(actions,2);assert.equal(await page.locator('#steps .step').count(),2);
    await page.locator('#adbPreset').selectOption('text');await page.locator('#adbText').fill('test-sensitive-value');await page.locator('#adbAdd').click();
    assert.equal(actions,2);assert.equal(await page.locator('#steps .step').count(),3);
    await page.locator('#adbDlg [data-close]').click();
    await page.locator('#btnCopyScript').click();
    await page.waitForFunction("window.__copied?.includes('async function adbCommand')");
    const script=await copied();assert.match(script,/async function adbCommand/);assert.match(script,/VORTEX_ADB_SERIAL/);assert.ok(!script.includes('test-sensitive-value'));assert.match(script,/VORTEX_SECRET_ADB_TEXT/);
    assert.match(script,/ro.build.version.release/);assert.match(script,/, 60000\)/);
    await page.locator('#mode').selectOption('both');await page.locator('#btnCopyAll').click();
    await page.waitForFunction("window.__copied?.includes('FILE: mobilewright/pom')");
    const all=await copied();assert.match(all,/FILE: mobilewright\/plain/);assert.match(all,/FILE: mobilewright\/pom/);
    let data=(await srv.api('/api/draft')).body.data;
    for(let i=0;i<30&&data?.steps?.length!==3;i++){await page.waitForTimeout(100);data=(await srv.api('/api/draft')).body.data;}
    assert.ok(!JSON.stringify(data).includes('test-sensitive-value'));assert.equal(data.steps[2].args.commandArgs[3],'<secret>');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await stopServer(srv.child);fs.rmSync(tmp,{recursive:true,force:true});}
});

test('screenshot-only preview clears hit targets until a full refresh', {timeout:45_000,skip:!pw?'Playwright is unavailable; skipped, not passed':false},async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'vortex-preview-ui-'));
  const srv=await startServer(path.join(tmp,'state'),path.join(tmp,'out'));
  const browser=await pw.chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1700,height:1100}});let actions=0;
    page.on('request',(request:any)=>{if(request.url().endsWith('/api/action'))actions++;});
    await page.goto(srv.base);await page.locator('#inspectList button').first().waitFor();
    await page.locator('#btnPreview').click();await page.waitForFunction("document.querySelector('#webStatus').textContent.includes('Screenshot preview only')");
    assert.equal(await page.locator('#inspectList button').count(),0);
    await page.locator('#btnBack').click();assert.equal(actions,0);
    await page.locator('#btnRefresh').click();await page.locator('#inspectList button').first().waitFor();
    assert.ok((await page.locator('#inspectList button').count())>0);
  }finally{await browser.close();await stopServer(srv.child);fs.rmSync(tmp,{recursive:true,force:true});}
});
