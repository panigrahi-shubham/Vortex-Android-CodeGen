# Baseline audit — TPHub Recorder v0.1 → Vortex Android Recorder

> Historical audit. Feature/status descriptions below are retained as development history. For the current MobileWright-only beta, use README.md and docs/BETA_RELEASE.md; retired panels referenced below are no longer available.

Audited commit: `3bdcf52` ("Add TP-Hub Recorder"), the only commit on `main` at audit time (2026-10-31).
Method: every source file, the UI, the README, the samples and the test suite were read, the test suite was run,
and the recorder was started in `--mock` mode and driven in a browser. **No physical device or emulator was
available during the audit**, so nothing below is claimed as verified on real hardware unless it says so.

Status key: **Implemented** (works as described) · **Partial** · **Missing** · **Broken / risk**.

## 1. Architecture as found

| Part | File | What it does |
|---|---|---|
| HTTP server | `src/server.js` | Zero-dependency `node:http` server on `127.0.0.1:4700`. Routes: `GET /`, `GET/POST /api/config`, `GET /api/screen`, `POST /api/action`, `POST /api/generate`, `POST /api/debug`, `POST /api/save`. Device calls are serialised with a promise lock. |
| Device layer | `src/device.js` | ADB via `execFile` (no shell): `screencap`, `input tap/swipe/text/keyevent`, `wm size`. Tree via `mobilecli dump ui` (run through a shell, command from CLI/env only), falling back to `adb exec-out uiautomator dump /dev/tty` with 4 retries. Built-in mock device with two screens. |
| Tree parsing | `src/tree.js` | Parses mobilecli JSON and uiautomator XML into a flat node list; UTF-16 (PowerShell redirect) support; keeps only the app-under-test subtrees plus system permission/picker dialogs; package auto-detection. |
| Locator ranking | `src/locators.js` | Deterministic scores: unique resource-id 100 → unique label 85 → unique text 75 → scoped list row 60 → dynamic label/text 50–55 → `.nth()` 35–40 → coordinate 10. Climbs up to 3 ancestors for unlabeled icons. Flags dynamic-looking text (prices, counts, times). |
| Assertion suggestions | `src/suggest.js` | Before/after tree diff → state changes (checked, selected, text), appeared elements, disappeared loaders/dialogs. |
| Code generation | `src/codegen.js` | MobileWright TypeScript in the project's spec style; pre-assertion → action → post-assertions; three tap styles (name+coordinate fallback via `tapOrAt`, name only, coordinate only); header comment listing APIs not confirmed in the MobileWright docs. |
| Tree checker CLI | `src/check.js` | Prints the locator the recorder would pick for every element in a saved tree file. |
| UI | `public/index.html` | Single page, vanilla JS. Screenshot with element overlays, mode toolbar, step cards with suggestions, live read-only code preview, Save/Copy. |
| Tests | `test/run-tests.js` | Custom runner, 28 tests (parsing, filtering, locator choice, suggestions, codegen, uiautomator retry, lock). |

Runtime dependencies: none. Node `>=18` declared.

## 2. Feature inventory against the specification's audit list

