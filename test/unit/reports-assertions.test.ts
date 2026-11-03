/**
 * Feature: new interactions (clear, hide keyboard, app lifecycle, deep link, wait enabled, screen check, checkpoint),
 *          suggestion ranking, failure diagnosis, secret masking, reports, run journal
 * Layer: Unit — node:test
 * Real: generators, ranking, diagnosis rules on real framework messages, report rendering on a temp folder
 * Mocked: nothing
 * Guards: steps silently dropped or written as placeholders, dynamic values asserted exactly, wrong failure causes,
 *         secrets in exported reports, shell injection through deep links, crashed runs never cleaned up
 * Run: npm run test:unit
 * Needs: Node.js 22.18+
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { assertDeepLink, assertPackage } from '../../src/device.js';
import { generateMobilewrightPlain, generateMobilewrightPom } from '../../src/engines/mobilewright/ts-codegen.ts';
import { journalBegin, journalEnd, journalPending } from '../../src/engines/run-journal.ts';
import { refineSuggestions } from '../../src/model/assertions.ts';
import { diagnoseFailure } from '../../src/reports/diagnosis.ts';
import { loadReport, renderHtml, renderJson, reportFile, writeMeta } from '../../src/reports/report.ts';
import { maskSecrets, secretValues } from '../../src/reports/secrets.ts';
import { actionSampleRecording } from '../support/sample-flow.ts';

const SIZE = { width: 1080, height: 2400 };

// Risk: a new interaction is generated differently per framework, dropped, or written as a placeholder.
test('new interactions in both MobileWright generators; unsupported ones are validation errors', () => {
  const mw = generateMobilewrightPlain(actionSampleRecording(), { caseSlug: 'more', size: SIZE });
  assert.deepEqual(mw.issues, []);
  const t = mw.files[0].content;
  for (const line of ["await device.openUrl('tradehub://products');", "await test.info().attach('checkpoint-products', { body: await screen.screenshot(), contentType: 'image/png' });", "await screen.getByTestId(id('home_search_input')).clear();", "await expect(screen.getByTestId(id('home_search_input'))).toBeEnabled();"]) {
    assert.ok(t.includes(line), line);
  }
  assert.match(t,/await device\.terminateApp\(bundleId\);[\s\S]*?\/\/ 8\. Launch the app\s+await device\.launchApp\(bundleId\);/);
  assert.deepEqual(generateMobilewrightPom(actionSampleRecording(), { caseSlug: 'more', size: SIZE }).issues, []);
  const full = actionSampleRecording({ appiumOnly: true });
  const bad = generateMobilewrightPlain(full, { caseSlug: 'more', size: SIZE }).issues;
  assert.deepEqual(bad.map((i) => i.step), [2, 8]);
  assert.match(bad[0].message, /activity/);
  assert.match(bad[1].message, /hide-keyboard/);

});

// Risk: a deep link or package name reaches the device shell with shell syntax in it.
test('deep links and package names are validated before reaching adb shell', () => {
  assert.equal(assertDeepLink('tradehub://orders/42?tab=1'), 'tradehub://orders/42?tab=1');
  for (const bad of ["x://a';reboot", 'x://a b', 'x://$(id)', 'x://a`id`', 'x://a|b', 'noscheme', 'x://a\\b']) assert.throws(() => assertDeepLink(bad), /invalid deep link/, bad);
  assert.equal(assertPackage('com.yourname.tradehub'), 'com.yourname.tradehub');
  assert.throws(() => assertPackage('com.x;reboot'), /invalid package/);
});

// Risk: suggestions assert values that change every run, repeat themselves, or bury the useful check.
test('suggestion ranking: dynamic text becomes visibility, duplicates merge, state changes first, max six', () => {
  const s = refineSuggestions([
    { assertion: 'visible', parts: { by: 'text', value: 'Saved' }, title: 'Saved', reason: 'appeared' },
    { assertion: 'text', expected: '₹ 1,250', parts: { by: 'id', value: 'x:id/total' }, title: 'total', reason: 'text changed' },
    { assertion: 'checked', parts: { by: 'id', value: 'x:id/toggle' }, title: 'toggle', reason: 'state changed' },
    { assertion: 'visible', parts: { by: 'text', value: 'Saved' }, title: 'Saved', reason: 'appeared' },
    { assertion: 'visible', parts: null, title: 'icon' },
    ...Array.from({ length: 8 }, (_, i) => ({ assertion: 'visible', parts: { by: 'label', value: 'L' + i }, title: 'L' + i })),
  ]);
  assert.equal(s.length, 6);
  assert.equal(s[0].assertion, 'checked');
  const total = s.find((x) => x.parts?.value === 'x:id/total')!;
  assert.equal(total.assertion, 'visible');
  assert.match(total.reason!, /looks dynamic/);
  assert.equal(s.filter((x) => x.parts?.value === 'Saved').length <= 1, true);
  assert.ok(!s.some((x) => x.title === 'icon'));
});

// Risk: the report blames the wrong cause; the hint sends people in the wrong direction.
test('failure diagnosis on real framework messages', () => {
  const k = (message: string, extra: Record<string, unknown> = {}) => diagnoseFailure({ message, ...extra });
  assert.equal(k('RuntimeError: Set the VORTEX_SECRET_EMAIL environment variable: this test types ...').kind, 'missing-secret');
  const a = k("AssertionError: assert 'Role: BUYER' == 'Role: SELLER'");
  assert.deepEqual([a.kind, a.expected, a.actual], ['assertion-mismatch', 'Role: SELLER', 'Role: BUYER']);
  const p = k("AssertionError: expected text 'Subscribed: nobody', got 'Subscribed: a@b.c' (('css selector', '#status'))");
  assert.deepEqual([p.kind, p.expected, p.actual], ['assertion-mismatch', 'Subscribed: nobody', 'Subscribed: a@b.c']);
  assert.equal(k('Error: expect(locator).toHaveText(expected) failed\n\nExpected: "Role: SELLER"\nReceived: "Role: BUYER"').expected, 'Role: SELLER');
  const mw = k('ExpectError: Expected element to have text "Role: BUYER", but got "Role: SELLER"');
  assert.deepEqual([mw.kind, mw.expected, mw.actual], ['assertion-mismatch', 'Role: BUYER', 'Role: SELLER']);
  assert.equal(k('ExpectError: Expected element to have text "x", but no matching element was found').kind, 'element-not-found');
  assert.equal(k('ExpectError: Expected element to be visible, but it was not').kind, 'element-not-found');
  assert.equal(k('ExpectError: Expected element to be enabled, but it was not').kind, 'element-not-interactable');
  assert.equal(k('ExpectError: Expected element to be checked, but it was not').kind, 'assertion-mismatch');
  assert.equal(k("selenium.common.exceptions.TimeoutException: Message: not visible: ('id', 'com.x:id/save')").kind, 'element-not-found');
  assert.equal(k('AssertionError: expected 4 elements for (id, row), found 3').kind, 'count-mismatch');
  assert.equal(k('AssertionError: expected screen .ui.Home, but the foreground activity is .ui.Login').kind, 'wrong-screen');
  assert.equal(k('AssertionError: no WebView context for com.x (contexts: [NATIVE_APP])').kind, 'webview');
  assert.equal(k('selenium...: invalid session id').kind, 'session-lost');
  assert.equal(k('anything', { foregroundPackage: 'com.android.chrome', appPackage: 'com.x' }).kind, 'app-left-foreground');
  assert.equal(k('x', { category: 'import-or-syntax' }).kind, 'load-error');
  assert.equal(k('x', { category: 'server-lost' }).kind, 'server-lost');
  assert.equal(k('x', { status: 'timeout' }).kind, 'run-timeout');
  const tb = "    def check_response(self, response):\n            if message == 'No such context found.':\n    E       selenium.common.exceptions.UnknownMethodException: Message: Unsupported execute method 'mobile: deepLink'\n";
  assert.equal(k("selenium.common.exceptions.UnknownMethodException: Message: Unsupported execute method 'mobile: deepLink'", { details: tb }).kind, 'unsupported-command', 'traceback source code is not evidence');
  assert.equal(k('AssertionError: x', { details: tb.replace(/UnknownMethodException.*/, 'AssertionError: x') }).kind, 'unknown');
  assert.equal(k('Something nobody has seen before').kind, 'unknown');
});

