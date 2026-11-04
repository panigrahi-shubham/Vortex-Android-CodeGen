# Vortex Android Recorder 2.0.0-beta.1

Released 2026-11-04 for supervised Android inspection, recording and MobileWright replay. This is a beta: the unattended physical-device Add → Edit → Delete acceptance gate remains open. Appium is maintained in a separate project.

## New in 2.0

- ADB shortcuts for text, key events, clear, taps, swipes, long press, app lifecycle, URLs, screenshots and diagnostics, plus pasted commands or JSON argument arrays.
- Run only, Add to script, Run & record, Copy ADB command and Copy script step. Output stays in the panel; binary output can be downloaded. Command timeouts are configurable from 1 to 300 seconds and remain attached to saved steps.
- ADB step editing changes the argument array and timeout without acting on the device. A sensitive argument remains a `<secret>` placeholder, including when it moves to another position.
- Plain/POM ADB helpers target the transport serial supplied for the current run. They never use a MobileWright alias as an ADB serial. Simulated replay refuses raw ADB instead of contacting connected hardware.
- Whole-value Quick type and keypad coordinate recording. Android EditText, TextField, AutoCompleteTextView and MultiAutoCompleteTextView controls are recognized as editable.
- Quick preview and Quick type screenshot feedback avoid the hierarchy lookup. Previewed images have no active hit targets; Refresh restores the current hierarchy. Full captures take their screenshot after hierarchy lookup, reducing the age of returned images.
- Inspect copies include locators, IDs, text, classes, details, pixel/percentage coordinates, ADB taps and MobileWright tap statements. Copy-on-selection is optional.
- Copy current file, Copy script and Copy all files regenerate current steps before copying. Plain/POM outputs retain their required helpers and secret references. A clipboard fallback dialog supports manual copying.
- The Windows distribution includes a read-only StockPilot smoke example and launcher, plus the 20-scenario acceptance checklist.
- `--mobilecli-device` explicitly separates the inspector's Mobilecli alias from ADB's transport serial. PowerShell launchers expose both device parameters.

The v1 recording editor, draft revision protection, secret stripping, explicit assertion selection, scoped locators, coordinate dimension checks, device leases, reports and benchmarks are retained.

## Verify the release

Run `npm ci`, `npm test` and `npm run typecheck`. For full integration checks, install `@mobilewright/test@0.0.66` and Playwright in an external/generated project, then point `VORTEX_MOBILEWRIGHT_DIR` and `VORTEX_PLAYWRIGHT` to it before running `npm run test:integration`. Integration fixtures use the real MobileWright runner with synthetic device data and Chromium WebViews; their passes are not physical-device acceptance.

`npm run package:windows` creates a ZIP and SHA-256 file under `dist`. The packaging test extracts the ZIP and starts its mock server without node_modules. Source and release assets exclude generated account recordings, device captures, local state, credentials and reports.

Windows release validation on 2026-11-04: 28 legacy checks passed, 65 unit/safety checks passed with one Linux-only skip, all 23 integration tests passed, and TypeScript checking passed. The package extraction/startup check is included in those integration results. A separate read-only emulator check exercised the explicit Mobilecli alias and both screenshot-only and full evidence capture; no product data was changed.

The live emulator evidence obtained during development covers read-only ADB diagnostics, StockPilot home smoke, and a deliberate invalid IndiaMART OTP (`2455`) that displayed “Please enter correct OTP.” It does not establish full product CRUD reliability.

## Remaining limits

- No live DOM acquisition or CSS/XPath discovery. Release WebViews depend on exposed native controls or explicit coordinates.
- A screenshot preview is not synchronized hierarchy evidence and does not establish that a network operation completed. Add result assertions and refresh before selecting controls.
- ADB text entry has Android keyboard/input-method limitations; Quick type restricts its input to printable ASCII. Commands execute as explicit argument arrays; remote pipelines require `shell sh -c`.
- The dedicated hide-keyboard and activity-assertion exports remain unsupported by the pinned MobileWright surface. Generation reports those limitations. Use a recorded Back action or a screen-specific element assertion where appropriate.
- Legacy exports reject Quick type and raw ADB actions; use Plain or POM.
- Run the [20-scenario checklist](ACCEPTANCE_20.md), then ten unattended Add/Edit/Delete cycles using uniquely named test products before promoting this beta as a stable production release. No 500-case application suite is included.

## Compatibility and rollback

Node.js 22.18+ and Android platform-tools are required. Replay targets MobileWright 0.0.66. Existing recordings keep schema version 1 with additive optional fields; older recordings can be loaded. Older Vortex releases may reject new action names and should not rewrite a 2.0 recording. Keep the previous release ZIP and saved tests when evaluating this beta.
