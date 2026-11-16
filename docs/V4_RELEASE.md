# Vortex 4.0.0-beta.1

V4 focuses on WebView inspection and uses MobileWright 0.0.69. This is a local beta build, not a published stable release. The existing recording format remains version 1; Plain, POM, Both and legacy recordings retain their existing save protections.

## Use the WebView inspector

1. Install Node.js 22.18+ (24 recommended), root dependencies with `npm ci`, ADB and `@mobilewright/test@0.0.69` in the output project. Start Vortex against the selected app and device with the default Mobilecli hierarchy source.
2. Navigate to a WebView on the phone. Open **WebView DOM**, choose **Find pages / refresh**, select the intended page and choose **Inspect page**. No page is selected automatically.
3. Search the DOM, select a control, inspect actual CSS match counts and alternatives, and copy CSS if needed. Bounds are CSS pixels, not Android screen pixels.
4. Add a tap, type, clear or assertion step. These controls record only; they do not act on the page. Type defaults to an environment-variable reference. Password fields require one.
5. For the next screen, navigate on the phone and inspect again. Save to the project and replay the recorded flow. Plain/POM output checks page protocol, origin and path before using WebView selectors.

Device recovery and recording edits remain available. Adding a DOM step requires a fresh, uniquely matched element on the selected page. If a page or native screen changed, inspect again. Multiple pages with unreliable native mapping remain inspectable, but adding replay steps is disabled.

## Try it without a phone

Use the prepared cloud environment with `/workspace/vortex-tools/env.sh` sourced, then `npm run mock -- --no-open --out .vortex-ci`. Record the sample home screen's Market Insights tap; open **WebView DOM** on that screen. Choose Market Insights, inspect the subscribe email/button/status controls and add steps. The mock inspector needs the installed Playwright package and a compatible Chromium; real-device inspection uses the device's WebView instead.

## Scope and limits

- Visible top-level light DOM, up to 400 elements and 3000 scanned candidates. Frames and shadow DOM are not traversed. Truncation and frame counts are shown.
- DOM steps require Plain/POM output; legacy export refuses them rather than losing their WebView context.
- CSS selector inspection and copying; no live DOM tap/type execution in the panel, CSS-to-screenshot overlay, XPath acquisition or cloud-device bridge.
- An app must expose a usable inspectable page. Native inspection and explicit coordinates remain available when it does not.
- Input values are not collected. New recorded page references omit URL credentials, query strings and fragments. Native screenshots still reflect the phone's visible screen.
- Real-device DOM inspection uses the existing default Mobilecli hierarchy owner; uiautomator/custom tree commands are rejected for this operation.
- Hardware acceptance and native Windows execution remain pending. Linux packaging and simulation checks do not establish those outcomes.

## Validation and packaging

Run `npm test`, `npm run typecheck`, and `npm run test:integration` with the supported runner and Chromium installed. The V4 browser test discovers a real DOM in the synthetic WebView, creates and saves steps through the UI, verifies that adding steps did not submit the page, rejects a stale capture, and replays the generated Plain and POM tests through MobileWright.

`npm run package:windows` creates `dist/vortex-android-recorder-4.0.0-beta.1-windows.zip` and its `.sha256` checksum. Keep earlier archives and saved recordings when evaluating the beta. No GitHub release is published by these commands.
