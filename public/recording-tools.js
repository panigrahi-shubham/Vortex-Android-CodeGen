// Shared, side-effect-free recording edits and review rules. No device commands live here.
const copy = value => structuredClone(value);
const TYPES = new Set(['id','label','text','type','scoped','css','xpath']);
export function locatorExpression(parts,base='screen') {
  if(parts.by==='scoped'){
    let expression=`${base}.getByTestId(${JSON.stringify(parts.container)}).filter({ has: ${base}.getByText(${JSON.stringify(parts.anchorText)}, { exact: true }) })`;
    if(parts.inner)expression+='.'+locatorExpression(parts.inner,'').replace(/^\./,'');
    return expression;
  }
  if(['css','xpath'].includes(parts.by))return `web.locator(${JSON.stringify((parts.by==='xpath'?'xpath=':'')+parts.value)})`;
  const method={id:'getByTestId',label:'getByLabel',text:'getByText',type:'getByType'}[parts.by];
  const exact=['label','text'].includes(parts.by)?', { exact: true }':'';
  return `${base}.${method}(${JSON.stringify(parts.value)}${exact})`+(parts.index!==undefined?`.nth(${parts.index})`:'');
}
export function validateParts(parts) {
  if (!parts || !TYPES.has(parts.by)) throw Error('Choose a supported locator strategy.');
  if (parts.by === 'scoped') {
    if (!String(parts.container || '').trim() || !String(parts.anchorText || '').trim()) throw Error('A scoped locator needs a container ID and anchor text.');
    if (parts.inner && (!['id','label','text'].includes(parts.inner.by) || !String(parts.inner.value || '').trim())) throw Error('The inner locator must have an ID, label or text value.');
  } else if (!String(parts.value || '').trim()) throw Error('Locator value cannot be empty.');
  if (parts.index !== undefined && (!Number.isInteger(parts.index) || parts.index < 0)) throw Error('Locator index must be a nonnegative integer.');
  return copy(parts);
}
export function editStep(list, index, patch) {
  if (!list[index]) throw Error('This step no longer exists.');
  const next=copy(list), step=next[index];
  if (patch.title !== undefined) step.title=String(patch.title);
  if (patch.comment !== undefined) step.comment=String(patch.comment);
  if (patch.text !== undefined) {
    if (step.type !== 'type' || step.secretEnv) throw Error('Sensitive input uses its environment variable. Clear text cannot be stored here.');
    step.args={...step.args,text:String(patch.text)};
  }
  if (patch.expected !== undefined) {
    if (step.type !== 'assert') throw Error('Only assertion steps have an expected value.');
    const expected=step.args?.assertion==='count'?Number(patch.expected):String(patch.expected);
    if (step.args?.assertion==='count' && (!Number.isInteger(expected) || expected<0)) throw Error('Expected count must be a nonnegative integer.');
    step.args={...step.args,expected};
  }
  if (patch.ms !== undefined) {
    const ms=Number(patch.ms); if(step.type!=='sleep'||!Number.isFinite(ms)||ms<0||ms>300000)throw Error('Wait must be between 0 and 300000 ms.');
    step.args={...step.args,ms};
  }
  if (patch.parts !== undefined) {
    const parts=validateParts(patch.parts);
    if (step.context!=='WEBVIEW'&&['css','xpath'].includes(parts.by)) throw Error('Native MobileWright locators use ID, label, text, type or scope.');
    step.target={...step.target,parts,expr:locatorExpression(parts),kind:parts.by==='id'?'testId':parts.index!==undefined?'nth':parts.by};
    if(list[index].target?.kind==='coordinate'){step.mode='name';step.pre=true;}
  }
  return next;
}
export function moveStep(list,index,offset) {
  const next=copy(list), to=index+offset;
  if(!next[index]||to<0||to>=next.length)return next;
  const [step]=next.splice(index,1);next.splice(to,0,step);return next;
}
export function duplicateStep(list,index) {
  if(!list[index])throw Error('This step no longer exists.');
  const next=copy(list), step=copy(list[index]);step.id=crypto.randomUUID();delete step.at;
  next.splice(index+1,0,step);return next;
}
export function hitCandidates(nodes,x,y) {
  return nodes.filter(n=>n.visible!==false&&n.rect.w>0&&n.rect.h>0&&x>=n.rect.x&&x<n.rect.x+n.rect.w&&y>=n.rect.y&&y<n.rect.y+n.rect.h)
    .sort((a,b)=>a.rect.w*a.rect.h-b.rect.w*b.rect.h||b.depth-a.depth||b.id-a.id);
}
export function ambiguousHit(nodes,candidates) {
  const selected=candidates[0];if(!selected)return false;
  const ancestor=(a,b)=>{let n=b;const seen=new Set();while(n&&n.parentId!==null&&!seen.has(n.parentId)){seen.add(n.parentId);if(n.parentId===a.id)return true;n=nodes.find(x=>x.id===n.parentId);}return false;};
  return candidates.slice(1).some(n=>!ancestor(n,selected)&&!ancestor(selected,n)&&(n.text||n.label||/EditText|TextField|Button/i.test(n.type)));
}
export function reviewRecording(steps) {
  const issues=[];
  steps.forEach((s,i)=>{
    const coordinate=s.target?.kind==='coordinate'||s.mode==='coord';
    if(coordinate){
      const before=steps[i-1], after=steps[i+1];
      if(!before||!['assert','wait_visible'].includes(before.type))issues.push({step:i+1,code:'COORDINATE_PRECHECK',message:'Add a relevant assertion before this coordinate action.'});
      if(!(s.post?.length||(s.sugg||[]).some(x=>x.on)||after?.type==='assert'||after?.type==='wait_visible'))issues.push({step:i+1,code:'COORDINATE_RESULT',message:'Add a destination or result assertion after this coordinate action.'});
    }
    if(s.target?.parts?.index!==undefined)issues.push({step:i+1,code:'POSITIONAL_LOCATOR',message:'This locator depends on row/field order. Prefer a product-specific scope when possible.'});
    if(s.mode==='both')issues.push({step:i+1,code:'COORDINATE_FALLBACK',message:'The coordinate fallback is used only when the locator is absent. A failed delivered tap is never repeated.'});
    if(s.type==='launch_app'&&i===0)issues.push({step:1,code:'EXPLICIT_LAUNCH',message:'The generator uses this launch step without adding a duplicate startup launch.'});
  });
  return issues;
}
export function safeDraft(data) {
  const draft=copy(data);
  for(const s of draft.steps||[])if(s.secretEnv){s.args={...s.args};delete s.args.text;if(s.target?.evidence)s.target.evidence.text='';}
  return draft;
}
