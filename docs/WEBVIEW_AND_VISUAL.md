# Web content and visual fallback

## Current inspector

The recorder inspects the hierarchy supplied by Mobilecli. A WebView may expose text, accessibility labels, IDs and editable controls. These can use normal MobileWright locators. A WebView that exposes only a rectangle needs an explicit coordinate action. The UI shows pixel and percentage points and warns that layout changes can move a coordinate target.

The WebView badge relies on WebView classes present in the captured hierarchy. Mobilecli may flatten loaded web content into control nodes without retaining a WebView container, so an absent badge does not prove the screen has no web content. Inspect the controls actually exposed.

This UI does not capture DOM, CSS or XPath. Debuggable builds alone do not enable those inspector capabilities. It does not manage browser contexts or download browser drivers. Do not advertise a coordinate tap as a verified CSS selector. Unexposed editable fields cannot currently be recorded as semantic Type actions.

## Existing web recordings

The shared model and MobileWright generators retain supported web locator data in older recordings. Consecutive web steps generate the supported MobileWright web context block. Unsupported APIs and iframe paths produce generation errors. Integration coverage executes Native -> WebView -> Native in Plain and POM against a simulated device with a real headless Chromium page; this does not establish support for every production app/build.

## Visual tools

Coordinate steps can retain a cropped template and relative screen position. The visual API performs local PNG/template matching with confidence and optional region-of-interest information. Ambiguous, absent or weak matches must be reviewed. A crop is not automatically a semantic locator. PNG decoding and screenshot comparison support visual evidence and screen-change suggestions.

## StockPilot check, 2026-11-02

On a Moto g32, the home capture exposed 98 nodes. The Web portal start page exposed portal-search and portal-go. Its external practice login page exposed username/password EditText controls and Login text after loading. A read-only real MobileWright smoke test verified both input locators were visible: one test passed in a 6319 ms runner interval. It entered no credentials and submitted no form. Local captures and account recordings are excluded from the distribution. This was a current-screen check rather than a complete product workflow.

The inspector's text/ID/point workflow follows the useful inspection patterns described in [Maestro Studio](https://docs.maestro.dev/maestro-studio) and [Maestro selectors](https://docs.maestro.dev/reference/selectors/core-selectors). It generates MobileWright TypeScript and does not execute Maestro YAML.
