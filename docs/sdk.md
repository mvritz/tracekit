# Node SDK reference

```ts
const tk = createTraceKit({
  serviceName: 'my-agent',
  endpoint: 'http://127.0.0.1:4319',
  capture: { inputs: false, outputs: false, errors: false },
  batching: {
    maxBatchSize: 50,
    flushIntervalMs: 500,
    maxQueueSize: 2000,
    requestTimeoutMs: 1000,
    maxRetries: 2,
  },
});
```

`serviceName` is required. ESM and Node 22.12+ are supported; browser and worker-thread automatic context are not.

| Method                                            | Semantics                                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `trace<T>(name, callback, options?)`              | New root/run, always `Promise<T>`; nested calls are independent roots                   |
| `span<T>(name, callback, options?)`               | Child of active span, or implicit root                                                  |
| `recordTool<I,O>(name, handler, input, options?)` | Recorded boundary; handler receives input once in record mode and zero times in replay  |
| `flush()`                                         | Best-effort bounded queue drain; resolves without throwing on delivery failure          |
| `shutdown()`                                      | Stop timer, attempt drain, discard remaining queue; await before exit                   |
| `getDiagnostics()`                                | Queued, dropped, delivered, failed batches, replay capture failures, fixtures delivered |
| `getReplayFixture()`                              | Defensive copy of latest complete captured root; throws if no complete fixture          |
| `loadReplayFixture(path)`                         | Read/validate a finalized, versioned, sanitized-policy JSON fixture                     |
| `saveReplayFixture(path, fixture)`                | Validate and exclusively create a 0600 fixture; refuses overwrite                       |

Trace/span options: primitive `attributes`, `captureInput`, `captureOutput`; spans additionally accept `kind` (`agent`, `llm`, `tool`, `retrieval`, `internal`). `captureInput` applies to `recordTool`, whose input is explicit; trace/span callback closures have no automatic argument capture. Outputs are captured only when opted in. Error capture is a client-level option. Error objects preserve safe type/message; stacks are not captured in v0.1.

Callbacks execute exactly once. Instrumentation catches its own serialization/validation failures and increments diagnostics, while preserving the application value or exact exception object. Invalid SDK construction options or malformed replay fixtures fail immediately. Replay mismatches are deliberate runtime errors; their messages contain only fixed metadata, never raw tool input. Abort errors from application callbacks are recorded as errors; there is no separate cancellation API yet.

## Sanitization

`redaction.keys` adds exact, case/punctuation-insensitive denied keys to defaults; `patterns` replaces matched text with `[REDACTED]`; `custom` receives an already safely serialized value and its result is sanitized again. It must be pure and deterministic, especially across record and replay. Key rules apply recursively to arrays and objects. Metadata names/attributes and errors also pass through the sanitizer. Default key matching is exact after normalization, not a universal secret detector.

Preview serialization handles non-JSON values predictably: cycles become `[Circular]`, unsupported primitives become type markers, BigInt becomes a string, dates become ISO, errors become safe type/message, binary becomes `[Binary]`, accessors become `[Accessor]` without executing getters, and over-depth values become `[Depth limit]`. Strings/collections are bounded. A serialized preview over 12,000 bytes becomes an explicit truncation marker. Input and output previews together remain below the 32 KiB protocol cap.

Replay serialization is stricter: undefined, BigInt, functions, symbols, cycles, accessors, non-plain objects, over-depth/oversize structures, and non-finite numbers make the recording incomplete. Redacted fields intentionally contain the redaction marker. Each complete JSON tool value is capped at 256 KiB; fixture limits also apply. Lossy records never become finalized fixtures. See [replay.md](replay.md).

## Delivery and lifetime

The queue caps spans by count and a fixed 8 MiB serialized-byte budget; overflow drops the newest span. The in-flight batch remains in the queue until its attempt completes, so it counts toward capacity. A single worker groups adjacent spans from the same run and sends up to 100 at a time. Retry uses exponential backoff with jitter (2 retries by default, max 5); network failures, HTTP 429, and 5xx qualify. Other 4xx responses are dropped immediately. Accepted counts are exposed locally as delivered span count.

A drain processes at most one queue capacity and has a five-second deadline. Each request timeout is bounded by the remaining deadline. Automatic interval timers are `unref()`ed. A concurrent `flush()` shares the existing worker. Once that worker's budget is exhausted, newly queued spans may need a later flush. `shutdown()` discards any remainder after its bounded drain. Keep application work awaited before shutdown. Default timers don't keep Node alive; a pending explicit HTTP drain can until timeout. There is no durable offline spool.

Fixture finalization is attempted only after the span queue empties. A fixture upload rejection increments `replayCaptureFailures`; the local `getReplayFixture()` may still be available. Check `fixturesDelivered` if server export is required. Up to 16 pending fixtures are kept per client; dispose of clients with shutdown. Never log raw request bodies to investigate an outage.
