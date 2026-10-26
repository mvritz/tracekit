# Reproducible measurements

Run `bun run build`, start the default collector, then `bun run bench`. The script writes [raw SDK and collector samples](benchmark-results.json), machine/tool versions, and methodology. Start the dashboard and install Chromium, then run `bun run bench:dashboard` for [browser measurements](dashboard-benchmark-results.json). All generated spans are labeled `synthetic-benchmark`. No secrets or external model calls are involved.

## SDK

Seven samples after warmup measure baseline async callbacks versus traced callbacks at concurrency 1, 10, and 100. Units are milliseconds **per Promise.all group**, not per individual callback. The SDK transport uses an in-process acknowledged fetch stub to isolate SDK work; results include context, sanitization/validation, queueing, and occasional batch work. Separate cases measure AsyncLocalStorage and small/medium/large preview sanitization. These microbenchmarks are sensitive to JIT, GC, queue pressure, and host load. They do not claim an isolated production overhead or remote collector cost.

## Collector

For each batch size 1, 25, and 100, insert three independent traces of 1,000 spans over real loopback HTTP into SQLite WAL. Preserve all raw request latencies and run throughput. This is **HTTP + validation + transactional SQLite throughput**, not an isolated SQLite insert microbenchmark. The checked-in run uses `cargo run` (debug profile) on the machine described in the raw JSON. One-span batches also repeatedly validate the growing trace graph; larger batches amortize that work. A release build and other hardware will differ. No data is silently discarded during these successful acknowledged inserts.

## Browser

The [before samples](dashboard-before-results.json) measure the photographic glass dashboard at commit `ca806aa`. The [current samples](dashboard-benchmark-results.json) measure the dark, windowed dashboard and optimized collector read path on the same Apple M3 Pro, in Chromium 156 at 1440×1000. The collector uses its debug build in both runs.

| Spans  | Before median | Current median | Speedup | Mounted rows before → after |
| ------ | ------------- | -------------- | ------- | --------------------------- |
| 100    | 132 ms        | 67 ms          | 2.0×    | 100 → 14                    |
| 1,000  | 351 ms        | 89 ms          | 3.9×    | 1,000 → 14                  |
| 10,000 | 2200 ms       | 328 ms         | 6.7×    | 10,000 → 14                 |

Create synthetic traces with 100, 1,000, and 10,000 spans. Open fresh documents against Vite and the real collector. After a warmup, record three navigations through the full trace fetch, tree construction, row mounting, and a rendered animation frame. Browser assets are warm; each document has a fresh React Query cache. Browser/server startup is excluded. Before, readiness meant all rows were mounted. Now, readiness means the full trace is available to the waterfall and its visible rows are mounted. This is the intended difference; the data itself is still fully fetched and validated. Raw sample times and row counts are retained.

Windowing keeps DOM size bounded. Tree construction uses append operations and iterative error propagation instead of repeated array copies and subtree scans. The collector validates stored canonical JSON with borrowed `RawValue` references and writes it directly into the JSON response, avoiding object-tree allocation and reserialization. Completed traces retain their span data and use small summary polls to detect late arrivals. Filters debounce text input. The background photo (111 KiB), backdrop blur, and entrance effects have been removed.

These are local development-server measurements on one machine, with three measured samples per case. They are not production-build measurements, interaction-latency tests, or an SLA. The recorded p95 is effectively the largest of three samples, not a stable tail estimate. Payload-heavy traces and other hardware will differ. The 10,000-span protocol cap remains unchanged. Benchmarks are manual and are not CI gates.
