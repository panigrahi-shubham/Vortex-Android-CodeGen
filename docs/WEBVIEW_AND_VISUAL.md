# Web content and visual fallback

## V4 WebView DOM inspector

The main recorder still inspects native accessibility through Mobilecli. The separate **WebView DOM** panel discovers inspectable pages using `mobilecli webview list` and evaluates a fixed read-only DOM collector in the explicitly selected page. It reuses the same daemon and serialized device lease. It does not create an Appium/Chromedriver session or download another driver. Real-device DOM inspection requires the default Mobilecli hierarchy source; mixing it with uiautomator or a custom tree command is rejected.

The panel shows visible top-level elements, text/labels, DOM ids, enabled/editable state, candidate CSS selectors, actual match counts, and CSS bounds. Stable attributes are preferred when unique; positional DOM paths are marked for review. Each snapshot includes up to 400 visible candidate elements and scans at most 3000 candidates. Truncation and iframe counts are reported. Frames and shadow DOM are not traversed. DOM bounds use CSS pixels, independently of the Android screenshot geometry; the beta does not claim a synchronized overlay.

Choose **Add tap step**, **Add type step**, **Add clear step** or **Add assertion** to append to the recording. These buttons do not act on the device. Move through the real app manually when capturing subsequent pages; the saved steps execute only during replay. Each addition rechecks the page identity, element identity and unique CSS match. Refreshing the native screen, changing devices or navigating invalidates old captures. A locator unique now is not guaranteed to remain valid in a later session.

Input values are not collected. Typing defaults to an environment-variable reference and password fields require one. Native screen images still show whatever the phone displays, as in previous versions. New recorded page identities contain only the URL origin/path (or protocol/path for local pages), omitting credentials, query strings and fragments. New DOM snapshot data remains in memory; only explicitly added step metadata is saved.

When several inspectable pages exist, the user selects one. Replay steps require native WebView count/bounds/order to agree with MobileWright's mapping; otherwise the panel permits inspection/copying and explains why recording is disabled. Plain/POM exports verify page protocol, origin and path before DOM actions. They reattach when recorded page identity changes. Existing recordings remain schema version 1 and do not need a migration.

An empty discovery result means no inspectable page was exposed; it does not prove the app has no WebView. Check the foreground page and app's debugging availability. If a production WebView cannot expose DOM, use the native text/IDs actually supplied or an explicit coordinate action. A debuggable APK label alone does not prove DOM access. Known Mobilecli failures, missing installations and owner conflicts produce actionable errors; Vortex does not silently fall back to competing instrumentation.

The mock Market Insights screen hosts the synthetic sample in real Chromium for DOM inspection and MobileWright replay tests. Native → WebView → Native and Plain/POM coverage use simulated devices; this is separate from physical-device validation.

## Visual tools

Coordinate steps can retain a cropped template and relative screen position. The visual API performs local PNG/template matching with confidence and optional region-of-interest information. Ambiguous, absent or weak matches must be reviewed. A crop is not automatically a semantic locator. PNG decoding and screenshot comparison support visual evidence and screen-change suggestions.

## StockPilot check, 2026-11-02

On a Moto g32, the home capture exposed 98 nodes. The Web portal start page exposed portal-search and portal-go. Its external practice login page exposed username/password EditText controls and Login text after loading. A read-only real MobileWright smoke test verified both input locators were visible: one test passed in a 6319 ms runner interval. It entered no credentials and submitted no form. Local captures and account recordings are excluded from the distribution. This was a current-screen check rather than a complete product workflow.

The inspector's text/ID/point workflow follows the useful inspection patterns described in [Maestro Studio](https://docs.maestro.dev/maestro-studio) and [Maestro selectors](https://docs.maestro.dev/reference/selectors/core-selectors). It generates MobileWright TypeScript and does not execute Maestro YAML.
