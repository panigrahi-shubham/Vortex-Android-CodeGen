/**
 * Feature: Device Manager (adb device discovery, device details, ABI reporting)
 * Layer: Unit — node:test
 * Real: adb output parsers, details assembly
 * Mocked: adb itself (captured outputs from USB phones, emulators and Wi-Fi devices)
 * Guards: Wrong USB/emulator classification, misreported ABIs, unauthorized devices treated as ready, unsafe serials
 * Run: npm run test:unit
 * Needs: Node.js 22.18+
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { abiFamily, assertSerial, createDeviceManager, detailsFrom, parseAdbDevices, parseGetprop, parseWmDensity, parseWmSize } from '../../src/devices/device-manager.ts';

const ADB_DEVICES = `List of devices attached
USBTEST123             device usb:1-1 product:rhode_g model:moto_g52 device:rhode transport_id:3
emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:4
192.168.1.40:5555      device product:panther model:Pixel_7 device:panther transport_id:5
R58N12ABCDE            unauthorized usb:1-2 transport_id:6
0123456789ABCDEF       offline transport_id:7
adb-R5CT-abc._adb-tls-connect._tcp device product:a54 model:SM_A546E device:a54x transport_id:8

`;

// Risk: Devices are misclassified, so the wrong one is used or an unauthorized phone looks ready.
// Given typical adb output, When parsed, Then serial, state, transport and model are correct for each line.
test('adb devices -l: USB, emulator, Wi-Fi, unauthorized and offline devices', () => {
  const d = parseAdbDevices(ADB_DEVICES);
  assert.deepEqual(d.map((x) => [x.serial, x.state, x.transport, x.model]), [
    ['USBTEST123', 'device', 'usb', 'moto_g52'],
    ['emulator-5554', 'device', 'emulator', 'sdk_gphone64_x86_64'],
    ['192.168.1.40:5555', 'device', 'network', 'Pixel_7'],
    ['R58N12ABCDE', 'unauthorized', 'usb', null],
    ['0123456789ABCDEF', 'offline', 'unknown', null],
    ['adb-R5CT-abc._adb-tls-connect._tcp', 'device', 'network', 'SM_A546E'],
  ]);
  assert.equal(d[0].transportId, '3');
});

// Risk: No devices / daemon start messages are parsed as devices.
// Given only the header and daemon messages, When parsed, Then the list is empty.
test('adb daemon messages and an empty list produce no devices', () => {
  assert.deepEqual(parseAdbDevices('* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n\n'), []);
});

const PROPS_ARM = `[ro.product.model]: [moto g52]
[ro.product.manufacturer]: [motorola]
[ro.build.version.release]: [13]
[ro.build.version.sdk]: [33]
[ro.product.cpu.abi]: [arm64-v8a]
[ro.product.cpu.abilist]: [arm64-v8a,armeabi-v7a,armeabi]
[ro.kernel.qemu]: []`;

const PROPS_X86 = `[ro.product.model]: [sdk_gphone64_x86_64]
[ro.build.version.release]: [14]
[ro.build.version.sdk]: [34]
[ro.product.cpu.abi]: [x86_64]
[ro.product.cpu.abilist]: [x86_64,arm64-v8a]
[ro.boot.qemu]: [1]`;

// Risk: ABIs are guessed or collapsed (the spec forbids blaming WebView failures on x86 without evidence).
// Given getprop output, When details are built, Then primary ABI, full ABI list and family come straight from the device.
test('device details keep the exact ABI list and distinguish arm64-v8a, armeabi-v7a, x86 and x86_64', () => {
  const usb = parseAdbDevices(ADB_DEVICES)[0];
  const a = detailsFrom(usb, parseGetprop(PROPS_ARM), 'Physical size: 1080x2400\n', 'Physical density: 400\n');
  assert.equal(a.primaryAbi, 'arm64-v8a');
  assert.deepEqual(a.abis, ['arm64-v8a', 'armeabi-v7a', 'armeabi']);
  assert.equal(a.abiFamily, 'arm');
  assert.equal(a.model, 'moto g52');
  assert.equal(a.manufacturer, 'motorola');
  assert.equal(a.androidVersion, '13');
  assert.equal(a.sdk, 33);
  assert.deepEqual(a.screen, { width: 1080, height: 2400, overridden: false });
  assert.deepEqual(a.density, { dpi: 400, overridden: false });
  assert.equal(a.isEmulator, false);

  const emu = parseAdbDevices(ADB_DEVICES)[1];
  const b = detailsFrom(emu, parseGetprop(PROPS_X86), '', '');
  assert.equal(b.primaryAbi, 'x86_64');
  assert.deepEqual(b.abis, ['x86_64', 'arm64-v8a']);
  assert.equal(b.abiFamily, 'mixed', 'an x86_64 image with ARM translation is reported as mixed, not as plain x86');
  assert.equal(b.isEmulator, true);
  assert.equal(b.screen, null);
});

test('abi family classification', () => {
  assert.equal(abiFamily(['x86']), 'x86');
  assert.equal(abiFamily(['armeabi-v7a']), 'arm');
  assert.equal(abiFamily(['riscv64']), 'other');
  assert.equal(abiFamily([]), 'unknown');
});

// Risk: A user-set resolution override is ignored, so coordinates map wrongly.
// Given wm output with overrides, When parsed, Then the override wins and is flagged.
test('wm size and density overrides win over physical values', () => {
  assert.deepEqual(parseWmSize('Physical size: 1440x3120\nOverride size: 1080x2340'), { width: 1080, height: 2340, overridden: true });
  assert.deepEqual(parseWmDensity('Physical density: 560\nOverride density: 420'), { dpi: 420, overridden: true });
});

// Risk: An unauthorized or missing device is queried and fails with a confusing adb error.
// Given an unauthorized serial, When details are requested, Then a clear instruction is returned without running getprop.
test('details for unauthorized or missing devices fail with clear messages', async () => {
  const calls: string[][] = [];
  const dm = createDeviceManager(async (args) => {
    calls.push(args);
    return ADB_DEVICES;
  });
  await assert.rejects(dm.details('R58N12ABCDE'), /accept the USB debugging prompt/);
  await assert.rejects(dm.details('NOPE123'), /is not connected/);
  assert.ok(calls.every((c) => c[0] === 'devices'), 'no shell command is sent to a device that is not ready');
});

// Risk: A crafted serial is passed to adb.
// Given serials with shell metacharacters, When validated, Then they are rejected.
test('serials are validated before reaching adb', () => {
  assert.equal(assertSerial('emulator-5554'), 'emulator-5554');
  assert.throws(() => assertSerial('abc; rm -rf /'), /invalid device serial/);
  assert.throws(() => assertSerial(''), /invalid device serial/);
});
