import assert from 'node:assert/strict';
import { test } from 'node:test';
import ts from 'typescript';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRealDevice } from '../src/device.js';
import { parseAdbCommand, formatAdbCommand, adbTransportArgs, adbTimeout } from '../public/adb-tools.js';
import { safeDraft,editStep } from '../public/recording-tools.js';
import { captureEvidence } from '../src/capture-evidence.js';
import { fromUiSteps,toUiSteps } from '../src/model/recording.ts';
import { generateMobilewrightPlain,generateMobilewrightPom } from '../src/engines/mobilewright/ts-codegen.ts';

const meta={id:'adb-tests',name:'ADB shortcuts',module:'adb',appPackage:'com.example.app',serial:'emulator-5554',screen:{width:1080,height:2400},version:'test'};
test('an explicit Mobilecli alias is used for the tree while the ADB serial remains selected',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vortex-cli-alias-'));
  try{
    const cli=path.join(dir,'cli.mjs');
    fs.writeFileSync(cli,'console.log(JSON.stringify({elements:[{type:"TextView",text:process.argv.at(-1),identifier:"com.example.app:id/alias",rect:{x:0,y:0,width:10,height:10}}]}));');
    const device=await createRealDevice({serial:'emulator-selected',mobilecliDevice:'Explicit Emulator Alias',mobilecli:cli,treeSource:'mobilecli'});
    assert.equal((await device.tree())[0].text,'Explicit Emulator Alias');assert.equal(device.serial,'emulator-selected');
  }finally{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});
test('full captures take their screenshot after a slow hierarchy has finished',async()=>{
  let screen='before';const order=[];
  const result=await captureEvidence({tree:async()=>{await new Promise(r=>setTimeout(r,20));screen='after';order.push('tree');return['new control'];},screenshot:async()=>{order.push('image');return Buffer.from(screen);}});
  assert.deepEqual(order,['tree','image']);assert.equal(result.shot.toString(),'after');assert.deepEqual(result.raw,['new control']);assert.ok(result.capturedAt);
});
test('ADB editor preserves originals, moves a secret placeholder and validates timeout limits',()=>{
  const original=[{type:'adb_command',args:{commandArgs:['shell','input','text','<secret>'],secretIndex:3},secretEnv:'VORTEX_SECRET_ADB_TEXT'}];
  const edited=editStep(original,0,{commandArgs:['shell','am','start','-d','<secret>'],timeoutMs:60000});
  assert.equal(edited[0].args.timeoutMs,60000);assert.equal(original[0].args.timeoutMs,undefined);assert.equal(edited[0].args.secretIndex,4);
  assert.throws(()=>editStep(original,0,{commandArgs:['shell','input','text','plaintext-secret']}),/exactly one/);
  for(const timeout of [0,999,300001,Infinity])assert.throws(()=>adbTimeout(timeout),/timeout/);
  assert.equal(adbTimeout(300000),300000);
});
test('pasted commands preserve quoted arguments and bind to the selected device',()=>{
  assert.deepEqual(parseAdbCommand('adb -s emulator-5554 shell input text "hello world"','emulator-5554'),['shell','input','text','hello world']);
  assert.deepEqual(parseAdbCommand('push "C:\\Users\\Test User\\photo.png" /sdcard/photo.png'),['push','C:\\Users\\Test User\\photo.png','/sdcard/photo.png']);
  assert.deepEqual(parseAdbCommand('["shell","wm","size"]'),['shell','wm','size']);
  assert.throws(()=>parseAdbCommand('adb -s another-device shell wm size','emulator-5554'),/another device/);
  assert.throws(()=>parseAdbCommand('adb -H remote shell wm size'),/device-selection/);
  assert.throws(()=>parseAdbCommand('shell input text "unclosed'),/quoted/);
  assert.throws(()=>parseAdbCommand('["shell",3]'),/arguments/);
  assert.deepEqual(adbTransportArgs(['shell','input','text','hello world']),['shell','input','text','hello%sworld']);
  assert.equal(formatAdbCommand(['shell','wm','size'],'emulator-5554'),'adb -s emulator-5554 shell wm size');
  assert.deepEqual(parseAdbCommand(formatAdbCommand(['shell','input','text','hello world'],'emulator-5554'),'emulator-5554'),['shell','input','text','hello world']);
  assert.match(adbTransportArgs(['shell','input','text',"a'; echo unexpected"])[3],/^'/);
});
test('sensitive ADB arguments are removed from drafts, recording files and both script variants',()=>{
  const step={type:'adb_command',args:{commandArgs:['shell','input','text','do-not-store'],secretIndex:3},secretEnv:'VORTEX_SECRET_ADB_TEXT'};
  const draft=safeDraft({steps:[step]});assert.equal(draft.steps[0].args.commandArgs[3],'<secret>');assert.equal(step.args.commandArgs[3],'do-not-store');
  const recording=fromUiSteps([step],meta);assert.ok(!JSON.stringify(recording).includes('do-not-store'));
  assert.equal(toUiSteps(recording)[0].args.secretIndex,3);
  for(const generator of [generateMobilewrightPlain,generateMobilewrightPom]){
    const output=generator(recording,{caseSlug:'adb',size:meta.screen});assert.deepEqual(output.issues,[]);
    const code=output.files.map(file=>file.content).join('\n');
    assert.ok(!code.includes('do-not-store'));assert.match(code,/VORTEX_SECRET_ADB_TEXT/);assert.match(code,/execAdb\("adb", \["-s", serial/);
  }
});
test('exported ADB helper targets the runtime serial, quotes remote arguments and refuses simulated hardware access',async()=>{
  const code=generateMobilewrightPlain(fromUiSteps([{type:'adb_command',args:{commandArgs:['shell','wm','size']}}],meta),{caseSlug:'adb',size:meta.screen}).files[0].content;
  const file=ts.createSourceFile('adb.ts',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const source=file.statements.filter(s=>ts.isFunctionDeclaration(s)&&['adbCommand','adbTransportArgs'].includes(s.name?.text)).map(s=>s.getText(file)).join('\n');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const calls=[];const run=new Function('execAdb','test',js+'\nreturn adbCommand;')(async(...args)=>{calls.push(args);return{stdout:Buffer.alloc(0)};},{});
  const serial=process.env.VORTEX_ADB_SERIAL, simulated=process.env.VORTEX_SIMULATED_ADB;
  try{
    delete process.env.VORTEX_ADB_SERIAL;delete process.env.VORTEX_SIMULATED_ADB;
    await assert.rejects(()=>run(['shell','wm','size']),/VORTEX_ADB_SERIAL/);assert.equal(calls.length,0);
    process.env.VORTEX_ADB_SERIAL='emulator-5588';process.env.VORTEX_SIMULATED_ADB='1';
    await assert.rejects(()=>run(['shell','wm','size']),/simulated replay/);assert.equal(calls.length,0);
    process.env.VORTEX_SIMULATED_ADB='0';await run(['shell','input','text','<secret>'],3,'hello world',60000);
    assert.deepEqual(calls[0][1],['-s','emulator-5588','shell','input','text','hello%sworld']);assert.equal(calls[0][2].shell,undefined);
    assert.equal(calls[0][2].timeout,60000);
  }finally{if(serial===undefined)delete process.env.VORTEX_ADB_SERIAL;else process.env.VORTEX_ADB_SERIAL=serial;if(simulated===undefined)delete process.env.VORTEX_SIMULATED_ADB;else process.env.VORTEX_SIMULATED_ADB=simulated;}
});
