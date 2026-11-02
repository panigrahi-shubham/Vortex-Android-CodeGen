/**
 * Feature: shared recording model, Plain/POM/Both generation for MobileWright, project save
 * Layer: Unit — node:test
 * Real: model conversion and migration, all four generators, the project writer on a temp folder,
 *       MobileWright runner helpers (config, report parsing, step mapping, project detection)
 * Mocked: nothing (no device, no runner processes; those are in test/integration)
 * Guards: actions lost when switching modes, secrets written to disk, placeholders in generated code,
 *         wrong MobileWright APIs, duplicate test discovery in Both mode, hand edits overwritten,
 *         unsafe paths, unreadable old recordings
 * Run: npm run test:unit
 * Needs: Node.js 22.18+
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseResumedActivity } from '../../src/device.js';
import { detectMobilewright, failedStepTs, MobilewrightRunner, parseReport, wrapperConfig } from '../../src/engines/mobilewright/runner.ts';
import { generateMobilewrightPlain, generateMobilewrightPom, mwLocator } from '../../src/engines/mobilewright/ts-codegen.ts';
import { fromUiSteps, migrateRecording, RecordingError, toUiSteps, validateRecording, type Recording, type UiStep } from '../../src/model/recording.ts';
import { RunError } from '../../src/engines/run-types.ts';
import { altName, buildCase, caseDir, listProject, ProjectError, readCaseRecording, saveCase } from '../../src/project/project.ts';
import { HOME, PKG, PRODUCTS, sampleRecording, sampleSteps } from '../support/sample-flow.ts';

const SIZE = { width: 1080, height: 2400 };
const META = { id: 'rec-1', name: 'flow', module: 'm', appPackage: PKG, serial: null, screen: SIZE, version: 'test' };
const ref = { module: 'catalog', case: 'browse' };
const all = (rec: Recording) => buildCase(rec, ref, { frameworks: ['mobilewright'], mode: 'both', target: 'pom', size: SIZE });
const sha = (f: string) => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-proj-'));

// Risk: a mode switch or a save/reopen silently drops recorded actions.
// Given the sample flow, When generated in both variants and round-tripped through the model, Then every variant has one numbered block per event and the round trip is lossless.
test('every variant contains every recorded step; model round trip is lossless', () => {
  const rec = sampleRecording();
  const r = all(rec);
  assert.deepEqual(r.issues, []);
  const entries = r.files.filter((f) => f.role === 'entry');
  assert.equal(entries.length, 2);
  for (const f of entries) {
    const numbered = [...f.content.matchAll(/^\s+(?:\/\/|#) (\d+)\. /gm)].map((m) => Number(m[1]));
    assert.deepEqual(numbered, rec.events.map((e) => e.seq), `${f.path} lost or reordered steps`);
  }
  const again = fromUiSteps(toUiSteps(rec), { ...META, id: rec.id, name: rec.name, module: rec.module, createdAt: rec.createdAt });
  const strip = (x: Recording) => JSON.stringify({ ...x, updatedAt: '', events: x.events.map((e) => ({ ...e, at: '' })) });
  assert.equal(strip(again), strip({ ...rec, generator: again.generator, device: again.device }));
});

// Risk: recordings saved by Milestone 2 or the browser autosave cannot be opened, or a newer file is misread.
test('migration: v0 step lists open as v1; newer or foreign files are refused', () => {
  const v0 = sampleSteps();
  const m = migrateRecording(v0, { name: 'old flow' });
  assert.equal(m.version, 1);
  assert.equal(m.migratedFrom, 0);
  assert.equal(m.events.length, v0.length);
  assert.equal(migrateRecording({ steps: v0 }).events.length, v0.length);
  const cur = sampleRecording();
  assert.equal(migrateRecording(JSON.parse(JSON.stringify(cur))).migratedFrom, null);
  assert.throws(() => migrateRecording({ ...cur, version: 2 }), /newer Vortex \(format version 2\)/);
  assert.throws(() => migrateRecording({ schema: 'other' }), RecordingError);
  assert.throws(() => migrateRecording({ ...cur, events: [{ action: { type: 'teleport' } }] }), /invalid recording/);
});

// Risk: a password or OTP ends up in recording.json, the generated code or the browser autosave.
test('sensitive input is never stored: only the environment variable name is', () => {
  const steps: UiStep[] = [{ type: 'type', title: 'Password', target: sampleSteps()[0].target, args: { text: 'hunter2-SECRET' }, secretEnv: 'VORTEX_SECRET_PASSWORD', x: 1, y: 1, screen: HOME }];
  const rec = fromUiSteps(steps, META);
  assert.deepEqual(rec.events[0].input, { secretEnv: 'VORTEX_SECRET_PASSWORD' });
  const r = buildCase(rec, ref, { frameworks: ['mobilewright'], mode: 'both', target: 'plain', size: SIZE });
  const text = JSON.stringify(rec) + r.files.map((f) => f.content).join('\n');
  assert.ok(!text.includes('hunter2'), 'secret leaked');
  for (const g of ['mobilewright plain', 'mobilewright pom']) {
    const files = r.files.filter((f) => `${f.framework} ${f.variant}` === g);
    assert.ok(files.some((f) => f.content.includes("'VORTEX_SECRET_PASSWORD'") || f.content.includes('"VORTEX_SECRET_PASSWORD"')), `${g} reads the secret from the environment`);
  }
  assert.throws(() => fromUiSteps([{ ...steps[0], secretEnv: 'bad name' }], META), /not a valid environment variable/);
  assert.throws(() => validateRecording({ ...rec, events: [{ ...rec.events[0], input: { secretEnv: 'X', text: 'leak' } }] }), /must not store its value/);
});

// Risk: generated MobileWright code uses APIs that do not exist in 0.0.66, or semantics that differ (substring nth).
test('MobileWright: verified APIs, exact-match positions, retrying matchers, no placeholders', () => {
  assert.deepEqual(mwLocator({ by: 'text', value: 'Edit', index: 2 }, PKG, 'screen'), { code: "screen.getByText('Edit').nth(2)" });
  assert.deepEqual(mwLocator({ by: 'id', value: `${PKG}:id/row`, index: 0 }, PKG, 'screen'), { code: "screen.getByTestId(id('row')).nth(0)" });
  assert.deepEqual(mwLocator({ by: 'id', value: 'android:id/button1' }, PKG, 'this.screen'), { code: "this.screen.getByTestId('android:id/button1')" });
  assert.match((mwLocator({ by: 'scoped', container: `${PKG}:id/row`, anchorText: "Bob's", inner: { by: 'label', value: 'Edit' } }, PKG, 'screen') as { code: string }).code, /filter\(\{ has: screen\.getByText\('Bob\\'s'\) \}\)\.getByLabel\('Edit'\)/);
  const t = sampleSteps()[0].target;
  const mk = (s: Partial<UiStep>): UiStep => ({ type: 'assert', title: 'x', target: t, screen: HOME, ...s });
  const kinds: [string, string | number | undefined, string][] = [
    ['visible', undefined, '.toBeVisible()'], ['hidden', undefined, '.toBeHidden()'], ['enabled', undefined, '.toBeEnabled()'], ['disabled', undefined, '.toBeDisabled()'],
    ['text', 'A', ".toHaveText('A')"], ['contains', 'B', ".toContainText('B')"], ['checked', undefined, '.toBeChecked()'], ['unchecked', undefined, '.not.toBeChecked()'],
    ['selected', undefined, '.toBeSelected()'], ['unselected', undefined, '.not.toBeSelected()'], ['count', 3, '.toHaveCount(3)'],
  ];
  const rec = fromUiSteps(kinds.map(([assertion, expected]) => mk({ args: { assertion, expected } })), META);
  const code = generateMobilewrightPlain(rec, { caseSlug: 'x', size: SIZE }).files[0].content;
  for (const [, , m] of kinds) assert.ok(code.includes(m), m);
  assert.ok(!/getText\(\)|isChecked\(\)|TODO|unsupported|Verify on first run/.test(code));

  const coord = { kind: 'coordinate', expr: null, quality: 10, warnings: [] };
  const r2 = generateMobilewrightPlain(fromUiSteps([
    { type: 'longpress', target: coord, x: 10, y: 20, screen: HOME },
    { type: 'doubletap', target: coord, x: 30, y: 40, screen: HOME },
    { type: 'press', args: { key: 'RECENT' }, screen: HOME },
    { type: 'swipe', args: { direction: 'left', distance: 500, from: { x: 900, y: 1000 }, to: { x: 400, y: 1100 }, duration: 250 }, screen: HOME },
  ], META), { caseSlug: 'x', size: SIZE });
  assert.deepEqual(r2.issues, []);
  const c2 = r2.files[0].content;
  assert.ok(c2.includes('await screen.longPress(10, 20);'));
  assert.ok(c2.includes('await screen.doubleTap(30, 40);'));
  assert.ok(c2.includes("await screen.pressButton('APP_SWITCH');"));
  assert.ok(c2.includes("await screen.swipe('left', { distance: 500, startX: 900, startY: 1000, duration: 250 });"));

  const bad = generateMobilewrightPlain(fromUiSteps([
    { type: 'type', target: coord, args: { text: 'x' }, x: 1, y: 1, screen: HOME },
    { type: 'scroll_to', target: coord, screen: HOME },
    { type: 'press', args: { key: 'F13' }, screen: HOME },
    { type: 'assert', target: t, args: { assertion: 'count', expected: 'many' }, screen: HOME },
    { type: 'tap', target: { kind: 'testId', expr: 'x' }, x: 1, y: 1, mode: 'name', screen: HOME },
  ], META), { caseSlug: 'x', size: SIZE });
  assert.deepEqual(bad.issues.map((i) => i.step), [1, 2, 3, 4, 5]);
  assert.match(bad.issues[2].message, /not a MobileWright hardware button/);
});

// Risk: POM output puts checks on the wrong page, duplicates locators, or two cases collide when run together.
test('POM: one page per screen, post-action checks on the next screen', () => {
  const rec = sampleRecording();
  const mw = generateMobilewrightPom(rec, { caseSlug: 'browse', size: SIZE });
  assert.deepEqual(mw.issues, []);
  const paths = mw.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ['mobilewright/pom/data/browse.data.ts', 'mobilewright/pom/fixtures.ts', 'mobilewright/pom/pages/HomePage.ts', 'mobilewright/pom/pages/MyProductsPage.ts', 'mobilewright/pom/pages/app.ts', 'mobilewright/pom/tests/browse.test.ts']);
  const home = mw.files.find((f) => f.path.endsWith('HomePage.ts'))!.content;
  const prod = mw.files.find((f) => f.path.endsWith('MyProductsPage.ts'))!.content;
  assert.ok(home.includes('async tapMyProducts(') && !prod.includes('tapMyProducts'), 'action on the page it was recorded on');
  assert.ok(prod.includes("get myProducts(): Locator") && prod.includes('myproducts_title_text'), 'appeared-after check lives on the next page');
  assert.equal((home.match(/get search\(\)/g) ?? []).length, 1, 'locator defined once');
  const spec = mw.files.find((f) => f.role === 'entry')!.content;
  assert.ok(spec.includes('await homePage.fillSearch(data.search);'));
  assert.ok(spec.includes('await myProductsPage.tapEdit({ fallback: { x: 670, y: 1286 } });'));


});

// Risk: in Both mode the same flow runs twice under the default discovery of either runner.
test('Both mode: only the target variant is discoverable', () => {
  const r = all(sampleRecording());
  const entries = r.files.filter((f) => f.role === 'entry').map((f) => f.path).sort();
  assert.deepEqual(entries, [
    'mobilewright/plain/browse.vortex-alt.ts',
    'mobilewright/pom/tests/browse.test.ts',
  ]);
  assert.equal(altName('x/a.test.ts'), 'x/a.vortex-alt.ts');
});

// Risk: saving destroys hand edits, leaves stale generated files behind, or writes outside the output folder.
test('MobileWright-only generation rejects retired engines and preserves old generated files', () => {
  const out = tmp();
  const rec = sampleRecording();
  const legacyPath = 'appium/plain/test_browse.py';
  try {
    assert.throws(() => buildCase(rec, ref, { frameworks: ['appium'], mode: 'plain', target: 'plain', size: SIZE }), /Only MobileWright/);
    saveCase(out, ref, { recording: rec, files: [{ path: legacyPath, content: '# existing user test\n', framework: 'appium', variant: 'plain', role: 'entry' }], assets: [], mode: 'plain', target: null, frameworks: ['appium'], generator: 'old-version' });
    const current = buildCase(rec, ref, { frameworks: ['mobilewright'], mode: 'plain', target: 'plain', size: SIZE });
    const result = saveCase(out, ref, { recording: rec, files: current.files, assets: [], mode: 'plain', target: null, frameworks: ['mobilewright'], generator: 'current' });
    assert.equal(fs.readFileSync(path.join(caseDir(out, ref), legacyPath), 'utf8'), '# existing user test\n');
    assert.ok(result.keptStale.includes(legacyPath));
    assert.ok(!result.removed.includes(legacyPath));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('saving: checksums, hand edits kept with .vortex-new, explicit replace, stale cleanup, history', () => {
  const out = tmp();
  const rec = sampleRecording();
  const save = (r: Recording, mode: 'plain' | 'pom' | 'both', replace: string[] = []) => {
    const b = buildCase(r, ref, { frameworks: ['mobilewright'], mode, target: 'pom', size: SIZE });
    return saveCase(out, ref, { recording: r, files: b.files, assets: [{ name: 'step-1.png', data: Buffer.from('png') }], mode, target: mode === 'both' ? 'pom' : null, frameworks: ['mobilewright'], replace, generator: 'test' });
  };
  const s1 = save(rec, 'pom');
  assert.ok(s1.written.includes('mobilewright/pom/tests/browse.test.ts') && s1.written.includes('assets/templates/step-1.png'));
  const dir = caseDir(out, ref);
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'vortex-manifest.json'), 'utf8'));
  for (const [p, e] of Object.entries(man.files) as [string, { sha256: string }][]) {
    assert.equal(e.sha256, sha(path.join(dir, p)), p);
  }
  assert.equal(save(rec, 'pom').written.length, 0, 'second save writes nothing');

  // A hand edit is kept; the new version goes next to it.
  const spec = path.join(dir, 'mobilewright/pom/tests/browse.test.ts');
  fs.appendFileSync(spec, '// mine\n');
  const changed = { ...rec, name: 'browse', events: rec.events.slice(0, -1) };
  const s3 = save(changed, 'pom');
  assert.deepEqual(s3.conflicts.map((c) => [c.path, c.reason]), [['mobilewright/pom/tests/browse.test.ts', 'edited']]);
  assert.ok(fs.readFileSync(spec, 'utf8').endsWith('// mine\n'));
  assert.ok(fs.existsSync(spec + '.vortex-new'));
  assert.ok(s3.recordingBackup && fs.existsSync(path.join(dir, s3.recordingBackup)), 'previous recording kept');
  assert.deepEqual(listProject(out).modules[0].cases[0].pendingReview, ['mobilewright/pom/tests/browse.test.ts']);

  // Explicit replace.
  const s4 = save(changed, 'pom', ['mobilewright/pom/tests/browse.test.ts']);
  assert.deepEqual(s4.replaced, ['mobilewright/pom/tests/browse.test.ts']);
  assert.ok(!fs.existsSync(spec + '.vortex-new'));

  // Switching to Plain removes unchanged POM files; an edited one is kept and reported.
  fs.appendFileSync(path.join(dir, 'mobilewright/pom/fixtures.ts'), '// mine\n');
  const s5 = save(changed, 'plain');
  assert.ok(s5.removed.includes('mobilewright/pom/tests/browse.test.ts') && s5.removed.includes('mobilewright/pom/pages/HomePage.ts'));
  assert.deepEqual(s5.keptStale, ['mobilewright/pom/fixtures.ts']);
  assert.ok(!fs.existsSync(path.join(dir, 'mobilewright/pom/tests')), 'empty folders removed');

  // A file Vortex did not write is never replaced silently.
  const other = path.join(dir, 'mobilewright/plain/browse.test.ts');
  fs.writeFileSync(other, '// someone else\n');
  fs.rmSync(path.join(dir, 'vortex-manifest.json'));
  const s6 = save(changed, 'plain');
  assert.deepEqual(s6.conflicts.map((c) => c.reason), ['not-generated']);
  assert.equal(fs.readFileSync(other, 'utf8'), '// someone else\n');

  // Reopen.
  const back = readCaseRecording(out, ref);
  assert.equal(back.recording.events.length, changed.events.length);
  assert.equal(back.steps.length, changed.events.length);

  for (const bad of [{ module: '../x', case: 'a' }, { module: 'a', case: 'A b' }, { module: '', case: 'a' }]) assert.throws(() => caseDir(out, bad), ProjectError);
  assert.throws(() => saveCase(out, ref, { recording: rec, files: [{ path: '../evil.ts', content: '', framework: 'mobilewright', variant: 'plain', role: 'support' }], assets: [], mode: 'plain', target: null, frameworks: ['mobilewright'], generator: 't' }), /Unsafe file path/);
  assert.throws(() => saveCase(out, ref, { recording: rec, files: [], assets: [{ name: '../x.png', data: Buffer.from('') }], mode: 'plain', target: null, frameworks: ['mobilewright'], generator: 't' }), /Unsafe asset name/);
});

test('foreground activity parsing for page names', () => {
  assert.equal(parseResumedActivity('  mResumedActivity: ActivityRecord{c1 u0 com.a.b/.ui.LoginActivity t12}'), 'com.a.b/.ui.LoginActivity');
  assert.equal(parseResumedActivity('  topResumedActivity=ActivityRecord{9 u0 com.a.b/com.a.b.MainActivity t4}'), 'com.a.b/.MainActivity');
  assert.equal(parseResumedActivity('  ResumedActivity: ActivityRecord{1 u0 com.x/org.other.Screen t9}'), 'com.x/org.other.Screen');
  assert.equal(parseResumedActivity('no activity here'), null);
  assert.equal(sampleRecording().events[2].screenAfter?.name, PRODUCTS.name);
});

// Risk: the wrong tests run, the project config is ignored, results are misread, or failures point at the wrong step.
test('MobileWright runner helpers: wrapper config, report parsing, failed step, project detection, file rules', () => {
  const cfg = wrapperConfig({ configDir: '/p/out/r/1', userConfig: '/p/mobilewright.config.ts', deviceId: 'ZD222', testDir: '/p/out', files: ['/p/out/a/b/x.test.ts'], outputDir: '/p/out/r/1/test-results', jsonFile: '/p/out/r/1/results.json', driverModule: null });
  assert.ok(cfg.includes('import projectConfig from "../../../mobilewright.config.ts";'));
  assert.ok(cfg.includes('deviceId: "ZD222"') && cfg.includes("['json', { outputFile: \"/p/out/r/1/results.json\" }]"));
  assert.ok(cfg.includes('x\\\\.test\\\\.ts$'), 'exact file match');
  assert.ok(!cfg.includes('driver:'), 'no driver injected for real runs');
  assert.ok(new RegExp(JSON.parse(/new RegExp\(("[^)]*")\)/.exec(cfg)![1])).test('/p/out/a/b/x.test.ts'));

  const report = {
    stats: { expected: 1, unexpected: 1, flaky: 0, skipped: 0 },
    suites: [{ title: 'x.test.ts', file: 'x.test.ts', specs: [
      { title: 'ok', file: 'x.test.ts', line: 3, tests: [{ status: 'expected', results: [{ status: 'passed' }] }] },
      { title: 'flow', file: 'x.test.ts', line: 9, tests: [{ status: 'unexpected', results: [{ status: 'failed', error: { message: '\u001b[31mError: expect(locator).toHaveText(expected)\u001b[39m\n\nExpected: "Role: BUYER"', stack: 'Error: x\n    at /p/out/a/b/x.test.ts:14:7' } }] }] },
    ] }],
    errors: [],
  };
  const p = parseReport(report);
  assert.deepEqual([p.total, p.passed, p.failedCount], [2, 1, 1]);
  assert.equal(p.failed[0].title, 'flow');
  assert.ok(!p.failed[0].message.includes('\u001b'));
  const d = tmp();
  const f = path.join(d, 'x.test.ts');
  fs.writeFileSync(f, ["import x from 'y';", '', "test('flow', async () => {", '  try {', '    // 1. Tap "A"', '    await a();', '    // 2. Check "Role" (text)', '    await b();', '  } finally {', '  }', '});'].join('\n'));
  assert.equal(failedStepTs([f], `Error\n    at Object.tapTarget (${d}/pages/app.ts:20:5)\n    at ${f}:8:5`), '2. Check "Role" (text)');
  assert.equal(failedStepTs([f], 'no frames'), null);

  assert.equal(detectMobilewright(d).ok, false);
  assert.match(detectMobilewright(d).installCommand!, /@mobilewright\/test@0\.0\.66/);
  fs.mkdirSync(path.join(d, 'node_modules/@mobilewright/test'), { recursive: true });
  fs.writeFileSync(path.join(d, 'node_modules/@mobilewright/test/package.json'), '{"version":"0.0.66"}');
  fs.mkdirSync(path.join(d, 'node_modules/mobilewright/dist'), { recursive: true });
  fs.writeFileSync(path.join(d, 'node_modules/mobilewright/dist/cli.js'), '');
  fs.writeFileSync(path.join(d, 'mobilewright.config.ts'), 'export default {}');
  fs.mkdirSync(path.join(d, 'tests/m/c'), { recursive: true });
  const env = detectMobilewright(path.join(d, 'tests/m/c'));
  assert.deepEqual([env.ok, env.projectDir, env.version, env.config], [true, d, '0.0.66', path.join(d, 'mobilewright.config.ts')]);

  const code = (file: string) => {
    try {
      MobilewrightRunner.resolveTestFile(d, file);
      return 'ok';
    } catch (e) {
      return (e as RunError).code;
    }
  };
  assert.equal(code('x.test.ts'), 'ok');
  assert.equal(code('../x.test.ts'), 'OUTSIDE_TESTS_DIR');
  assert.equal(code('mobilewright.config.ts'), 'NOT_A_TEST_FILE');
  assert.equal(code('y.vortex-alt.ts'), 'NOT_SAVED');
});
