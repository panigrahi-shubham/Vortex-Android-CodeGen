// Run the StockPilot example through Vortex's real MobileWright runner.
// Usage: node scripts/stockpilot-smoke.mjs --device emulator-5554
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDeviceManager, defaultAdb } from '../src/devices/device-manager.ts';
import { DeviceLeases } from '../src/devices/device-lease.ts';
import { detectMobilewright, MobilewrightRunner } from '../src/engines/mobilewright/runner.ts';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args=process.argv.slice(2), at=args.indexOf('--device');
const devices=createDeviceManager();
let serial=at>=0?args[at+1]:null;
if(!serial){
  const connected=(await devices.list()).filter(d=>d.state==='device');
  if(connected.length!==1)throw Error('Choose one connected Android device with --device <adb-serial>.');
  serial=connected[0].serial;
}
const device=await devices.details(serial);
const installed=await defaultAdb(['-s',serial,'shell','pm','path','com.stockpilot.b2b']);
if(!installed.trim().startsWith('package:'))throw Error('StockPilot (com.stockpilot.b2b) is not installed on the selected device.');
const testsDir=path.join(root,'generated');
const environment=detectMobilewright(testsDir);
if(!environment.ok)throw Error(environment.problems.join(' '));
const rel='stockpilot/home-smoke/mobilewright/plain/stockpilot-home-smoke.test.ts';
const file=path.join(testsDir,rel), source=fs.readFileSync(path.join(root,'examples','stockpilot-home-smoke.test.ts'),'utf8');
if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')!==source)throw Error(`The saved test was edited. It was kept unchanged: ${file}`);
fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);
const runner=new MobilewrightRunner({leases:new DeviceLeases(),runsDir:path.join(root,'.vortex','runs'),testDriverModule:null});
const started=await runner.start({testsDir,files:[rel],serial,deviceModel:device.model,androidVersion:device.androidVersion,deviceType:device.isEmulator?'emulator':'real',timeoutMs:120_000,reportDir:path.join(testsDir,'stockpilot','home-smoke','reports'),label:'StockPilot home smoke'});
console.log(`StockPilot smoke on ${serial} (${device.model}, Android ${device.androidVersion}); real device backend, no simulated driver.`);
const result=await runner.wait(started.id), run=runner.get(started.id);
console.log(run.output);
console.log(JSON.stringify({id:started.id,status:result.status,tests:result.tests,durationMs:result.durationMs,simulated:result.simulated,reportDir:run.dir},null,2));
if(result.status!=='passed')process.exitCode=1;
