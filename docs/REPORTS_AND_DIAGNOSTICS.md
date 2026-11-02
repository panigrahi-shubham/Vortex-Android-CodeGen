# Runs, reports and diagnostics

MobileWright execution uses the installed project runner. The per-run wrapper selects the device, files, output directory and reporters while preserving the project's configuration. A passing process exit alone is insufficient: the structured report must contain at least one passed test and no failures. Empty, skipped, load-error, failed, timeout and cancelled results remain distinct.

Project & runs streams bounded log output and shows result history. Reports include tests, recorded step evidence where available, failure messages, screenshots/attachments and cleanup results. Self-contained HTML and JSON exports apply secret masking. Only files inside the report directory can be served. Old formats may remain readable as historical data; only MobileWright runs are offered by the active API.

Diagnosis rules inspect error evidence for missing secrets, mismatched text/count/state, missing or disabled controls, wrong foreground screen, unsupported commands, lost device/service connections and WebView access errors. Unknown errors remain unknown. Hints direct users to the captured hierarchy and MobileWright logs rather than removed panels. Traceback source lines are not treated as evidence that a command actually failed.

A device lease blocks concurrent Vortex recording/replay. Preparation failure releases its lease without leaving a phantom active run. Cancellation stops owned runner work and releases the device. External programs are not stopped merely because they might compete.

Run journals record the process identity and recorder owner. On startup, journals whose recorder is still alive are left alone. Interrupted MobileWright processes are stopped only if PID, start time and command line still match. Reused PIDs are left running, and cleanup is reported. Foreign-engine journals are preserved without running their old cleanup logic.

Retries repeat the entire test, can repeat app changes, and require explicit repeat-safe confirmation. Failure evidence should be reviewed before enabling retries; retries do not repair an invalid locator.
