# Vortex 3.0 proposal

Status: device connection and recovery implemented in development; remaining features proposed. The selected WebView work is now implemented in V4.0.0-beta.1; see V4_RELEASE.md. This file retains the earlier V3 proposals for context.
The cloud runner upgrade targets @mobilewright/test 0.0.69; this does not automatically add recorder features.

## 1. Device connection and recovery — implemented in development

Add a device connection panel showing local versus remote transport, authorization, device identity, and actionable failures. Support refresh/reconnect without silently selecting another phone. Serialize ownership and invalidate captured targets on reconnect. Selection is currently scoped to the server session; startup defaults use CLI/environment settings. Pair separately on the Vortex host; the UI does not collect pairing credentials. Persistent connection profiles are a later enhancement.

Acceptance: distinguish no device, unauthorized, offline and unreachable; reject stale actions after reconnect; verify selected serial for every ADB action. Exercise two devices and interruption/recovery on real hardware before claiming support. Cloud access to a user's local USB device requires an explicitly reachable supported connection.

## 2. Better WebView inspection

Investigate MobileWright 0.0.69's WebView APIs against the recorder's actual capture path. Add context discovery, a chooser when several visible pages exist, verified DOM locators where available, and clear explanations when debugging is unavailable. Preserve native accessibility inspection and explicit coordinate targeting.

Acceptance: a real hybrid fixture supports Native → WebView → Native in recording and Plain/POM replay; multiple and unavailable contexts fail clearly. Never fabricate DOM selectors from accessibility nodes or use coordinates to satisfy text assertions.

## 3. Data-driven tests and reusable flows

Add named reusable flows and validated JSON test-data sets, with environment references for secrets. Define parameter types, schema versions, case selection and report identity. Keep generated Plain/POM tests independently runnable and retain protection for hand-edited files.

Acceptance: two data rows produce distinct results, malformed input fails before device mutation, secrets stay out of artifacts, and changing a shared flow does not silently rewrite saved cases.

## 4. Failure evidence and replay review

Tie each failed step to the latest screenshot, locator matches, timing, device/context identity, and action outcome. Distinguish an action failure from a subsequent capture failure. Expose proposed locator repairs for review; never silently replay a business mutation.

Acceptance: deliberate locator failure and post-action capture failure produce different diagnoses, and reports mask sensitive inputs.

## Release gates

The development branch now targets MobileWright 0.0.69 in MW_PINNED, generated-code metadata, CI and current setup documentation. Historical release notes retain their original tested versions. Simulated fill implements the 0.0.69 driver contract.

Require unit/type checks, all integration checks with zero unintended skips, regression tests for each implemented feature, the existing 20 real-app acceptance scenarios, and ten isolated create/edit/delete cycles on approved disposable data. Keep simulation evidence separate from physical-device evidence. Version the product as 3.0 only when the selected features and migration path are implemented and verified.