| # | Area | Status | Evidence / notes |
|---|---|---|---|
| 1 | Node.js server + frontend | **Implemented** | As in §1. Bound to 127.0.0.1. |
| 2 | Screenshot capture through ADB | **Implemented** | `adb exec-out screencap -p` on every refresh and after each action. Not a live stream: the screen updates only after an action or Refresh. |
| 3 | Hierarchy via mobilecli / uiautomator | **Implemented** | Auto mode tries mobilecli then falls back. **Risk:** after one mobilecli failure the session never tries mobilecli again (`useMobilecli = false` is permanent until restart). |
| 4 | Tap, swipe, type, scroll, wait, navigation recording | **Implemented / Partial** | Tap, long-press, double-tap, swipe, type, scroll-to, assert, wait-visible/hidden, Back, Home, Enter, fixed 1.5 s wait, undo, delete. **Partial:** scroll-to performs one fixed swipe on the phone (approximation); double-tap is two taps 90 ms apart; long-press/double-tap on unlabeled elements become a tap + TODO. Clear text, hide keyboard, app switch, launch/close app, deep links, context/window switch are **missing**. |
| 5 | Timing / settle detection | **Implemented** | Polls the tree until two identical dumps (max 8 s); slow screens are flagged in the step and the code. |
| 6 | PNG / RGB / coordinate fallback | **Partial** | Coordinate taps with screen-ratio comments and the `tapOrAt` name-then-coordinate helper: implemented. A 200×200 PNG crop is saved for unlabeled elements, **but it is never used**: there is no template matching, no RGB/colour matching, no confidence score. |
| 7 | WebView support | **Partial** | Only what the WebView exposes to Android accessibility (text, some ids). A badge warns when a WebView is on screen. No context switching, no DOM, no CSS/XPath, no Chromedriver. Typing into an unexposed field taps the clicked position and writes a TODO. |
| 8 | Generated MobileWright scripts and comments | **Implemented** | Matches the project's spec style. Unconfirmed APIs are listed in a header comment (`longPress()`, `doubleTap()`, `.nth()`, `.count()`, `not.toBeVisible()`, `not.toBeEnabled()`, `pressButton()` for non-BACK/HOME, `fill()`, `scrollIntoViewIfNeeded()`, `getText()`, `isChecked()`, `isSelected()`, `filter({ has })`). These have **not** been verified here. |
| 9 | Preview, saving, test execution | **Partial** | Live preview: yes (read-only). Save writes `<name>.spec.ts` + assets. **Missing:** running tests from the app (the user runs `npx mobilewright test`), module folders, Plain/POM modes, Appium output. |
| 10 | Existing tests and known bugs | see §3, §4 | |

## 3. Tests found

`npm test` → `node test/run-tests.js`: **28/28 passed** (Node 22.23.0, Linux) at audit time.
Side effect: the suite writes `generated/sample-from-tests.spec.ts` into the repository folder (now git-ignored).
There were no tests for `server.js` routes, the UI, or real devices.

## 4. Known bugs and risks found during the audit

