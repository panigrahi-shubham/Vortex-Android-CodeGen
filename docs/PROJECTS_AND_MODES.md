# Projects and generation modes

The versioned vortex.recording model stores ordered events, before/after screen evidence, actions, locator parts, checks, postconditions, timing hints and optional template references. UI steps and saved recordings convert through src/model/recording.ts. Older supported recordings migrate; newer unknown formats are rejected.

MobileWright is the only active generator and runner. Plain writes mobilewright/plain/<case>.test.ts. POM writes mobilewright/pom pages, fixtures, data and tests. Both writes both variants and renames the non-target entry to .vortex-alt.ts so ordinary discovery runs each flow once. An explicit variant run can select the alternate. The legacy single .spec.ts export is separate from project entries.

Each case lives under <out>/<module>/<case> with recording.json, vortex-manifest.json, optional assets/templates and reports. Page names and locator methods derive from recorded screen evidence. Unsupported actions or locators produce generation issues before saving; they are not silently dropped.

Save compares existing content with its manifest checksum. Unchanged generated files may be replaced; edited/unowned files are kept and new content goes beside them as .vortex-new. The UI can explicitly replace reviewed conflicts. Previous recording versions are retained in recording.history. Path validation confines writes to the case.

Switching modes removes stale unchanged files of the active exporter, preserves hand edits and preserves historical foreign-engine output. Legacy names remain readable in manifests, but those entries are not MobileWright run targets.

Project & runs lists saved cases and supports opening a recording, replaying a case/module/all entries, choosing a variant, cancellation, history and reports. Replay uses the installed MobileWright project above the output directory. Vortex writes a per-run wrapper without changing that project's config. Retries are opt-in and require confirming the flow is safe to repeat.
