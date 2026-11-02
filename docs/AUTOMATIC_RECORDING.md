# Recording and inspection

Inspect is the default interaction mode. Selecting a screenshot point or hierarchy result highlights a control and shows its text, label, ID, class, state, bounds, center and available locator expressions. It does not touch the device. Search filters the captured hierarchy; match highlights and counts refer to that snapshot.

Choose an alternate locator when the preferred one is unsuitable. Use Record tap/type or Add assertion explicitly. Record coordinate tap is an explicit fallback for content without a semantic locator. Coordinate warnings remain attached to the step.

After a device action, the recorder reads the tree until consecutive captures match or the settle budget is reached, then takes the screenshot and computes suggestions. Tree acquisition can itself dominate elapsed time; the budget is not a hard timeout for an individual device command. Settled snapshots do not guarantee every network request has finished. Use a meaningful wait/assertion for the destination screen.

Suggested checks describe appeared/disappeared controls and changed state. Dynamic text is ranked toward visibility, duplicates are merged and suggestions are limited. Review suggestions before keeping them; unexpected data changes are not automatically product requirements.

Type must target an editable control with a replayable locator. Arbitrary rectangles are not valid semantic text fields. Secret inputs store an environment-variable reference, never the secret value. Use VORTEX_SECRET_* values in the environment that starts replay.

Refresh after navigating outside the recorder. A stale screenId is rejected. When an input succeeds and capture fails, the completed action is retained, the hierarchy is invalidated and Refresh is required before another action. Do not repeat the action merely to recover its screenshot.

The recorder uses one automation hierarchy provider at a time. With a local Mobilecli installed, a provider error fails clearly instead of starting competing uiautomator instrumentation. Vortex runs exclude recorder actions through a device lease. External tools can still conflict with the Android automation connection.
