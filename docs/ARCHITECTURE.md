# MobileWright architecture

## Runtime

src/server.js binds localhost, acquires recorder/state ownership, initializes TypeScript services, and serves public/index.html. src/http-guard.js checks local hosts, origin and JSON requests. src/recorder-owner.js excludes duplicate recorder owners before recovery. Node.js 22.18+ runs erasable TypeScript directly.

Recorder flow: device.js -> tree.js -> locators.js -> captured screen -> UI inspection/recording -> model/recording.ts -> project/project.ts -> engines/mobilewright/ts-codegen.ts. device.js uses ADB for input/screenshots and the selected project's Mobilecli for hierarchy. Plain/POM generators share the recording model and page planning. codegen.js keeps the legacy single-file export.

src/vortex/index.ts wires devices, project operations, MobileWright execution, reports, visual matching and benchmarks. src/engines/mobilewright/runner.ts resolves the installed runner, writes a per-run wrapper config, launches it, parses its report and releases the device lease. Runtime process identity, package metadata and log redaction live in src/runtime.

## Ownership and stale screens

The server serializes recorder captures/actions. A device lease excludes Vortex test runs while a recorder action and its observation complete. Replay holds its lease until cleanup. Benchmark reset acquires a lease before force-stop/launch. External automation ownership is not guaranteed by Vortex's in-process lease; stop competing tools if they control the same device.

Each capture has a screenId. An action using an older supplied ID fails with STALE_SCREEN. If input succeeds but observation fails, the response says actionCompleted, invalidates the old hierarchy and requires Refresh. The UI retains the completed step without repeating the device action. This prevents stale coordinates/locators from silently driving the next step.

Mobilecli exact online device IDs are preferred. Emulator alias mapping requires selected-device identity metadata and a unique match. A sole unrelated phone is not substituted for an unmatched serial. Injected simulated drivers never query or map to physical devices.

## Inspector boundary

Inspection selects captured nodes without input. Search, alternate locators, highlights, bounds and percentage points use the same hierarchy as recording. Snapshot match counts are not live locator checks. CSS/XPath DOM acquisition and browser context management are outside the current inspector. Existing supported web recording data can still be exported.

## Persistence

generated/<module>/<case> stores recording.json, vortex-manifest.json, TypeScript output, template assets and reports. Checksums protect edits; changed generated output is written beside edited files as .vortex-new. Removed modes clean only unchanged files owned by the active exporter. Historical exporter files are preserved.

.vortex stores runtime state, journals and run indexes. Interrupted MobileWright work is recovered only when its recorder is no longer alive; process cleanup requires matching PID, start time and command line. Old foreign-engine journals are left alone. Types retain legacy engine names for reading old data, without loading a runtime for them.

## v1 recording and replay protections

`public/recording-tools.js` provides pure recording edits, overlap ambiguity detection and structural assertion review. The UI uses a module script so these rules are shared with tests. Edits affect generated code, never the phone. Suggestions are initially unchecked.

`src/draft-store.js` persists one versioned draft per recorder state directory with atomic replacement and optimistic revision checks. Browser storage remains a fallback. Drafts include the package and device identity; recovery never silently substitutes a phone. Sensitive typed values are stripped before persistence. Draft operations use their own serialized queue and do not acquire a device lease.

Fast action observation captures once after a short 150 ms delay. Stable observation retains bounded consecutive-tree polling and reports whether a match was reached. Action, capture and total elapsed times are exposed separately. A failed manual refresh invalidates previous screen tokens as well as a failed post-action observation.

Plain/POM coordinate paths verify the recorded PNG dimensions before sending a coordinate action. Locator fallback never catches a delivered tap error to send a second tap. These geometry checks do not identify the app page; explicit result assertions remain necessary. Case runs bind metadata to the saved package; multi-app batches and pending generated-file conflicts are rejected.

## Testing boundaries

Unit/safety tests cover locators, generation, saving, leases, mapping, request guards and process identity. Integration tests use the real installed runner with a simulated device driver; the WebView fixture uses headless Chromium. The real StockPilot smoke checks current-page input visibility and is explicitly read-only.
