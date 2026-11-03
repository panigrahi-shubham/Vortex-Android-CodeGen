import fs from 'node:fs';
import path from 'node:path';
import { safeDraft } from '../public/recording-tools.js';

const fail=(message,code='BAD_DRAFT',httpStatus=400)=>Object.assign(new Error(message),{code,httpStatus});
export function createDraftStore(dir) {
  const file=path.join(dir,'recording-draft.json');
  const read=()=>{
    if(!fs.existsSync(file))return {revision:0,data:null};
    try {
      const value=JSON.parse(fs.readFileSync(file,'utf8'));
      if(!Number.isInteger(value.revision)||value.revision<0)throw Error('bad revision');
      return value;
    }catch{throw fail('The saved draft is unreadable. It has been left unchanged for recovery.','DRAFT_UNREADABLE',409);}
  };
  function write(data,revision){
    const current=read();
    if(!Number.isInteger(revision)||revision!==current.revision)throw fail('Another browser changed the draft. Reload to review its recording before saving yours.','DRAFT_CONFLICT',409);
    if(data!==null){
      if(!data||!Array.isArray(data.steps)||data.steps.length>5000)throw fail('A draft supports up to 5000 steps.');
      if(!data.steps.every(s=>s&&typeof s==='object'&&!Array.isArray(s)&&typeof s.type==='string'))throw fail('Every draft step must have an action type.');
      if(!/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(data.pkg||''))throw fail('The draft needs its Android app package.');
      if(typeof data.device!=='string'||data.device.length>128)throw fail('The draft needs its device identity.');
      data=safeDraft(data);
    }
    const result={revision:current.revision+1,data,updatedAt:new Date().toISOString()};
    const text=JSON.stringify(result);
    if(Buffer.byteLength(text)>8*1024*1024)throw fail('Draft is larger than 8 MB. Save the recording to the project.','DRAFT_TOO_LARGE',413);
    fs.mkdirSync(dir,{recursive:true});
    const temp=`${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp,text,'utf8');fs.renameSync(temp,file);
    return result;
  }
  return {read,write};
}
