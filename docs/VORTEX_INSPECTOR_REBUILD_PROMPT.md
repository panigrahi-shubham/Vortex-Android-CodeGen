# Vortex Inspector — fresh Appium implementation prompt

Copy the prompt below into a new coding session. Research notes and sources follow it.

---

Build **Vortex Inspector**, a new local Appium inspector, action recorder, test code generator, and replay tool. Implement working software, not merely an architecture proposal or a visual mockup.

## Product and scope

The existing Vortex Android Recorder mixed multiple automation engines, session ownership, screen capture, recording, and code generation. It suffered from crashed instrumentation, slow captures, confusing WebView controls, unreliable typing, and generated tests that did not reproduce recorded actions.

Create a separate project. Treat the existing recorder as a source of requirements and regression examples; do not overwrite it or transplant its server/UI wholesale. Choose a new unused local port. Preserve existing recordings and user files.

V1 is Windows-hosted Android automation using Appium and UiAutomator2. Generate complete Python + pytest projects first. TypeScript/Taqwright export is a later independent exporter. iOS, cloud grids, MobileWright, natural-language agents, OCR, and vision models are outside the first release. Do not add engine dropdowns for unsupported engines.

“Jarvis” means a future computer-use style assistant, not an actual dependency. A future assistant may propose actions through the same execution API, but it must not introduce a second device driver or bypass ownership, validation, and recording.

## Reuse decision before implementation

Inspect https://github.com/taqelah/taqwright and https://github.com/appium/appium-inspector. Prefer useful, tested upstream components over reimplementing WebDriver or Appium. Taqwright is an Appium-based framework using the Playwright test runner; it is not MobileWright.

Do a bounded compatibility spike: pin an upstream revision, run relevant upstream tests, connect to an available test device, and prove capture, tap, replace-text, and native/WebView transitions. Then write a short decision record choosing a maintained dependency, a fork, or selective licensed reuse. Continue implementing after the decision; do not stop at the proposal. Preserve required licenses, notices, attribution, and modification notices. Do not assume hosted AI services are included in an open-source fork.

Research snapshot: Taqwright commit 01e63dbd84fb0ab2298a093058839b9220442342 reports version 1.1.0. Its no-argument switchToWebView helper chooses the first WebView. Its Appium Python exporter emits steps without imports/setup and uses TODOs for unsupported translations. These are gaps to address, not capabilities to assume complete. Recheck the chosen revision before adopting it.

Resolve and pin a compatible Node/Appium/UiAutomator2/Chromedriver/Python-client matrix. Do not independently install “latest” versions: Appium and driver major versions have compatibility constraints. Record exact tested versions and installation commands. Do not modify the user's existing global toolchain as an incidental setup step.

## Architecture

Use TypeScript for the local backend and React + TypeScript for the UI, unless the reuse spike establishes a concrete reason to differ. Keep explicit modules for:

- Session/device ownership and serialized command execution.
- Appium transport, lifecycle, capabilities, and diagnostics.
- Snapshot capture and screen-coordinate transforms.
- Native/WebView target resolution and locator validation.
- Versioned recording model and action journal.
- Pure code generation and exported runtime helpers.
- Test processes, reports, and persistence.
- UI components using typed APIs, with no embedded driver logic.

Keep these boundaries practical; they need not become separate services. No giant HTML/JavaScript string containing the whole UI. No HTTP route that combines device mutation, locator selection, code generation, and report rendering.

### One owner per device

Maintain one persistent inspection session per selected device. All session commands, including context changes, screenshots, source retrieval, locator queries, and actions, pass through one ordered broker. Schedule background refresh at lower priority and coalesce redundant refreshes. Bound requests and distinguish cancellable queued work from commands already executing.

Use a cross-process device lease with owner identity, lifecycle/heartbeat, and conservative stale-owner recovery. Multiple browser tabs must not create competing sessions. Generated test execution must explicitly release or transfer inspection ownership before creating its own session; reconnect afterward. External Appium and MobileWright processes cannot be assumed to obey our lease: detect known conflicts where possible, show evidence and clear recovery guidance, and report when ownership cannot be established.

