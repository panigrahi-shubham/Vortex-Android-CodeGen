# Changelog

## 1.0.0-rc.1 — 2026-11-03

MobileWright v1 feature release candidate. Stable acceptance on physical devices remains pending.

- Added recording edits, move/duplicate controls, and insertion of explicit before/after assertions.
- Added overlapping-control selection and filtering of explicitly invisible pointer targets.
- Made suggested assertions opt-in and added structural coordinate/locator review.
- Added browser/server draft recovery with app/device metadata, secret stripping and stale-tab conflict protection.
- Added Fast/Stable capture policies and measured action/capture/total timings.
- Prevented coordinate fallback after a delivered locator-tap error; Plain/POM coordinate actions verify recorded screen dimensions.
- Avoided duplicate startup launch and duplicate successful final close in Plain/POM, retaining cleanup on failure.
- Bound replay metadata to saved app packages and rejected mixed-app batches and unresolved edited-output conflicts.
- Added unit, API and full browser recording/edit/recovery/save/replay coverage. These checks use simulated devices and the real MobileWright runner.

## 0.8.0-beta.1 — 2026-11-02

MobileWright-only beta for supervised recording and replay. This is a prerelease, not the stable v1.0 acceptance milestone.

- Retired the active Appium runtime, inspector, Python generator, routes and setup requirements.
- Kept MobileWright Plain/POM/Both exports, saved projects, replay, reports, benchmarks and device tools.
- Added a searchable snapshot inspector with locator alternatives, highlighted matches, bounds and pixel/percentage coordinates.
- Added position-based class locators for empty editable controls and an accessible in-page Type form.
- Protected stale captures, device leases and run preparation; simulated device IDs cannot select a physical phone.
- Kept the selected app package when inspecting another foreground app; added an actionable Maestro-conflict message.
- Preserved existing generated user tests and hand edits.

Known limitations: overlapping foreground/background hierarchy nodes can produce the wrong click locator; suggested checks can target background controls; generated recordings may need launch/cleanup/check refinement. Coordinate mode is an explicit workaround, not a guarantee of unattended replay. Locked phones, usage overlays and competing automation sessions can block a flow. DOM/CSS/XPath discovery is not available in the current inspector.

Real-device evidence: a manually optimized IndiaMART first-product price flow passed in 52.0 s and 45.7 s, including save, reopen and exact-price assertion. Another replay was blocked by a daily-usage overlay. The generated Add/Edit/Delete lifecycle has not yet passed the proposed ten-cycle release gate. Device captures, reports and live account recordings are excluded from source and release assets.

Earlier entries below describe historical versions, including features retired from this beta.

## 0.7.0 — Milestone 6 (performance analyzer, benchmarks, simpler UI, Windows distribution)

Added
- Performance analyzer: a saved case runs repeatedly in Appium Python and MobileWright with identical steps and checks
  (instrumented copy verified byte for byte against the saved Plain test), app restarted between runs, alternating
  order, warm-up runs. Phases: end to end, recorded steps, actions, check/wait steps, WebView switch, per step,
  Appium session creation and cleanup, MobileWright preamble; Appium probes for warm server reuse, device discovery,
  session creation, page source, contexts, locator resolution, session delete, and opt-in server cold start.
  Medians, min/max, stdev, variation; comparisons only with 5+ passing runs and a difference above 5 % and above
  2 x MAD. Build type (debug/release) and device in every report; simulated runs flagged.
  HTML/JSON export, **Tools › Benchmarks** dialog, `npm run bench` CLI.
- Setup check (`npm run doctor`, **Tools › Setup check**, guide bar): Node, adb, phone, Appium, UiAutomator2,
  ANDROID_HOME, Java, Python packages, MobileWright, Chromedriver; read-only, with the fix for each. Works on Node 20
  too (then it only checks Node and adb).
- Simpler UI: 3-step guide bar (Connect / Record / Save & run) with next-step hints and a Run button for the last saved
  case; *Run now* buttons after saving; primary actions visible and the rest under More; Tools menu; keyboard shortcuts
  and a help dialog; an empty state that explains how to start.
- Windows: `start-vortex.cmd` (double-click), `start-vortex.ps1`, `vortex.config.example.cmd`; `npm run package:windows`
  builds a self-contained zip (no `npm install` needed) with a SHA-256 file.
