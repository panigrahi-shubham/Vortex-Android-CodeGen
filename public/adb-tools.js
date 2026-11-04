// Logical ADB arguments are kept separate from both the host and Android shells.
export function validateAdbArgs(args) {
  if (!Array.isArray(args) || !args.length || args.length > 128 || args.some(a => typeof a !== 'string' || a.includes('\0') || a.length > 16384) || !args[0] || args[0].startsWith('-')) throw Error('Enter an ADB subcommand and arguments, without device-selection flags.');
  return [...args];
}
export function adbTimeout(value = 15000) {
  const ms=Number(value);
  if(!Number.isInteger(ms)||ms<1000||ms>300000)throw Error('ADB timeout must be between 1000 and 300000 milliseconds.');
  return ms;
}
export function parseAdbCommand(command, serial = '') {
  const source=String(command).trim();
  if(source.startsWith('['))return validateAdbArgs(JSON.parse(source));
  const args=[];let value='',quote='',started=false;
  for(let i=0;i<source.length;i++){
    const c=source[i];
    if(c==='\\'&&i+1<source.length&&(source[i+1]===quote||source[i+1]==='\\'||!quote&&/[\s"']/.test(source[i+1]))){value+=source[++i];started=true;continue;}
    if(quote){if(c===quote)quote='';else value+=c;started=true;continue;}
    if(c==='"'||c==="'"){quote=c;started=true;continue;}
    if(/\s/.test(c)){if(started){args.push(value);value='';started=false;}continue;}
    value+=c;started=true;
  }
  if(quote)throw Error('Close the quoted argument before continuing.');
  if(started)args.push(value);
  const fullCommand=/(^|[\\/])adb(?:\.exe)?$/i.test(args[0]||'');
  if(fullCommand){
    args.shift();
    if(args[0]==='-s'){args.shift();const requested=args.shift();if(!requested||requested!==serial)throw Error('The pasted command targets another device. Select that device first or remove its -s option.');}
  }
  if(fullCommand&&args[0]==='shell'&&args[1]==='input'&&args[2]==='text'&&args.length===4)args[3]=args[3].replace(/%s/g,' ');
  return validateAdbArgs(args);
}
export function adbTransportArgs(args) {
  const out=[...args];
  if(out[0]==='shell'){
    if(out[1]==='input'&&out[2]==='text'&&out.length===4){
      if(out[3].includes('%s'))throw Error('ADB input text treats %s as a space. Use field typing for a literal %s.');
      out[3]=out[3].replace(/ /g,'%s');
    }
    const quote = value => /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : "'"+value.replace(/'/g,"'\\''")+"'";
    return ['shell',...out.slice(1).map(quote)];
  }
  return out;
}
export function formatAdbCommand(args,serial) {
  const ps = value => /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : "'"+value.replace(/'/g,"''")+"'";
  return ['adb',...serial?['-s',serial]:[],...adbTransportArgs(validateAdbArgs(args))].map(ps).join(' ');
}
export const ADB_PRESETS = [
  ['text','Type into focused field',['shell','input','text','']],
  ['key','Key event',['shell','input','keyevent','KEYCODE_ENTER']],
  ['back','Back',['shell','input','keyevent','KEYCODE_BACK']],
  ['home','Home',['shell','input','keyevent','KEYCODE_HOME']],
  ['recents','Recent apps',['shell','input','keyevent','KEYCODE_APP_SWITCH']],
  ['delete','Delete / Backspace',['shell','input','keyevent','KEYCODE_DEL']],
  ['clear','Clear focused field',['shell','sh','-c','input keycombination 113 29 && input keyevent 67']],
  ['tap','Tap coordinates',['shell','input','tap','100','200']],
  ['swipe','Swipe coordinates',['shell','input','swipe','500','1800','500','600','300']],
  ['longpress','Long press',['shell','input','swipe','100','200','100','200','900']],
  ['launch','Launch app',['shell','monkey','-p','{package}','-c','android.intent.category.LAUNCHER','1']],
  ['close','Close app',['shell','am','force-stop','{package}']],
  ['link','Open URL / deep link',['shell','am','start','-a','android.intent.action.VIEW','-d','https://example.com','{package}']],
  ['screenshot','Screenshot (PNG output)',['exec-out','screencap','-p']],
  ['size','Screen size',['shell','wm','size']],
  ['focus','Focused activity',['shell','dumpsys','activity','activities']],
  ['keyboard','Keyboard status',['shell','dumpsys','input_method']],
  ['apps','Installed packages',['shell','pm','list','packages']],
  ['properties','Device properties',['shell','getprop']],
  ['custom','Custom command',[]],
];
