# Troubleshooting

## No traces or collector unavailable

Run `pnpm dev` from the repository root. Check `http://127.0.0.1:4319/healthz`. Run `pnpm demo:record` again after the server starts; the SDK's volatile queue does not persist across process exits. `dropped`/`failures` indicate unsuccessful telemetry, not application failure. Await `shutdown()` in your application.

Use `http://127.0.0.1:3000` exactly. Default CORS allows that origin, not `localhost`, HTTPS, or another port. Change `TRACEKIT_ALLOWED_ORIGIN` to a single loopback HTTP origin if needed. Do not use a tunnel or public bind address. If the collector port changes, update the dashboard API constant too.

## Missing SDK exports or declarations

Run `pnpm install --frozen-lockfile`, then `pnpm build`. These packages use built ESM exports. The npm package names are reserved only in this workspace; nothing has been published by this repository. For another project, install both local tarballs built with `pnpm pack`.

## Rust toolchain / dependency errors

Use the checked-in Rust 1.92 toolchain and committed Cargo.lock. `rustup` will install that toolchain on first build. Run `cargo build --locked --workspace`. The first build needs internet. A non-loopback host or malformed origin fails startup deliberately. An occupied port also fails startup; stop the other process or choose another port.

## SQLite locked / unavailable

Other writers or a full disk can produce 503 responses. Do not delete a live WAL file. Stop the collector cleanly, inspect available disk space, and retry. New installations migrate automatically; future schema changes must use new migrations. Back up the whole data directory while stopped.

## Replay fixture missing

Enable `replay.capture` independently of `capture.outputs`. Await a root trace and every tool, with sequential boundaries. Only bounded plain JSON is recordable. Undefined, BigInt, accessors, Date/class instances, cyclic/oversized structures, overlapping/nested handlers, and pending tools invalidate capture. Check `replayCaptureFailures` and `fixturesDelivered`. Server export additionally requires successful span delivery and complete root/parents. A locally available fixture can still be replayed without server import.

## Replay mismatch

Use the same workflow, boundary order/name, service, sanitized input, and redaction settings. A missing/extra call, changed input, or fixture version mismatch fails closed and never falls back to the live handler. Recorded exceptions are typed wrappers, not the original class instance. Noninstrumented side effects and globals remain live. Replay duration is not a live-service benchmark.

## Browser test setup

Run `pnpm exec playwright install chromium` (Linux: `--with-deps chromium`). Then `pnpm test:e2e`. The tests start services when ports are free; locally they may reuse running ones. Set a temporary DB path before a new collector start for isolated data. Failure artifacts are in ignored `test-results/`. The CI version uses a temporary database.

## Large traces

A trace is capped at 10,000 spans. The v0.1 waterfall renders actual DOM rows without virtualization; very large traces take longer to open. IDs and long labels are constrained or wrapped; the timeline scrolls horizontally at small viewport sizes. See the recorded browser benchmark, and avoid treating it as a production SLA.