Never run competing uiautomator dump instrumentation while Appium owns the device. Do not kill all node, adb, or Appium processes. Stop only verified owned processes. Handle duplicate startup and occupied ports without an unhandled exception or silently adopting an unrelated server.

### Snapshots and execution correctness

Tag captures and commands with device ID, session generation, snapshot revision, timestamps, and context/window identity. Pair screenshot and hierarchy/DOM as closely as possible; do not claim they are atomic. Detect obvious mismatches and reject stale actions after navigation or session replacement. Coordinate mapping must account for display scale, viewport offsets, rotation, scrolling, and keyboard insets.

Journal an action's intent, dispatch, response, and postcondition separately. A successful tap followed by failed screenshot capture must not cause the tap to repeat. A transport timeout may leave the outcome unknown: inspect/reconcile or ask for intervention instead of automatically repeating a product submission. Request IDs prevent duplicate dispatch within our broker; do not claim exactly-once business execution across device/network failures.

## Automatic native and WebView behavior

Normal users should not need a separate WebView inspector or manually switch contexts. Resolve the appropriate context for the user's selected target. Native headers, keyboards, permission dialogs, and footers remain native even while a WebView is present.

Discover actual usable contexts and windows. Select the visible app content using package/process information, page metadata, visibility/bounds, and the tapped region. Ignore hidden advertising pages where evidence permits. Never select the first WebView merely because it exists; expose a concise chooser if ambiguity remains. Match contexts/windows afresh during replay rather than saving volatile handles. Support frame paths for the initial hybrid fixture; clearly reject unsupported closed shadow roots or inaccessible frames.

Use actual DOM accessibility, not the APK's debug/release label, to determine available strategies. If DOM access works, use verified CSS or DOM XPath locators and DOM input semantics. If it does not, use exposed native resource IDs, accessibility labels, text, and native XPath. Offer an explicitly marked coordinate action when semantic targeting is unavailable or the user deliberately selects coordinate mode; validate its screen geometry and preconditions during replay. Coordinates cannot prove text, selection, or visibility assertions.

Distinguish no WebView, debugging unavailable, no usable page, wrong target, and Chromedriver incompatibility. Show a short explanation and actionable detail instead of “WebView broken.” Use bounded discovery with backoff; do not repeatedly stall every tap probing inaccessible WebViews. Provide a controlled Chromedriver setup flow with known versions and diagnostics.

### Maestro-style text, bounds, and locator explorer

Provide a Maestro-style inspection experience inside the same workspace, including for WebView regions. Implement it through Appium; do not start Maestro alongside Appium or add another automation engine.

Offer a searchable list of exposed text and elements, synchronized with highlights on the device preview. Selecting an item or preview region must expose available text/value, accessibility label, native resource ID or DOM ID, class/tag, state, bounds, center point, and locator alternatives. Label each field's source as native accessibility or Web DOM and mark unavailable data explicitly. Do not merge nodes solely because their text matches or assume DOM IDs are native resource IDs.

Support these target choices and generate the corresponding Appium implementation:

- Exact text, contains-text, and explicit regex matching over the accessible native tree or available DOM. Define matching and case rules consistently for recording and Python replay; regex is not a universal Appium selector and may require bounded candidate filtering.
- Resource ID, accessibility label, native UiSelector/native XPath, and DOM CSS/DOM XPath where the relevant source supports them.
- Container-scoped text and parent/child relationships. Offer above, below, left-of, and right-of anchors using current bounds, combined with other attributes and uniqueness checks. Positional relationships alone do not imply nearest neighbor or shared parent.
- Absolute screen coordinates, screen-relative percentages, and a relative point inside a verified element. Keep each coordinate space explicit. Prefer semantic locators by default while allowing an intentional coordinate-mode override.

