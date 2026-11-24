# Web content and visual fallback

## V5 WebView inspection and live recording

The main recorder still inspects native accessibility through Mobilecli. The separate **WebView DOM** panel discovers inspectable pages using `mobilecli webview list` and evaluates a fixed read-only DOM collector in the explicitly selected page. It reuses the same daemon and serialized device lease. It does not create an Appium/Chromedriver session or download another driver. Real-device DOM inspection requires the default Mobilecli hierarchy source; mixing it with uiautomator or a custom tree command is rejected.

The panel shows visible top-level elements, text/labels, DOM ids, enabled/editable state, candidate CSS selectors, actual match counts, and CSS bounds. Stable attributes are preferred when unique; positional DOM paths are marked for review. Each snapshot includes up to 400 visible candidate elements and scans at most 3000 candidates. Truncation and iframe counts are reported. Frames and shadow DOM are not traversed. DOM bounds use CSS pixels, independently of the Android screenshot geometry; the beta does not claim a synchronized overlay.

Choose **Add step only** to append a replay step without changing the app. Choose **Run & record** to execute tap/type/clear now and append the completed step. Assertions remain recording-only. The synchronous action checks URL, unique selector, element identity, visibility, enabled/editable state and whether another element covers the target before dispatch. Click uses DOM `click()`; type/clear use the prototype value setter (or contenteditable text) and input/change events. These match the supported MobileWright 0.0.69 primitives and are not trusted OS touch/keyboard events.

The recorder serializes actions under the existing device lease. It starts an owned Mobilecli HTTP front end on a loopback ephemeral port only when needed for real live actions; this talks to the existing daemon and does not create a competing driver. Live values use JSON request bodies, not command-line expressions. The owned front end is stopped on shutdown; unrelated servers and the shared daemon are not killed.

A sanitized receipt is written to `<state-dir>/webview-actions/<request-id>.json` before dispatch. Reusing that ID returns its stored outcome rather than running again. Receipts preserve completed, rejected, running and unknown outcomes. A restarted recorder treats an unfinished receipt as unknown. If the action completed but native/DOM refresh failed, keep the step and refresh; do not repeat it. If delivery cannot be confirmed, inspect the app, recover the result and explicitly acknowledge review before choosing a new action. This does not guarantee exactly-once business behavior across new request IDs or app/network retries.

The browser stores only the pending receipt ID for recovery, and inserts completed steps once by their generated ID. It checks the matching app/device before recovery. No receipt is silently retried as an action. New snapshots invalidate old targets; several-page mappings retain the conservative V4 rules.

Input values are not collected. Typing defaults to an environment-variable reference and password fields require one. Run & record also accepts a one-time live value in a separate password field. That value is excluded from receipts, recorded steps and Vortex error messages; the app can still echo it into visible page text or screenshots. Native screen images still show whatever the phone displays, as in previous versions. New recorded page identities contain only the URL origin/path (or protocol/path for local pages), omitting credentials, query strings and fragments. DOM snapshot data remains in memory; added step metadata and sanitized action receipts are saved.

When several inspectable pages exist, the user selects one. Replay steps require native WebView count/bounds/order to agree with MobileWright's mapping; otherwise the panel permits inspection/copying and explains why recording is disabled. Plain/POM exports verify page protocol, origin and path before DOM actions. They reattach when recorded page identity changes. Existing recordings remain schema version 1 and do not need a migration.

An empty discovery result means no inspectable page was exposed. Check the foreground page and the app's WebView debugging configuration. For a release WebView, use any exposed native text or IDs, then try Visual match for controls visible only in the screenshot. Fixed coordinates remain available as an explicit option. [Android WebView debugging](https://developer.android.com/develop/ui/views/layout/webapps/debug-chrome-devtools)

The mock Market Insights screen hosts the synthetic sample in real Chromium for DOM inspection and MobileWright replay tests. Native → WebView → Native and Plain/POM coverage use simulated devices; this is separate from physical-device validation.

## Visual tools

Visual taps save the tap position within the crop and match against a bounded area of the current screenshot. Replay compares the shape and color, rejects competing matches, and requires two consecutive locations to agree before sending one tap. **Find on screen** reports a match on the current capture. A strong match can still resemble the wrong control, so check the outcome on the next screen. Coordinate-only steps retain their separate fixed-point behavior.

Midscene demonstrates screenshot-based targeting for controls that have no selectors. Playwright's uniqueness and actionability checks inform the rule to verify a target before dispatch. Maestro provides a useful reference for explicit point taps and bounded settling. For a future vision-model trial, start with one icon-only control and compare correct-target rate, elapsed time and false clicks against the local matcher on two device sizes. [Midscene agent APIs](https://www.midscenejs.com/reference/) · [Playwright actionability](https://playwright.dev/docs/actionability) · [Maestro tapOn](https://docs.maestro.dev/reference/commands-available/tapon)

## StockPilot check, 2026-11-02

On a Moto g32, the home capture exposed 98 nodes. The Web portal start page exposed portal-search and portal-go. Its external practice login page exposed username/password EditText controls and Login text after loading. A read-only real MobileWright smoke test verified both input locators were visible: one test passed in a 6319 ms runner interval. It entered no credentials and submitted no form. Local captures and account recordings are excluded from the distribution. This was a current-screen check rather than a complete product workflow.

The inspector's text/ID/point workflow follows the useful inspection patterns described in [Maestro Studio](https://docs.maestro.dev/maestro-studio) and [Maestro selectors](https://docs.maestro.dev/reference/selectors/core-selectors). It generates MobileWright TypeScript and does not execute Maestro YAML.
