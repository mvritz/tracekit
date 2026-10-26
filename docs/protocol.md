# Version 1 protocol

TypeScript schemas are in `packages/protocol/src/index.ts`; Rust DTOs and validation are in `crates/collector/src/models.rs`. Both execute the same golden batch fixtures. Unknown fields, versions, and kinds are rejected. JSON responses are not cached.

## IDs, clocks, and bounds

Trace IDs are 32 lowercase hex characters; span IDs are 16. All-zero IDs and self-parenting are invalid. Runs use UUIDs. One run owns one trace and service, with authoritative `mode` and `replay_of_run_id` fields.

Times are nonnegative epoch milliseconds, end >= start. Duration is monotonic nanoseconds, nonnegative and <= JavaScript's maximum safe integer (9,007,199,254,740,991, roughly 104 days). The waterfall positions spans by wall time and draws widths from monotonic duration, without mutating stored data. Cross-machine clock synchronization is outside v0.1.

Caps: 1 MiB request, 100 spans/batch, 10,000 spans/trace, 64 attributes, 64 events, depth 8, 128 object entries, 1,024 array entries, 32 KiB encoded span payload, 768 KiB fixture, 1,000 replay calls. String length caps use UTF-16 code units for TS/Rust agreement. Names: 1–200 printable characters; service: 1–100. Attribute values are primitive JSON with string values capped at 4,096 characters. Payload strings are capped at 32,768 characters. See the schemas for field-level rules.

## Batch

```json
{
  "schema_version": 1,
  "source": { "sdk": "tracekit-node", "version": "0.1.0" },
  "run": {
    "run_id": "11111111-1111-4111-8111-111111111111",
    "trace_id": "11111111111111111111111111111111",
    "service_name": "example",
    "mode": "record",
    "replay_of_run_id": null
  },
  "spans": ["See packages/protocol/src/fixtures/valid-batch.json for a valid envelope"]
}
```

This structural illustration is not a valid ingest request: `spans` must contain actual envelope objects. The checked-in valid-batch fixture is executable with curl:

```bash
curl -H 'Content-Type: application/json' \
  --data-binary @packages/protocol/src/fixtures/valid-batch.json \
  http://127.0.0.1:4319/v1/ingest/spans
```

Success: `{ "accepted": 1, "deduplicated": 0, "rejected": 0 }`. Exact repeats are deduplicated. Canonicalization sorts object keys recursively; arrays retain order. Rust canonicalizes the validated JSON, hashes it with SHA-256, and compares the immutable stored hash. The full batch rolls back on validation or identity conflict. The same span ID in another trace is allowed.

## Captured values

Optional `payload.input_state` and `payload.output_state` are `"value"` or `"undefined"`. New SDK captures set them so a callback with no return value is distinct from captured `null`, a literal `"[undefined]"` string, and capture being disabled. The JSON-safe preview is preserved alongside this metadata. Missing state fields remain valid for older captures. Their `"[undefined]"` marker is ambiguous; the inspector explains this and exposes the original preview. These fields describe display captures only; replay still requires lossless JSON values.

Rebuild and restart the collector alongside the SDK when upgrading: older v1 collectors reject unknown fields.

## Endpoints

| Method | Path                               | Result                                                           |
| ------ | ---------------------------------- | ---------------------------------------------------------------- |
| GET    | `/healthz`                         | DB readiness (`status: ok`)                                      |
| GET    | `/v1/meta`                         | Version, schemas, trace cap, replay mode                         |
| POST   | `/v1/ingest/spans`                 | Atomic ingest counts                                             |
| GET    | `/v1/traces`                       | `{items, next_cursor}`                                           |
| GET    | `/v1/traces/{trace_id}`            | Summary                                                          |
| GET    | `/v1/traces/{trace_id}/spans`      | `{items, truncated: false}` (10,000 cap)                         |
| GET    | `/v1/runs/{run_id}`                | Authoritative run identity                                       |
| POST   | `/v1/runs/{run_id}/replay-fixture` | Import/finalize an opted-in fixture for an existing recorded run |
| GET    | `/v1/runs/{run_id}/replay-fixture` | Export a finalized fixture                                       |

Import is intentionally tied to an existing recorded run with matching spans. A portable fixture from another machine can instead be loaded directly by the SDK; it does not need to be imported into the collector before replay. Replay runs may link to a source UUID absent from the local DB.

List query: `limit` (1–100, default 25), `cursor`, `service_name` (exact), `status` (`ok`, `error`, `cancelled`), `mode` (`record`, `replay`), `from`, `to` (inclusive epoch milliseconds), and `q` (case-insensitive name or trace ID substring). Order is `(start DESC, trace_id DESC, run_id DESC)`. The cursor is an opaque base64url tuple. Invalid cursors/filters return 400. A late-arriving earlier span may move a run across pages; polling the first page recovers it.

Errors use `{error:{code,message,request_id}}`, with fixed safe messages. 400 means invalid protocol, 403 forbidden Host/Origin, 404 absent resource or unfinalized fixture, 409 immutable conflict/incomplete fixture, 413 oversized body, 415 non-JSON write, and 503 storage unavailable. No error echoes submitted values. DB locks, disk errors, and other storage failures use a generic 503 to avoid leaking paths.

Local access is described in [SECURITY.md](../SECURITY.md). The collector does not expose a code execution route.
