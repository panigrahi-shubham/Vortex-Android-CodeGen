import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { editStep,moveStep,duplicateStep,hitCandidates,ambiguousHit,reviewRecording } from '../public/recording-tools.js';
import { createDraftStore } from '../src/draft-store.js';
import { generateMobilewrightPlain,generateMobilewrightPom } from '../src/engines/mobilewright/ts-codegen.ts';
import { fromUiSteps } from '../src/model/recording.ts';

const pkg='com.yourname.tradehub', size={width:1080,height:2400};
const input={type:'type',title:'Price',target:{kind:'testId',parts:{by:'id',value:'price'}},args:{text:'5000'}};
function rec(steps){return fromUiSteps(steps,{id:'v1-tests',name:'v1 safety',module:'v1',appPackage:pkg,serial:'mock-device',screen:size,version:'1.0.0-rc.1'});}
const generate=steps=>generateMobilewrightPlain(rec(steps),{caseSlug:'v1',size}).files[0].content;
function helpers(code,names){
  const file=ts.createSourceFile('generated.ts',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const functions=file.statements.filter(x=>ts.isFunctionDeclaration(x)&&names.includes(x.name?.text)).map(x=>x.getText(file)).join('\n');
  const js=ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  return new Function(js+'\nreturn {'+names.join(',')+'};')();
}
test('step editing, duplication and reordering preserve originals and reject storing secrets',()=>{
  const list=[input,{type:'assert',args:{assertion:'count',expected:1},target:input.target}];
  const edited=editStep(list,0,{text:'2000',parts:{by:'id',value:'new-price'}});
  assert.equal(list[0].args.text,'5000');assert.equal(edited[0].args.text,'2000');
  assert.match(edited[0].target.expr,/new-price/);assert.ok(!edited[0].target.expr.includes('5000'));
  const doubled=duplicateStep(edited,0);assert.equal(doubled.length,3);assert.notEqual(doubled[0].id,doubled[1].id);
  doubled[1].args.text='other';assert.equal(doubled[0].args.text,'2000');
  assert.equal(moveStep(doubled,1,-1)[0].args.text,'other');
  assert.throws(()=>editStep([{...input,secretEnv:'VORTEX_SECRET_PRICE'}],0,{text:'secret'}),/Sensitive/);
  assert.throws(()=>editStep(list,1,{expected:-1}),/nonnegative/);
  assert.throws(()=>editStep(list,0,{parts:{by:'id',value:''}}),/empty/);
});
test('overlapping sibling controls require a choice; ancestors alone are not ambiguous',()=>{
  const root={id:0,parentId:null,depth:0,type:'Layout',rect:{x:0,y:0,w:100,h:100}};
  const button={id:1,parentId:0,depth:1,type:'Button',text:'Save',rect:{x:5,y:5,w:40,h:40}};
  const background={id:2,parentId:0,depth:1,type:'Button',text:'Delete',rect:{x:10,y:10,w:35,h:35}};
  const nodes=[root,button];assert.equal(ambiguousHit(nodes,hitCandidates(nodes,20,20)),false);
  nodes.push(background);assert.equal(ambiguousHit(nodes,hitCandidates(nodes,20,20)),true);
  assert.ok(!hitCandidates([...nodes,{...button,id:3,visible:false}],20,20).some(n=>n.id===3));
});
test('server draft survives a new store, strips sensitive input and rejects stale-tab writes',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vortex-v1-draft-'));
  try{
    const store=createDraftStore(dir);
    const data={pkg,device:'mock-device',steps:[{...input,secretEnv:'VORTEX_SECRET_PRICE',args:{text:'do-not-store'},target:{...input.target,evidence:{text:'do-not-store'}}}]};
    assert.equal(store.read().revision,0);store.write(data,0);
    const stored=JSON.stringify(createDraftStore(dir).read());assert.ok(!stored.includes('do-not-store'));
    assert.ok(stored.includes('VORTEX_SECRET_PRICE'));
    assert.throws(()=>store.write(data,0),e=>e.code==='DRAFT_CONFLICT');
    store.write(null,1);assert.equal(store.read().data,null);
    assert.throws(()=>store.write(data,1),e=>e.code==='DRAFT_CONFLICT');
    fs.writeFileSync(path.join(dir,'recording-draft.json'),'broken');
    assert.throws(()=>store.read(),e=>e.code==='DRAFT_UNREADABLE');
    assert.equal(fs.readFileSync(path.join(dir,'recording-draft.json'),'utf8'),'broken');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('generated fallback does not repeat a delivered tap, and mismatched geometry sends no coordinate tap',async()=>{
  const code=generate([{type:'tap',target:input.target,mode:'both',x:50,y:50}]);
  const {tapOrAt}=helpers(code,['tapOrAt','assertCoordinateScreen']);
  let taps=0;
  await assert.rejects(()=>tapOrAt({tap:async()=>taps++},{exists:async()=>true,tap:async()=>{throw Error('delivered but disconnected');}},50,50),/disconnected/);
  assert.equal(taps,0);
  const png=Buffer.alloc(24);png.write('PNG',1);png.writeUInt32BE(2400,16);png.writeUInt32BE(1080,20);
  const screen={screenshot:async()=>png,tap:async()=>taps++};
  await assert.rejects(()=>tapOrAt(screen,{exists:async()=>false},50,50),/geometry changed/);assert.equal(taps,0);
  png.writeUInt32BE(1080,16);png.writeUInt32BE(2400,20);
  await tapOrAt(screen,{exists:async()=>false},50,50);assert.equal(taps,1);
});
test('explicit startup launch is emitted once and cleanup respects an explicit final close',()=>{
  const recording=rec([{type:'launch_app'},{type:'close_app'}]);
  for(const generate of [generateMobilewrightPlain,generateMobilewrightPom]){
    const generated=generate(recording,{caseSlug:'lifecycle',size});assert.deepEqual(generated.issues,[]);
    const entry=generated.files.find(f=>f.role==='entry').content;
    assert.equal((entry.match(/await device\.launchApp\(bundleId\)/g)||[]).length,1);
    assert.match(entry,/appClosed = true/);assert.match(entry,/if \(!appClosed\) await device\.terminateApp/);
  }
});
test('coordinate review requires relevant neighboring checks rather than arbitrary suggested counts',()=>{
  const tap={type:'tap',target:{kind:'coordinate'},x:10,y:10};
  assert.equal(reviewRecording([tap]).length,2);
  assert.equal(reviewRecording([{type:'assert'},tap,{type:'assert'}]).length,0);
});