// Risk: an exported report leaks a password, or cannot be opened on another machine.
test('reports: self-contained HTML and JSON, secrets masked, safe file access', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-report-'));
  const png = fs.readFileSync(new URL('../../samples/home.png', import.meta.url));
  fs.writeFileSync(path.join(dir, 'failure-t.png'), png);
  fs.writeFileSync(path.join(dir, 'failure-dom-1.html'), '<input value="hunter2-pass">');
  fs.writeFileSync(path.join(dir, 'output.log'), 'typed hunter2-pass into field\nAuthorization: Bearer abcdef0123456789\n');
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ id: 'r1', status: 'failed', category: 'automation', summary: '1 of 1 test(s) failed.', startedAt: '2026-10-31T10:00:00.000Z', endedAt: '2026-10-31T10:00:05.000Z', durationMs: 5000, exitCode: 1, tests: { total: 1, failures: 1, errors: 0, skipped: 0 }, sessionStartupMs: 1200,
    failed: [{ test: 't', message: 'assert x', step: '2. Check "a" (text)', details: 'secret hunter2-pass here', diagnosis: { kind: 'assertion-mismatch', title: 'A check found a different value', hint: 'update it', expected: 'a', actual: 'b' } }],
    artifacts: [{ type: 'screenshot', file: 'failure-t.png' }, { type: 'dom', file: 'failure-dom-1.html' }] }));
  writeMeta(dir, { id: 'r1', engine: 'mobilewright', label: 'browse', files: ['a.test.ts'], appPackage: 'com.x', device: { serial: 'ZD', model: 'Moto', androidVersion: '14', sdk: 34, simulated: false }, buildType: 'release', appVersion: '2.0', retry: { attempt: 2, of: 2, previous: 'r0' } });
  process.env.VORTEX_SECRET_PASS = 'hunter2-pass';
  try {
    assert.ok(secretValues().includes('hunter2-pass'));
    const r = loadReport(dir)!;
    assert.ok(!JSON.stringify(r.result).includes('hunter2-pass'), 'the loaded record itself is masked (the UI reads it)');
    const html = renderHtml(r);
    assert.ok(!html.includes('hunter2-pass') && html.includes('****'));
    assert.ok(!html.includes('abcdef0123456789'), 'bearer token masked');
    assert.ok(html.includes('data:image/png;base64,'), 'screenshot embedded');
    for (const s of ['Moto (ZD), Android 14 / API 34', 'com.x 2.0, release build', 'attempt 2 of 2 (after r0)', 'A check found a different value', 'WebView DOM at failure', '1.2 s']) assert.ok(html.includes(s), s);
    const j = JSON.parse(renderJson(r));
    assert.equal(j.schema, 'vortex.report');
    assert.ok(!JSON.stringify(j).includes('hunter2-pass'));
    assert.equal(reportFile(dir, '../result.json'), null);
    assert.equal(reportFile(dir, 'failure-t.png'), path.join(dir, 'failure-t.png'));
    assert.equal(reportFile(dir, 'result.sh'), null);
    assert.equal(maskSecrets('a hunter2-pass b'), 'a **** b');
  } finally {
    delete process.env.VORTEX_SECRET_PASS;
  }
});

test('run journal: begin, list, end', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-journal-'));
  journalBegin(d, { id: 'r1', engine: 'mobilewright', label: 'x', dir: d, serial: 's', startedAt: 'now', process: { pid: 1, startTime: 't', commandLine: 'mobilewright test' } });
  assert.deepEqual(journalPending(d).map((j) => j.id), ['r1']);
  journalEnd(d, 'r1');
  assert.deepEqual(journalPending(d), []);
});