Show a crosshair and copyable pixel/percentage point for a preview click even if the WebView exposes no child nodes. The click must remain inspection-only until the user chooses an action. Record coordinate-only actions without fabricating text or element identity. Recompute element-relative points from fresh bounds; validate screen-relative/pixel actions against their recorded orientation, dimensions, and screen preconditions. Never silently reinterpret DOM CSS pixels as Android screen pixels.

Include Test locator, Highlight matches, Copy locator, Record tap, Record type, and Add assertion controls. Display match counts and require explicit disambiguation when needed. Locator testing must not execute a tap. Search may support a bounded scroll-to-text action in the selected scroll container, stopping on a match, timeout, or lack of progress.

When WebView DOM debugging is unavailable, still expose text, bounds, and native selectors that the accessibility tree actually supplies. If it supplies only a WebView container, explain that inner text is unavailable and offer manual coordinate targeting. Do not promise extraction of every rendered word. OCR/vision remains a future optional source with distinct provenance; it must not be presented as native text or a DOM locator.

Persist the chosen strategy, anchor/scoping rules, matching mode, and coordinate space in the recording format, and preserve them in independently runnable Python exports. Do not silently fall back from a failed text assertion to a coordinate tap.

## Locators, actions, and assertions

Validate proposed locators against the selected live target, including match count and element identity. Prefer stable attributes and meaningful scoped anchors. Show evidence such as “unique ID,” “2 matches,” or “coordinate fallback”; do not invent precision scores. Use positional selection only when explicit and visible to the user.

V1 actions: launch/activate app, tap, long press, replace text, clear, swipe/scroll, Back, hide keyboard, wait for condition, and assertions. Unsupported actions must be explicitly unavailable.

Replace-text must clear/replace existing content and verify the resulting value. Avoid text-dependent locators for editable values when a stable identifier is available. Resolve actual editable descendants or focused inputs with evidence; do not type into arbitrary containers. Correctly escape Unicode, quotes, and multiline input in generated Python.

Assertions must distinguish visible, absent, enabled, selected, checked, text, and value. Enabled does not mean selected. Use bounded polling for observable conditions. Do not insert a blanket five-to-ten-second sleep after each step or require the whole app to become motionless.

## Recording and complete code generation

Make a versioned, validated intermediate recording format the source of truth. Store action kind, target/context/frame recipe, locator candidates and validation, value references, timeout, optional coordinate metadata, snapshot provenance, and explicit assertions. Separate recorded intent from runtime outcomes. Support edits and round-trip persistence without silently losing semantics.

Generate a complete runnable Python pytest project: test file, fixtures, dependency pins, configuration example, context/locator/wait helpers, teardown, and README with one clear run command. It must run without the Vortex server. Use a device lease mechanism shared with Vortex for locally launched runs, and document the boundary for external execution. Reacquire targets after context/navigation changes. Never silently skip unsupported steps or export TODOs as a completed test. Block export with the exact unsupported step and remedy when necessary.

Record and replay must share documented semantics, validated through contract tests even where implementations use different languages. Avoid overwriting user-edited exports without an explicit choice. Keep secrets as environment/config references, not literals.

## UI and performance

Use one main workspace: connection status, large device preview, selected-element details, and editable steps. Put generated code and advanced diagnostics in collapsible panels. Provide clear Inspect, Record, Stop, Save, and Run states. Inspecting must not accidentally execute an action. Show which operations are unavailable and why; avoid repeated blocking popups for normal context changes.

Display Native, Web DOM, or Native fallback status in plain language. Show recording/replay ownership and conflicts. Prevent double submissions while an action is in flight. Preserve recordings across UI refreshes and provide recoverable error states.

Measure queue delay, Appium duration, capture, parsing, locator validation, context discovery, and UI rendering separately. Establish cold/warm baselines and report p50/p95 for a documented scenario. Keep feedback responsive; optimize measured bottlenecks with bounded work, snapshot reuse, and refresh coalescing. Do not fabricate speedups or promise fixed device latency.

Bind the local service to loopback by default; validate origins and local session authorization for mutation endpoints. Redact credentials and sensitive typed values from logs. Make screenshot/report retention explicit.

## Verification and completion

