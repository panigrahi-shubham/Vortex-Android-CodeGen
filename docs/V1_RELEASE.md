# MobileWright v1.0.0-rc.1

This is the implemented v1 feature set, packaged as a release candidate while physical-device acceptance remains pending. The Appium Inspector remains a separate project. This recorder uses MobileWright 0.0.66 and does not add another device automation engine.

## New behavior

- Edit recorded titles, replacement input, assertion values, wait durations, comments and advanced locator parts. Move, duplicate and delete steps without acting on the phone.
- Insert a check before or after any step using a control selected from the current screenshot. Recording review highlights coordinate actions without neighboring assertions and locators that depend on position. These checks are structural reminders, not proof that an arbitrary assertion identifies the correct app state.
- Suggested assertions require explicit acceptance. Existing accepted checks in saved recordings are preserved.
- Explicitly invisible controls are excluded from pointer selection. Overlapping unrelated exposed controls stop direct recording and present a control chooser. Accessibility trees do not always expose visibility or drawing order; the operator still reviews the highlight and locator.
- Fast capture performs one fresh capture after an action; Stable capture retains consecutive-tree comparison. Capture timings are visible. Network completion requires explicit replay assertions.
- Browser and server draft recovery retain app/device metadata. Atomic server draft updates use revisions to reject conflicting tab writes. Unreadable drafts remain intact for manual recovery. Secret input values are stripped; environment variable references remain.
- Plain/POM generation avoids a duplicate first app launch and duplicate normal final close, while keeping cleanup after failures.
- Coordinate fallback occurs only when the locator is absent. A delivered locator tap that errors is never retried as a coordinate tap. Plain/POM coordinate taps check original screenshot dimensions first and stop on mismatch. Equal dimensions cannot establish the same screen, orientation-dependent layout, keyboard state or target identity: keep relevant before/after assertions.
- Replay metadata is bound to the saved case's app package. Mixed-app batches and cases with pending edited-file conflicts are rejected. Input APIs require the current screen token and valid coordinate bounds. Failed refreshes invalidate old hit targets.

## Verification

Run `npm test`, `npm run typecheck`, and the integration suite with `VORTEX_MOBILEWRIGHT_DIR` and `VORTEX_PLAYWRIGHT` pointing to the installed test project. The suite exercises the real MobileWright runner against synthetic TradeHub screens and Chromium-based simulated WebViews.

Additional RC tests cover recording edits, duplicate/move isolation, secret rejection, overlap ambiguity, server draft recovery/conflicts, fallback behavior after a delivered error, coordinate geometry mismatch, explicit lifecycle generation, HTTP capture timings, mixed-app rejection, and browser record/edit/restore/save/replay.

Windows verification on 2026-11-03: 28/28 legacy checks; 57 unit/safety checks passed with one Linux-only skip; 16/16 integration tests passed; TypeScript checking passed. The integration tests include generated Plain/POM type checking and execution, Native → WebView → Native, benchmarking, browser draft recovery and replay, and starting the extracted Windows package without node_modules. These are simulated-device results.

## Stable v1.0 acceptance

The stable release gate remains ten consecutive unattended Add → Edit → Delete lifecycles on a real phone, using unedited UI-generated scripts and uniquely identified test products. Each cycle must assert creation, reopen and verify the updated value, then delete only its own product. Include exposed web controls and deliberate coordinate actions, and record failures rather than silently retrying writes.

These live acceptance cycles have not been completed in this change. The historical individually optimized price updates are not substitutes for this gate. No 500-case IndiaMART regression suite is claimed or included.

Current limits remain: no DOM acquisition in this UI; inaccessible WebViews expose only available native text/IDs or explicit coordinate points. Native class/position locators can change with layout. Real social login, permissions, network behavior and OS dialogs need hardware validation. The legacy single-file exporter retains its older feature surface; use Plain/POM for the v1 editor and geometry protections.
