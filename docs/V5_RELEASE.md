# Vortex 5.0.0-beta.1

V5 adds live WebView recording to V4's DOM inspector. It uses MobileWright 0.0.69 and keeps recording schema version 1. This is a local beta build, with no automatic GitHub publication.

## Live recording workflow

1. Start the recorder against an authorized device and app using the default Mobilecli hierarchy owner. Open the WebView on the phone.
2. Open **WebView DOM**, find pages, explicitly select one and inspect it. Select a DOM control and review its CSS selector and match count.
3. Choose **Run & record**. Tap executes DOM click; type replaces the field contents; clear empties the field. Each completed action appends one recording step and refreshes the native screen/DOM. Assertions are still added for replay.
4. For sensitive typing, provide an environment-variable name for future replay and enter the value for this live action in the separate password field. The live value is not saved in recorded input or receipts. Password fields require an environment reference.
5. Continue against the refreshed page, save, and replay with Plain/POM/Both as before. **Add step only** remains available for designing a flow without executing it.

The click/fill primitives match MobileWright's supported DOM semantics. They do not provide trusted OS input; keyboard-only/opaque interactions may still need the existing native/ADB workflows.

## Delivery and recovery

Each live request gets a unique ID. Vortex persists a sanitized receipt before dispatch; a repeated ID returns the earlier result without repeating the action. Receipts live under the recorder's state folder in `webview-actions/`. Failures before dispatch prevent the action. A device response lost after dispatch is an unknown outcome, not permission to try again automatically.

Use **Recover last action result** after a lost browser response. A completed step is inserted once and only for the matching app/device. If the recorder restarted while a receipt was unfinished, its outcome becomes unknown. Inspect the app and explicitly choose **I reviewed the outcome** before starting a new live request. The pending ID survives browser reload in local storage; server receipts must also be retained in the same state folder. A corrupt/unavailable receipt is not evidence the action did not happen.

Completed action and refreshed observation are separate results. A capture failure preserves the completed step and asks for a fresh inspection. The recorder never automatically repeats a mutation to recover an image or DOM snapshot. This mechanism does not promise exactly-once business behavior across different request IDs or retries inside the app.

## Privacy and process ownership

The real-device live path uses an owned, loopback-only Mobilecli HTTP front end and the existing daemon. It sends values through JSON request bodies, avoids putting them in process arguments/temp scripts, discards front-end console output, and sanitizes transport errors. No new external service or network grant is required. Only the owned front end is stopped at shutdown.

Live sensitive input is separate from the replay environment reference. Receipt files contain sanitized step metadata and outcome, not `liveText`. DOM collection still excludes field values. The app may nevertheless echo user input into visible text, URLs or screenshots, so review recordings/artifacts before sharing. This beta does not redact arbitrary app content or guarantee compatibility with every controlled form.

## Scope and validation

Frames/shadow DOM, DOM-to-native screenshot overlays, live assertions and a remote phone bridge are outside this release. Existing native inspection and V4 page-mapping/replay guards remain. The mock native image is static while its Chromium DOM state changes; inspect DOM for simulated live results.

Run `npm test`, `npm run typecheck`, and `npm run test:integration` with the supported runner and Chromium installed. V5 tests exercise native DOM setters/events, covered/stale/ambiguous targets, live type/clear/tap, double-click suppression, lost-response recovery, request deduplication, receipt privacy and Plain/POM replay. Unit tests also cover unknown outcomes, capture failure, interrupted receipts, journal write failures and owned transport lifecycle.

Build `dist/vortex-android-recorder-5.0.0-beta.1-windows.zip` and its SHA-256 file with `npm run package:windows`. Linux simulation/packaging evidence does not establish physical-device or native Windows acceptance; those remain pending.
