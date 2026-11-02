# v0.8.0-beta.1

This beta is intended for supervised Android recording and MobileWright replay. It does not claim stable unattended automation across arbitrary apps.

## Included

Searchable snapshot inspection, exposed text/ID/accessibility locators, input-class fallback, explicit coordinate actions, Type/gesture/assertion recording, MobileWright Plain/POM/Both generation, project saving, run reports, cancellation, device ownership and benchmarks. The Type form stays inside the page and clears its input after submission/cancellation.

## Known issues

- Overlapping app layers can expose background controls and cause the wrong locator to be selected. Review the highlighted control and generated step. Explicit coordinate mode is available when the intended target has no reliable locator.
- Suggested assertions can refer to background elements. Prefer checks for the expected destination and saved result. Three assertions have value only when each checks relevant evidence.
- Recordings may contain redundant launch/close operations, transient input edits or unrelated postconditions. The manually optimized price example is evidence for the runner, not proof that the generator always emits equivalent code.
- Popup overlays, locked/asleep devices, usage limits and competing Android automation tools can stop replay. Keep the device unlocked and disconnect other automation sessions.
- Current inspection uses Mobilecli's exposed hierarchy. It does not acquire a DOM or discover CSS/XPath; an absent WebView badge does not establish that the screen is native.
- The Add -> Edit -> Delete acceptance lifecycle has not yet completed ten consecutive unattended cycles from unedited UI-generated scripts.

## Evidence and release gate

The optimized live price-update flow passed in 52.0 s and 45.7 s; a usage-limit overlay blocked another attempt. These are individual runs, not a performance benchmark or a stable success rate. Unit, integration, typecheck and package smoke checks are run separately and use simulated data where indicated.

Release validation on Windows: 28/28 legacy checks, 51 unit/safety passes with one Linux-only skip, 14/14 integration passes, successful TypeScript checking and packaged mock-server startup. The newly configured Linux CI job has not been claimed as locally verified.

The proposed stable-v1.0 gate is ten consecutive Add/Edit/Delete lifecycles, using uniquely identified test products and unedited recorder-generated scripts. Deletion must target only the product created by that cycle. Include exposed web controls and deliberate coordinate fallback in acceptance testing.

## Distribution

The Windows ZIP contains the recorder source, launchers, docs and simulated samples. Install Node.js 22.18+ and Android platform-tools separately. Install @mobilewright/test@0.0.66 in the output project for replay. Generated tests, screenshots, account data, runtime logs, local configuration and dependencies are excluded from the release.
