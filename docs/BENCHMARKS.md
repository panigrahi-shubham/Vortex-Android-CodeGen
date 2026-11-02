# MobileWright benchmarks

Tools > Benchmarks repeats one saved MobileWright case on the selected device. Choose iterations, warm-up count and whether to reset the app. Reset force-stops and relaunches the app outside the timed test; it does not erase data. Repeated tests may repeat their changes.

The analyzer instruments a copy of the Plain test, preserving original actions/assertions. It records runner wall time, available step/action/assertion timing marks, launch preamble and optional adb discovery timing. Unmeasured phases remain unavailable rather than estimated. Results include samples, medians, spread, variation, per-step summaries, notes and HTML/JSON exports. Warm-ups are excluded from measured summaries.

Only MobileWright is accepted. No cross-framework comparison or server cold-start measurement is offered. Historical result fields may remain readable for compatibility. Simulated runs are clearly marked; they measure the simulator and host rather than a phone. Use multiple successful samples and comparable app/data/network states before drawing performance conclusions.

The benchmark startup guard rejects a second simultaneous start. It checks device availability and leases the phone during resets and runner execution. Device identity metadata supports unambiguous Mobilecli emulator aliases. Exact physical serials remain preferred.

CLI example, while the recorder is running:

    npm run bench -- --module catalog --case browse --runs 5 --warmup 1 --html benchmark.html

Use --no-reset when the saved flow intentionally continues from the current app state. --url accepts only a local recorder URL. Ctrl+C requests cancellation. Failure, cancellation and incomplete instrumentation remain visible in the result.
