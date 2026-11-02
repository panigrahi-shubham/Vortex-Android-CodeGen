# MobileWright-only migration, 2026-11-02

Removed the active Appium server manager, sessions/inspector, Python generation/replay, related routes and setup requirements. Kept MobileWright Plain/POM/Both, legacy export, projects, replay, reports, devices, visual tools and benchmarks. A pre-migration ZIP and an external retired-source archive allow recovery. Existing generated user tests remain on disk.

Added a snapshot inspector with safe selection, hierarchy search, alternative locators, match highlights, copied IDs/text/locators, bounds, pixel centers, percentage coordinates and explicit record actions. WebView text/ID exposure is used when available; opaque content gets an explicit coordinate fallback without claiming DOM access.

Local Mobilecli discovery now uses the installed project copy and selected serial. Provider failures do not start competing instrumentation. Simulated drivers cannot map onto a connected physical phone. Real unmatched serials cannot silently adopt an unrelated sole phone. Run preparation failures release leases. Benchmarks reject duplicate startup, protect resets and forward device identity.

Completed inputs survive observation failure. Their old hierarchy is invalidated and Refresh is required. Stale supplied screen IDs fail with STALE_SCREEN. Duplicate server startup exits before recovery touches the existing recorder's state.

Validation: 28 legacy checks passed; 50 unit/safety tests passed, one Linux-only test skipped. All 13 integration tests passed, and the subsequently added MobileWright-only HTTP regression passed. Changed benchmark, project and report tests passed again after final patches. Typecheck passed. A mocked browser smoke test verified safe inspection, locator selection, explicit coordinates, project UI, no removed endpoint requests and no JavaScript errors. Manual live desktop-window verification was blocked because the computer-use helper could not verify its browser URL.

On the real StockPilot phone, MobileWright passed a read-only current-WebView visibility test for username/password (6319 ms runner interval). This verifies those locators on that page/build; it is not a full data-entry workflow benchmark.
