# Vortex Android Recorder

**v5.0.0-beta.1 — Live WebView recording.** Inspect WebView DOM elements, then explicitly choose **Run & record** to tap, type or clear on the app and append the executed step. Persistent action receipts support recovery without repeating a request. Uses MobileWright 0.0.69 and retains V4 inspection and device recovery. See [V5 notes](docs/V5_RELEASE.md). This is a local beta build; physical-device acceptance remains pending.

Local Android inspector, recorder and code generator for MobileWright. Requires Node.js 22.18 or newer, Android platform-tools on PATH, and a USB/Wi-Fi debugging connection. Replay uses the installed MobileWright project; Vortex does not download a runner on demand.

Build the V5 Windows ZIP and checksum with `npm run package:windows`; output is under `dist/`. Node.js, ADB and the replay runner are installed separately. The [published V2 archive](https://github.com/panigrahi-shubham/Vortex-Android-CodeGen/releases/tag/v2.0.0-beta.1) is an older release and does not contain V4/V5 features.

## Start

Install this project's development dependencies with npm install. In the output project, install the supported runner if it is missing:

    mkdir generated
    cd generated
    npm init -y
    npm install -D @mobilewright/test@0.0.69
    cd ..
    npm start -- --out generated --pkg com.example.yourapp --device YOUR_ADB_SERIAL

Use your own package and adb serial (from adb devices). Open http://localhost:4700. To inspect sample screens without a phone, use npm run mock. Node.js and ADB must be installed separately, including when using the Windows ZIP.

If Mobilecli names your emulator differently from ADB, supply its ID separately. For the development emulator used here:

    npm start -- --out generated --pkg com.indiamart.m --device emulator-5554 --mobilecli-device Pixel_10_Pro_XL_2

This avoids a custom shell tree command. Get Mobilecli IDs with `node generated/node_modules/mobilecli/index.js devices --platform android`. ADB commands continue to use the transport serial. The PowerShell launcher accepts `-Device` and `-MobilecliDevice` too.

If the recorder is already running, open its existing window. A duplicate start reports the occupied port without recovering or stopping the existing recorder's work.

## Device connection and recovery

The development runner targets MobileWright **0.0.69**. Open **Tools → Devices** to refresh the device list, select a ready device without restarting Vortex, or recover the selected device after reconnecting it. Missing, offline and unauthorized devices show specific guidance. Recovery discards old screen targets and requires **Refresh screen** before recording more actions; it keeps existing recorded steps and never silently chooses another phone. An optional Mobilecli alias can be supplied for a new selection; otherwise it uses the ADB serial.

For an already-paired Wi-Fi debugging device, enter its **connection address** (for example `192.168.1.40:5555`) and choose **Connect**, then explicitly **Select** it. Pair the device on the Vortex host separately; the panel does not collect pairing credentials or enable debugging. The connection must be reachable from the machine running Vortex. A USB phone attached to your own computer is not automatically available inside a cloud environment. Selection and aliases apply to the current server session; use `--device` and `--mobilecli-device` to set startup defaults.

Mock mode displays simulated devices and refuses physical connection commands. These features are included in V5. Physical-device acceptance remains pending; the [historical V3 roadmap](docs/V3_ROADMAP.md) records the earlier proposals.

## Inspect and record

The default Inspect mode selects a control without tapping the phone. Search the captured hierarchy by text, accessibility label, identifier or class. Selection shows available locators, match highlights, state, bounds, pixel center and percentage coordinates. Copy a locator or point, then explicitly choose Record tap, Record type, Add assertion or Record coordinate tap.

Refresh after navigating on the phone. Match counts refer to the captured hierarchy; they do not certify future replay. Prefer stable IDs or labels; duplicate text and position locators need review. Coordinates depend on screen size and layout.

When multiple unrelated controls overlap, direct recording switches to inspection without acting. Use **Controls at this point** to choose the intended control and review its highlight. Controls explicitly marked invisible are excluded from pointer selection; missing visibility data is not treated as proof of foreground ownership.

Every recorded step has **Edit**, **Move up/down**, **Duplicate**, **Check before** and **Check after** controls. Edit input text, expected values, wait duration, comments or advanced locator parts. Select a control from the current screenshot before inserting a check around an existing step. Those checks are added to the replay script; they do not execute immediately on the phone. Suggested checks start unchecked. **Recording review** flags positional targeting and coordinate actions without neighboring result checks.

**Fast capture** takes one fresh tree/screenshot after each action. **Stable capture** compares consecutive trees. Full captures take their screenshot after the tree lookup finishes. **Quick preview** takes only a screenshot and invalidates old hit targets until Refresh; it does not claim synchronized controls or completed network activity. The timing readout separates action, capture and total elapsed time. Record a destination or persisted-result assertion.

Drafts preserve the package, device identity and capture policy, and are stored in the browser and `.vortex/recording-draft.json`. A server copy can restore a recording even after browser storage is cleared. Revision conflicts prevent one tab from silently replacing another tab's draft. Sensitive input values are removed; only environment-variable references are kept. Save to the project for a durable, versioned test.

Tap, long press, double tap, swipe, typing, clear, scroll-to, waits, assertions and app/navigation actions feed the recording. Unsupported generation is reported before saving. For Type, choose an exposed editable field with a replayable locator.

**Quick type** sends the entire value with ADB to the already focused field. Screenshot-only feedback is the default; uncheck it in the input dialog for a full capture. It appends without selecting or clearing text, so focus the intended input and clear existing digits first. Quick type accepts printable ASCII (including OTP digits). Its recorded value defaults to `VORTEX_SECRET_FOCUSED_TEXT`; set that environment variable to a fresh value before replay. Plain/POM replay calls the supported `device.driver.typeText()` API. For keyboards whose keys are absent from the hierarchy, **Keypad taps** records explicit screen coordinates instead; each individual tap still captures the screen.

**ADB shortcuts** provides text, key events, clear, tap, swipe, long press, app launch/close, URLs, screenshots and diagnostic presets. Paste a custom ADB command or a JSON argument array for other commands. Use **Run only**, **Add to script**, **Run & record**, **Copy ADB command** or **Copy script step**. Choose no capture (default), screenshot-only preview, or a full capture. Skipped captures and previews invalidate old controls, so refresh before acting on screen controls. Set the command timeout from 1 to 300 seconds; it is retained in the script. Step **Edit** can change its argument array and timeout while retaining a `<secret>` placeholder. Output is shown in the panel, with a download for binary output. Host shell syntax is not executed; Android pipelines can explicitly use `shell sh -c "..."`. Commands always target the selected transport serial. Mark a sensitive last argument to save its environment-variable reference instead of its value.

Plain/POM exports include an `adbCommand` helper. Vortex supplies `VORTEX_ADB_SERIAL` from the selected device at replay time, independently of MobileWright's device alias. Set that variable yourself when running an exported test outside Vortex. Raw ADB steps refuse simulated replay so a mock run cannot contact connected hardware. Legacy exports reject ADB steps instead of omitting them.

For a read-only StockPilot home smoke test on a connected emulator, install the supported runner in `generated` as above, then run `npm run smoke:stockpilot -- --device emulator-5554`. The test launches StockPilot, optionally dismisses its offer dialog, checks the home/search/cart controls, attaches a screenshot and closes the app. It does not create or edit business data.

Inspect offers copies of the locator, ID, text, class, bounds/details, pixels, percentages, ADB tap command and MobileWright tap statement. **Copy when selected** optionally copies a locator/ID/text/ADB tap as you inspect. **Copy current file**, **Copy script** and **Copy all files** regenerate current steps before copying; all-files output includes file-name headers for multi-file POM exports. A selection dialog is available when clipboard permission is unavailable.

## Web content

Open **WebView DOM → Find pages / refresh**, explicitly choose a page, and select **Inspect page**. Search visible top-level DOM elements by text, label, DOM id or CSS. Select an element to inspect its selector, actual match count, state and CSS bounds.

**Add step only** preserves V4's recording-only workflow. Choose **Run & record** to execute tap, type or clear immediately and append one completed step. Input replacement uses the native DOM value setter plus input/change events, matching the supported MobileWright WebView primitives. Assertions are still added for replay. Every mutation rechecks the page and target, uses the recorder's device lease, and invalidates the preceding snapshot. The panel refreshes after completion; a refresh failure keeps the completed step and asks you to inspect again.

Sensitive input uses two separate fields: an environment variable name for replay, and a **Value for this live action** used only for execution. The latter is not put in command arguments, receipt files or recorded steps. Password fields require an environment reference. Screenshots and page text can still show whatever the app itself displays or echoes; review them before sharing.

If a response is lost, use **Recover last action result**. Receipts under the recorder's state folder prevent the same request ID from dispatching twice, including after restart. An unknown outcome requires checking the app and explicitly acknowledging review before a new live action. Recovery never automatically repeats the action. A completed step is added only once, and recovery checks the matching app/device.

No exposed page means DOM inspection is unavailable, not that the app has no WebView. Native accessibility inspection and explicit coordinates remain available. Several pages require reliable native-to-page mapping before replay steps can be added. Frames and shadow DOM are not traversed. DOM bounds remain CSS pixels, independently of Android screenshot coordinates. See [WebView details](docs/WEBVIEW_AND_VISUAL.md).

## Save and replay

MobileWright is the only active engine. Plain generates a standalone TypeScript test; POM generates pages, fixtures, test data and tests. Both writes both variants with one discoverable run target. The legacy single .spec.ts export is also retained.

Project & runs opens saved cases, starts a case/module/all tests, streams output, cancels a run and shows history/reports. Retries require an explicit repeat-safe confirmation because tests may change app data. Saving protects hand edits with a .vortex-new file. Old exporter files already in generated are preserved as user data and are not offered as MobileWright run targets.

Plain/POM replay uses a case's saved app package. Mixed-app module/all batches and cases with pending `.vortex-new` review are rejected. An explicit first Launch step avoids a duplicate startup launch, and normal cleanup avoids repeating an explicit successful final Close. Failed tests still attempt app cleanup. Name-with-coordinate fallback now uses coordinates only when the locator is absent; a failed delivered locator tap propagates without a second tap. Plain/POM coordinate actions verify recorded screen dimensions against a fresh PNG before sending a tap; this checks dimensions, not page identity or element position.

Tools contains device details, setup checks and benchmarks. Benchmarks repeat a saved MobileWright flow, report timings and variation, and label simulated devices. Resetting or replaying a flow can repeat its changes.

## Configuration

Command-line options: --out, --pkg, --device, --mobilecli-device, --port, --state-dir, --no-open, --mock, --tree-source and --tree-cmd. Their environment counterparts are OUT_DIR, PKG, DEVICE, MOBILECLI_DEVICE, PORT, VORTEX_STATE_DIR, TREE_SOURCE and TREE_CMD. Default port is 4700; output and state folders default to generated and .vortex.

The default tree source uses local node_modules/mobilecli when available. It passes the selected serial. A failed installed Mobilecli request does not start competing uiautomator instrumentation. Explicit --tree-source uiautomator remains available for environments without a running Mobilecli automation owner.

## Verification

    npm test
    npm run typecheck
    npm run doctor -- --out generated

Integration tests require an installed MobileWright project and Playwright/Chromium for the simulated WebView fixture. In PowerShell set VORTEX_MOBILEWRIGHT_DIR and VORTEX_PLAYWRIGHT to the absolute generated project path, then run npm run test:integration. Simulated tests are reported as simulated and do not establish phone performance.

Historical beta checks and live-device evidence are documented in docs/BETA_RELEASE.md. Current release-candidate checks are documented in docs/V1_RELEASE.md. Integration tests use simulated devices with the real installed MobileWright runner; passing them does not establish physical-phone reliability. The configured GitHub CI also targets Linux; local Windows results do not establish a Linux CI pass.

## Migration

The active Appium server manager, sessions, inspector, Python generation/runs, routes and setup checks have been removed. Existing generated tests are retained as user data. The separate future rebuild prompt remains in docs/VORTEX_INSPECTOR_REBUILD_PROMPT.md; it is a design reference, not an implemented feature list.

See docs/ARCHITECTURE.md, docs/PROJECTS_AND_MODES.md, docs/AUTOMATIC_RECORDING.md, docs/WEBVIEW_AND_VISUAL.md, docs/REPORTS_AND_DIAGNOSTICS.md and docs/BENCHMARKS.md for details.
