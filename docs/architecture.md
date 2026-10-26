# Architecture

The application, collector, and browser are separate processes. The SDK uses Node `AsyncLocalStorage` for trace/run/span context and cryptographic random IDs. A completed span is serialized, sanitized, validated, and placed in a bounded queue. Only completed spans are transmitted; this version does not show in-progress executions.

The transport groups adjacent spans by authoritative run identity, emits at most 100 spans per batch, and has one drain worker. Immutable span IDs make retransmission idempotent. The queue is volatile and drops newest entries at its capacity or 8 MiB. Transient retries are capped. Timer handles are unreferenced so instrumentation does not keep a short-lived Node program alive. Explicit `shutdown` is still needed to await delivery.

Axum validates versioned DTOs before opening a SQLite write transaction. `BEGIN IMMEDIATE` serializes writes before reading immutable identities. SQLite uses WAL, a five-second busy timeout, foreign keys, a four-connection pool, numbered migrations, and indexes. A batch either commits completely or returns an error. Conflicting duplicates return 409, with no partial insertion. Unknown parents are allowed; every update rechecks the stored trace graph for cycles. A trace can contain at most 10,000 spans and one root; one run owns one trace. Root arrival is not required for initial ingestion.

Run identity and replay linkage are separate from span attributes. First write fixes trace ID, service, mode, and source run. Later batches must agree. Summary start time tracks the earliest observed span; root name/duration become authoritative once available. Any error span marks the trace as error, even if handled higher up. The `complete` read field means the completed root has arrived, not that detached asynchronous work is impossible.

Replay fixtures use a separate finalization endpoint and tables. A finalization transaction verifies the record run, root presence, known parents, and exact multiset of tool names, then stores the fixture and its ordered calls. Repeated identical finalization is idempotent. New spans cannot be appended after finalization; duplicate retransmissions remain valid. A malicious producer can falsely claim completeness, so fixture provenance remains a local trust decision.

The dashboard polls every two seconds through TanStack Query. It never reads the DB directly. Hierarchical span buttons support Up/Down/Home/End selection and Left/Right folding. Orphans remain visible. Original/replay comparisons match hierarchy plus same-name occurrence; they are a diagnostic comparison, not a proof of equivalent program behavior. Timing in replay includes substitutions rather than live IO.

See the [ADRs](adr), [protocol](protocol.md), [SDK reference](sdk.md), and [privacy boundaries](privacy.md). Full OpenTelemetry ingest/export and distributed context propagation are deferred.

Dashboard span rendering uses a fixed-height window with keyboard-aware scrolling; full trace data is fetched and validated but only visible rows and overscan mount. Completed-trace summary polling detects changed span counts without repeatedly downloading unchanged span bodies. The collector's span read path validates stored canonical JSON as borrowed raw JSON and serializes those raw values, preserving the same response contract while avoiding repeated object allocation.