| ID | Severity | Finding | Status after Milestone 1 |
|---|---|---|---|
| A1 | High | **Any website open in the same browser could call the local API** (start actions on the phone, write files to the output folder). Requests were not checked for Host/Origin, and the body was parsed as JSON whatever its content type, so a plain cross-site form POST worked. This mattered more once the API can start and stop processes. | **Fixed**: `src/http-guard.js` requires a localhost Host header, same-origin Origin/`Sec-Fetch-Site` when present, and `application/json` bodies for anything that changes state. The recorder's own UI already sent JSON, so it is unaffected. |
| A2 | Medium | **Save silently overwrites** an existing `.spec.ts` with the same name, and template crops are named `step-N.png`, so a second recording overwrites the first recording's images in the same `assets/` folder. The specification requires "reject silent overwrites". | **Fixed (M3)** for *Save to project*: per-case folders, a checksum manifest, and edited files kept with `.vortex-new`. The v0.1 *single .spec.ts* option still behaves as before. |
| A3 | Medium | Codegen emits placeholder comments (`// unsupported assertion`, `// TODO ...`) instead of failing validation, which the specification forbids for new code. | **Fixed**: Python (M2) and MobileWright format v2 (M3) fail validation instead. The v0.1 single-file format is unchanged. |
| A4 | Medium | Unsaved recordings live only in browser memory: a page reload or crashed tab lost them. | **Fixed**: steps and template crops are autosaved in the browser; on reload an "Unsaved recording found" banner offers Restore/Discard. |
| A5 | Low | mobilecli is never retried after one failure in a session (see #3). | Open. |
| A6 | Low | `--tree-cmd` runs through a shell. Its value comes from the command line or environment only, never from the UI, so it is not reachable remotely. | Documented; unchanged. |
| A7 | Low | Text input uses `adb shell input text`: ASCII only (documented in README). | Unchanged. |
| A8 | Low | README contained a company name and company project paths. The specification asks to keep enterprise artefacts out of distributions. The `samples/` trees are a synthetic "TradeHub" app and contain no company data. | **Fixed** in README (generic paths and wording). |
| A9 | Info | If the phone disconnects, each action fails with an adb error toast; the recording was kept in memory but nothing told the user it was safe. | **Improved**: a banner reports the disconnected serial and that the steps are kept; the same serial works again after reconnecting. |

## 5. What Milestone 1 adds (and what it does not)

Added:
- **Appium Server Manager** (`src/appium/`): Start Server, Connect Existing, Disconnect, Stop Owned Server, Restart Owned Server, Clean Up Vortex Sessions, keep-warm and stop-on-exit settings, server log, crash recovery. Details and safety rules: [`docs/SERVER_MANAGER.md`](docs/SERVER_MANAGER.md).
- **Device detection** (`src/devices/`): `adb devices -l` with USB / emulator / Wi-Fi classification and state (unauthorized, offline), device details (manufacturer, model, Android version and API level, screen and density including overrides, primary ABI, full ABI list, ABI family). ABIs are reported exactly as the device lists them.
- Local request guard (A1), recording autosave (A4), disconnect banner (A9).
- 48 unit tests and 5 integration tests against a real Appium 3.9.0 server; `npm run typecheck`.

Not in Milestone 1 (unchanged behaviour): recording, locators, suggestions and MobileWright generation are untouched;
no Appium sessions are created yet (the Appium adapter is Milestone 2), so "active runs" and "Vortex sessions"
are wired and tested but will be empty in the UI until then. Package launch/terminate, APK install, in-app device
switching and activity discovery from the Device Manager list are not done yet.

## 6. Verification limits

- Verified on Linux (container) with Node 22.23.0 and Appium 3.9.0 without drivers. **Not verified on Windows**:
  the Windows paths (PowerShell `Win32_Process` identity, `Get-NetTCPConnection`, `taskkill /T /F`) are covered by
  unit tests with captured command output only. Run `npm run test:integration` on your Windows machine.
- No Android device or emulator was attached: device parsing is tested with captured `adb` output only.
- The UiAutomator2 driver was not installed, so no real Appium session was created.

## 7. Milestone 2 status (Appium engine)

Done: Appium adapter (dependency-free WebDriver client, UiAutomator2 sessions tracked by the Server Manager), native
inspection with device-verified locator scoring, Appium Python generation (plain pytest), pytest execution with safe
cleanup, device locking. Details and verification limits: [docs/APPIUM_ENGINE.md](docs/APPIUM_ENGINE.md).

Found and fixed while building it:
- the failing-step lookup used a helper's line instead of the test's line (most failures happen inside helpers);
- a step recorded before locator details existed would have been silently turned into a coordinate tap;
- a deadlock: cancelling a run from the Server Manager waited for cleanup that itself needed the Server Manager;
- the W3C element key constant was wrong in the new WebDriver client (caught by the real Appium Python client).

Still not verified on a real device or on Windows (see APPIUM_ENGINE.md).

## 8. Milestone 3 status (shared model, modes, dual-framework export)

Done: recording model v1 with migration; MobileWright and Appium Python in Plain, POM and Both modes from one recording;
project layout with a checksum manifest and safe saving; MobileWright runner; page names from the foreground activity;
sensitive input; reopen. Details and verification limits: [docs/PROJECTS_AND_MODES.md](docs/PROJECTS_AND_MODES.md).

Found and fixed while building it:
- the v0.1 MobileWright `.nth(i)` counted elements whose text or label *contains* the value. MobileWright matches exactly,
  so the index could select the wrong element. v2 uses the exact-match index the recorder already stored. v0.1 itself is
  unchanged and still has this behaviour.
- the v0.1 text, checked, selected and count checks read the value once instead of waiting. v2 uses the retrying matchers.
- several POM cases in one pytest process would collide on module names. Packages and test files are now unique per
  case, and `pytest.ini` keeps `conftest.py` in use when one POM file runs alone.
- a MobileWright file that fails to load also reports "No tests found". It is now classified as a load error, not as empty.

MobileWright compatibility is verified against @mobilewright/test 0.0.66 types and its real runner with a simulated
device only. It has not been verified on a real device.

## 9. Milestone 4 status (WebView inspection, CSS locators, context switching, visual fallback)

Done:
- WebView diagnostics with evidence;
- WebView contexts, DOM, iframes, verified CSS/XPath candidates, search and recording in the Appium Inspector;
- WebView steps in both frameworks and all modes;
- Chromedriver settings;
- the visual fallback engine, *Find on screen* and a no-change warning.

Audit items #6 (visual fallback) and #7 (WebView) move from *Partial* to *Implemented for recording and inspection*.
Generated tests do not run image matching yet. Details: [docs/WEBVIEW_AND_VISUAL.md](docs/WEBVIEW_AND_VISUAL.md).

Found and fixed while building it:
- MobileWright 0.0.66 types `page.locator()` as Playwright's `Locator`, but types `expect()` for its own WebView
  locator class, so correct code did not type-check. Generated code uses a typed alias (runtime unchanged).
- Selenium/Appium read checkbox state differently in WebViews (`checked` is `"true"` or missing), so generated checks
  use `is_selected()` there.
- A selector matching several elements is reported as ambiguous even when the first match happens to be the target.

Not verified: a real phone, a real Chromedriver, MobileWright's mobilecli WebView bridge on hardware, and cross-origin iframes.

## 10. Milestone 5 status (interactions, assertion intelligence, reports, diagnostics, cleanup)

Done:
- the remaining spec §11 interactions (clear text, hide keyboard, launch/close app, deep link, wait enabled, activity
  check, screenshot checkpoint), in both frameworks where the framework has the API, validation errors where it does not;
- ranked suggestions with dynamic-value handling;
- unified execution reports (HTML + JSON) with history, retries and masking;
- failure diagnostics with evidence-based causes;
- crash-safe cleanup of interrupted runs (identity-verified).

Spec §13 items not covered: "relevant" hierarchy/DOM is the full snapshot at failure, not an excerpt around the failing
element. Details: [docs/REPORTS_AND_DIAGNOSTICS.md](docs/REPORTS_AND_DIAGNOSTICS.md).

Not verified: a real phone (deep-link resolution, keyboard hiding, build-type detection, startup timings on hardware).

## 11. Milestone 6 status (performance analyzer, benchmarks, usability, Windows distribution)

Done:
- performance analyzer and benchmark suite (spec §14) with repeated runs, medians and variation, equivalent workflows
  enforced by verification of the instrumented copy, debug/release labelling, no single-run conclusions;
- setup check, simplified UI (guide bar, Tools menu, shortcuts, run after save), Windows launchers and zip.

Not done / not verified:
- no benchmark on a real phone, so **no framework comparison is claimed**; measured here: real Appium 3.9 cold start
  (median 787 ms on a Linux container) and simulator-only runs (see docs/BENCHMARKS.md);
- the Windows launchers and zip were built and checked (CRLF, contents, the packaged recorder starts from the
  extracted folder) on Linux only; they have not been run on Windows;
- MobileWright's own device-connection time cannot be measured from outside its fixtures.

Spec §18 definition of done: functionality and existing features pass all suites on Node 22 and 24; generated code
runs against a simulated device only (real-device execution remains for you to confirm); diagnostics are actionable;
actual measurements are reported with their limits; limitations are listed here and in each document.