Implement in working slices: connection/ownership and inspection; native recording and Python replay; automatic hybrid routing and fallback; editing/reports/performance polish. Continue through these slices until the acceptance checks are met or a concrete external dependency blocks live verification.

Build a small controlled Android hybrid fixture with debugging enabled and disabled, native controls around a WebView, duplicate labels, editable inputs, delayed navigation, and a hidden second page. Include frame navigation, scrolling, keyboard, and rotation cases. Use it for repeatable tests before relying on IndiaMART.

Verify these regressions:

1. Second browser tab, second recorder process, and competing test runs cannot silently take over the device.
2. Native -> visible WebView -> native dialog -> WebView actions resolve the intended target.
3. Debugging-disabled content uses supported native targeting or an honest explicit fallback.
4. A stale preview cannot click a different screen; a capture failure cannot repeat a completed action.
5. Replacing existing text produces the exact requested value without duplication.
6. Recorded selection assertions distinguish selected/checked from enabled.
7. Exported pytest runs independently and reproduces recorded assertions.
8. Cancel, crash, timeout, skipped, failed, and unknown outcomes are reported distinctly; all-skipped is not success.
9. The text/locator explorer highlights the correct WebView target, disambiguates duplicate text using a container or anchor, and exports equivalent Appium targeting.
10. Pixel, screen-percentage, and element-relative points map correctly after supported scrolling/keyboard/rotation changes, or fail with an explicit geometry mismatch. Debugging-disabled WebViews expose available native text honestly and permit manual points without inventing text.

For an authorized test product, record opening the first product, capture its stable identity, change price to 500, change four specifications, verify selection, save, reopen the same product, and verify persisted price/specifications. Use the fixture by default; do not repeatedly create or modify production listings merely to benchmark. Compare timings only from equivalent starting states, with machine/device details and setup time separated.

Use available computer-use tooling to inspect the actual UI and perform the fixture workflow, then run the generated script and compare outcomes. If device or GUI access is unavailable, report that limitation and provide reproducible verification steps rather than claiming a live pass.

Deliver source, upstream reuse decision, architecture notes, setup/run commands, test evidence distinguishing mocked from real-device checks, latency measurements, example recording/export, and known limitations. The first release is complete when a user can connect, record a native/hybrid flow, export it, and replay it reliably without understanding Appium context plumbing.

---

## Research basis

Research date: 2026-11-02. Source inspection is not a completed runtime/security audit of Taqwright.

- [Taqwright repository](https://github.com/taqelah/taqwright) and [Apache-2.0 license](https://github.com/taqelah/taqwright/blob/main/LICENSE).
- [Official codegen documentation](https://www.taqwright.dev/docs/codegen): browser inspector, recording, locator validation, and TypeScript test export.
- [Inspected WebView helper](https://github.com/taqelah/taqwright/blob/01e63dbd84fb0ab2298a093058839b9220442342/src/mobile/index.ts): default first-context selection.
- [Inspected Appium exporter](https://github.com/taqelah/taqwright/blob/01e63dbd84fb0ab2298a093058839b9220442342/src/inspector/codegen-appium.ts): Python/Java steps-only output and unsupported translation handling.
- [Official Appium Inspector](https://github.com/appium/appium-inspector): alternative reference implementation, Apache-2.0.
- [UiAutomator2 driver](https://github.com/appium/appium-uiautomator2-driver): compatibility, capabilities, and hybrid automation. Its current README states driver 9 requires Appium 4; do not blindly upgrade an Appium 3 installation.
- [Chrome WebView debugging documentation](https://developer.chrome.com/docs/devtools/remote-debugging/webviews): DOM debugging must be exposed by the app and is distinct from the manifest debug flag.
- [Maestro tapOn](https://docs.maestro.dev/reference/commands-available/tapon): text/ID targeting and absolute, percentage, and element-relative points as interaction references.
- [Maestro relational selectors](https://docs.maestro.dev/reference/selectors/relational-selectors): geometry and parent/child targeting as design references; Vortex must implement and test its own Appium translation.
