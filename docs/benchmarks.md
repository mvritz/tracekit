# Reproducible measurements

Run `pnpm build`, start the default collector, then `pnpm bench`. The script writes [raw SDK and collector samples](benchmark-results.json), machine/tool versions, and methodology. Start the dashboard and install Chromium, then run `pnpm bench:dashboard` for [browser measurements](dashboard-benchmark-results.json). All generated spans are labeled `synthetic-benchmark`. No secrets or external model calls are involved.

## SDK

Seven samples after warmup measure baseline async callbacks versus traced callbacks at concurrency 1, 10, and 100. Units are milliseconds **per Promise.all group**, not per individual callback. The SDK transport uses an in-process acknowledged fetch stub to isolate SDK work; results include context, sanitization/validation, queueing, and occasional batch work. Separate cases measure AsyncLocalStorage and small/medium/large preview sanitization. These microbenchmarks are sensitive to JIT, GC, queue pressure, and host load. They do not claim an isolated production overhead or remote collector cost.

## Collector

For each batch size 1, 25, and 100, insert three independent traces of 1,000 spans over real loopback HTTP into SQLite WAL. Preserve all raw request latencies and run throughput. This is **HTTP + validation + transactional SQLite throughput**, not an isolated SQLite insert microbenchmark. The checked-in run uses `cargo run` (debug profile) on the machine described in the raw JSON. One-span batches also repeatedly validate the growing trace graph; larger batches amortize that work. A release build and other hardware will differ. No data is silently discarded during these successful acknowledged inserts.

## Browser

The checked-in browser measurements are the baseline from the initial flat dashboard, before the glass redesign. Re-run the command to measure the current design; these numbers do not describe its rendering cost.

Create synthetic traces with 100, 1,000, and 10,000 spans. Open fresh documents at 1440×1000 in headless Chromium against Vite and the real collector. After a warmup, record three navigations from document start through fetch and full DOM row creation, followed by a rendered animation frame. Browser assets are warm; each document has a fresh React Query cache. Startup of the browser/server is excluded. The exact count of rendered rows is recorded.

The dashboard is not virtualized; 10,000 spans are a hard protocol cap, not a recommendation for every trace. These timings do not measure user-perceived interaction responsiveness or prove an SLA. Add virtualization and a dedicated production-build benchmark before making large-scale performance claims. p95 with only three samples is effectively the maximum, not a statistically stable tail estimate.

Results are published to make the measurements inspectable and repeatable. They are not marketing promises, service-level commitments, or comparisons against other products. Performance benchmarks are manual and are not CI gates.
