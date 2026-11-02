# Vortex Android Recorder

**v0.8.0-beta.1 — supervised testing prerelease.** Read [the beta limitations](docs/BETA_RELEASE.md) before recording or replaying flows that change live data.

Local Android inspector, recorder and code generator for MobileWright. Requires Node.js 22.18 or newer, Android platform-tools on PATH, and a USB/Wi-Fi debugging connection. Replay uses the installed MobileWright project; Vortex does not download a runner on demand.

## Start

Install this project's development dependencies with npm install. In the output project, install the supported runner if it is missing:

    mkdir generated
    cd generated
    npm init -y
    npm install -D @mobilewright/test@0.0.66
    cd ..
    npm start -- --out generated --pkg com.example.yourapp --device YOUR_ADB_SERIAL

Use your own package and adb serial (from adb devices). Open http://localhost:4700. To inspect sample screens without a phone, use npm run mock. Node.js and ADB must be installed separately, including when using the Windows ZIP.

If the recorder is already running, open its existing window. A duplicate start reports the occupied port without recovering or stopping the existing recorder's work.

## Inspect and record

The default Inspect mode selects a control without tapping the phone. Search the captured hierarchy by text, accessibility label, identifier or class. Selection shows available locators, match highlights, state, bounds, pixel center and percentage coordinates. Copy a locator or point, then explicitly choose Record tap, Record type, Add assertion or Record coordinate tap.

Refresh after navigating on the phone. Match counts refer to the captured hierarchy; they do not certify future replay. Prefer stable IDs or labels; duplicate text and position locators need review. Coordinates depend on screen size and layout.

Tap, long press, double tap, swipe, typing, clear, scroll-to, waits, assertions and app/navigation actions feed the recording. Unsupported generation is reported before saving. For Type, choose an exposed editable field with a replayable locator.

## Web content

WebView content can expose text, IDs and editable controls through Mobilecli. Inspect these like other controls. If a WebView exposes only a rectangle, use an explicit coordinate action. This recorder does not capture a DOM or discover CSS/XPath selectors. A debug build alone does not add DOM inspection to this UI. Older recordings with supported web locator data can still generate MobileWright code; see docs/WEBVIEW_AND_VISUAL.md.

## Save and replay

MobileWright is the only active engine. Plain generates a standalone TypeScript test; POM generates pages, fixtures, test data and tests. Both writes both variants with one discoverable run target. The legacy single .spec.ts export is also retained.

Project & runs opens saved cases, starts a case/module/all tests, streams output, cancels a run and shows history/reports. Retries require an explicit repeat-safe confirmation because tests may change app data. Saving protects hand edits with a .vortex-new file. Old exporter files already in generated are preserved as user data and are not offered as MobileWright run targets.

Tools contains device details, setup checks and benchmarks. Benchmarks repeat a saved MobileWright flow, report timings and variation, and label simulated devices. Resetting or replaying a flow can repeat its changes.

## Configuration

Command-line options: --out, --pkg, --device, --port, --state-dir, --no-open, --mock, --tree-source and --tree-cmd. Their environment counterparts are OUT_DIR, PKG, DEVICE, PORT, VORTEX_STATE_DIR, TREE_SOURCE and TREE_CMD. Default port is 4700; output and state folders default to generated and .vortex.

The default tree source uses local node_modules/mobilecli when available. It passes the selected serial. A failed installed Mobilecli request does not start competing uiautomator instrumentation. Explicit --tree-source uiautomator remains available for environments without a running Mobilecli automation owner.

## Verification

    npm test
    npm run typecheck
    npm run doctor -- --out generated

Integration tests require an installed MobileWright project and Playwright/Chromium for the simulated WebView fixture. In PowerShell set VORTEX_MOBILEWRIGHT_DIR and VORTEX_PLAYWRIGHT to the absolute generated project path, then run npm run test:integration. Simulated tests are reported as simulated and do not establish phone performance.

Beta release checks on Windows (2026-11-02): 28 legacy checks passed; 51 unit/safety tests passed with one Linux-only skip; all 14 integration tests passed. Typecheck and the mocked inspector UI smoke check passed. Real-device evidence and its limits are documented in docs/BETA_RELEASE.md. The configured GitHub CI also targets Linux; local Windows results do not establish a Linux CI pass.

## Migration

The active Appium server manager, sessions, inspector, Python generation/runs, routes and setup checks have been removed. Existing generated tests are retained as user data. The separate future rebuild prompt remains in docs/VORTEX_INSPECTOR_REBUILD_PROMPT.md; it is a design reference, not an implemented feature list.

See docs/ARCHITECTURE.md, docs/PROJECTS_AND_MODES.md, docs/AUTOMATIC_RECORDING.md, docs/WEBVIEW_AND_VISUAL.md, docs/REPORTS_AND_DIAGNOSTICS.md and docs/BENCHMARKS.md for details.
