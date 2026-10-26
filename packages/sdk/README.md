# @tracekit/sdk

Node ESM SDK for local TraceKit tracing and controlled-boundary replay. Requires Node 22.12+. Source release only; not published to npm.

See the [repository quickstart](https://github.com/mvritz/tracekit#quickstart), [SDK reference](https://github.com/mvritz/tracekit/blob/main/docs/sdk.md), and [replay semantics](https://github.com/mvritz/tracekit/blob/main/docs/replay.md). Inputs, outputs, errors, and replay outcomes require explicit opt-in. Always await `shutdown()` before exit.