- pytest plugin: teardown timing. Runners: `record: false` keeps benchmark runs out of the run history.

Changed
- Header buttons *Appium Inspector* and *Devices* moved into **Tools ▾**; *Save debug snapshot* too. Nothing was removed.

Tests: 5 unit tests, 4 integration tests (95 unit, 35 integration in total).

## 0.6.0 — Milestone 5 (interactions, assertion intelligence, reports, failure diagnostics, safe cleanup)

Added
- Interactions: clear text, wait until enabled, hide keyboard, launch app, close app, open deep link, check the current
  screen (activity), screenshot checkpoint. Recorded from *Clear text* and the new **More ▾** menu, generated in all four
  variants. MobileWright 0.0.66 has no hide-keyboard or activity API: those steps are validation errors there.
- Deep links and package names are validated before reaching `adb shell`.
- Suggestion ranking: state changes first, stable ids above labels and text, dynamic exact-text checks become visibility
  checks with the reason shown, duplicates merged, at most six.
- Execution reports for every run: device, Android version, build type and app version, timings including session
  startup, results, failing step, diagnosis, failure screenshot, hierarchy, WebView DOM, checkpoints, log, retry chain.
  **Reports** dialog with filters; self-contained HTML and JSON exports; both also written to the run folder.
- Secret masking for reports and run output (values of `VORTEX_SECRET_*`, `*PASSWORD*`, `*TOKEN*`, `*SECRET*`, `*OTP*`,
  `*API_KEY*` variables).
- Failure diagnostics: 14 causes with a next step each, matched on the real messages of pytest/Selenium and MobileWright.
- Retries (0–3) for automation failures; each attempt keeps its own report.
- Run journal and recovery: runs interrupted by a recorder crash are stopped (identity-verified), their sessions closed
  when possible, and recorded as *interrupted*.
- Python: failure DOM capture in WebView blocks; the plugin records session startup time and the foreground app at failure.

Fixed (found by the new tests)
- The generated activity check contained a NUL byte, which Python refuses to load.
- Diagnosis matched text inside Selenium's own source printed in pytest tracebacks; only `E` lines count now.
- The report detail view returned unmasked error details (exports were masked); records are now masked when loaded.

Tests: 6 unit tests, 4 integration tests (90 unit, 31 integration in total).

## 0.5.0 — Milestone 4 (WebView inspection, CSS locators, context switching, visual fallback)

Added
- WebView diagnostics: read-only adb and session checks.
  - Categories: debugging disabled, not active, not detected, incompatible Chromedriver, incorrect context,
    unsupported implementation, missing DOM access, device transport, unknown. Each comes with evidence and next steps.
  - The CPU architecture is never used as an explanation.
- Appium Inspector WebView mode:
  - contexts and pages, switching context, multiple WebViews;
  - read-only DOM snapshot including same-origin iframes, with element highlight mapped to screen pixels;
  - CSS/XPath candidates verified in the live WebView, with explained scores;
  - selector search per document or iframe;
  - recording tap, type and checks through a verified selector;
  - return to native after any failure.
- WebView steps in the recording model (context, WebView, page, iframe path). All four generators support them:
  - MobileWright: `getByWebView().page()` blocks and `<Page>WebPage` POM classes;
  - Python: `with webview(driver, frames=..., url=...)` blocks.
  - Steps MobileWright 0.0.66 cannot express (iframes, selected, long-press in web) are validation errors.
- Chromedriver executable/folder in Server settings, passed to the Inspector and to pytest runs. Automatic downloads
  are never enabled.
- Visual fallback:
  - template matching (greyscale ZNCC, coarse-to-fine, scales 0.8 to 1.25, region of interest, colour check,
    ambiguity check) with confidence and limitations;
  - *Find on screen* with confirmed reposition;
  - a no-screen-change warning after taps.
- Synthetic WebView screen (Market Insights) on the sample app, for the mock device, the simulated Appium (WebView served
  by a real headless Chromium) and the fake MobileWright driver.
- 6 unit tests and 4 integration tests. Measured timings are in docs/WEBVIEW_AND_VISUAL.md.

Changed
- Native generation is unchanged. Recordings from 0.4 open unchanged (missing context = native).


## 0.4.0 — Milestone 3 (shared recording model, Plain/POM/Both, both frameworks)

Added
- Recording model v1 (`recording.json`): every output is generated from it. Older step lists open through a versioned
  migration, and files from a newer version are refused.
- Framework choice MobileWright / Appium Python / both. Mode choice Plain / POM / Both, with an explicit run target in
  Both mode. The other entry file gets a name the runners do not discover.
- POM generators for both frameworks: one page class per screen, each locator once, one method per action used, fixtures,
  and a data file. Checks after an action are placed on the page that follows it.
- Project layout `<out>/<module>/<case>/` with `vortex-manifest.json` (SHA-256 per file). A hand-edited file is never
  replaced silently: the new version is written as `.vortex-new` for review. Stale generated files are cleaned up, previous
  recordings are kept in history, and every write is atomic and path-checked.
- MobileWright runner (the project's own `mobilewright test`, telemetry off). It writes a per-run wrapper config that
  reuses your config, produces structured results from the JSON report, maps failures to the recorded step, and
  supports cancel, timeout and the device lock. Runs can cover one test, a module or everything.
- Appium runs can cover several files, POM tests and Both-mode alt files. Run reports go into the case folder, and the
  history covers both engines.
- Pages are named after the foreground activity and can be renamed per step. Sensitive input is never stored and is read
  from `VORTEX_SECRET_*` at run time. Project & runs can reopen a saved recording.
- Fake MobileWright driver over the sample screens (tests and `--mock`). 10 unit tests and 10 integration tests;
  generated TypeScript is type-checked against the real @mobilewright/test 0.0.66.

Changed (intentional, versioned)
- MobileWright output format v2 for Plain and POM. `.nth()` now counts exact matches, checks use the retrying
  matchers, coordinate long-press and double-tap are supported, and Type or Scroll-to without a locator is now a
  validation error. See docs/PROJECTS_AND_MODES.md. The v0.1 single-file format is unchanged and still available.
- Runs panel renamed *Project & runs*.

Unchanged
- Recording, locator ranking, suggestions, the v0.1 MobileWright generator, and Appium Python Plain output for the same steps.


## 0.3.0 — Milestone 2 (Appium engine)

Added
- Appium Python (pytest) output from the same recording, with validation errors instead of placeholders.
- Saving Python tests never replaces a different existing file without asking.
- Runs panel: run saved tests only, live output, cancel, timeout, pass/fail/error/no-tests classification from pytest exit
  code plus JUnit, failing step, failure screenshot and page source, session cleanup, run history.
- Appium Inspector: UiAutomator2 session, native hierarchy and properties, locator candidates verified on the device
  with explained scores, copyable Python and MobileWright code.
- Device lock: the recorder, the Inspector and a test run never drive the same phone at once.
- Simulated UiAutomator2 server (`npm run mock-appium`) for tests and demos without a phone.
- requirements-appium.txt; docs/APPIUM_ENGINE.md; 20 unit and 8 end-to-end tests.

Changed
- Recorded steps keep framework-neutral locator details; swipes keep their start and end points.
  MobileWright output is byte-identical to 0.2.0.

## 0.2.0 — Milestone 1 (Vortex Android Recorder)

Added
- Appium Server Manager: Start Server, Connect Existing, Disconnect, Stop Owned Server, Restart Owned Server,
  Clean Up Vortex Sessions; ownership by PID + start time + command line; active-run protection; crash recovery;
  keep-warm and stop-on-exit settings; Appium log viewer with secret masking.
- Devices panel: adb device list (USB / emulator / Wi-Fi, unauthorized, offline) and device details including
  Android version, screen, density and CPU ABIs.
- Disconnected-phone banner and automatic browser-side saving of unsaved steps with Restore/Discard.
- BASELINE_AUDIT.md, docs/ARCHITECTURE.md, docs/SERVER_MANAGER.md.
- 48 unit tests, 5 integration tests against a real Appium server, `npm run typecheck`.

Changed
- Every request must be addressed to localhost; state-changing requests must come from the recorder page and be JSON
  (blocks other websites from driving the local API).
- Renamed to Vortex Android Recorder (UI title, package name, log prefix). Recording and generated MobileWright code are unchanged.
- README: company-specific paths replaced with generic examples.
