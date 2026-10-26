# Controlled-boundary replay

TraceKit repeats local JavaScript control flow while substituting results at explicitly registered `recordTool(name, handler, input)` boundaries. The registered handler never executes in replay mode, including on invalid/missing matches. TraceKit does not sandbox or intercept unrelated application effects.

## Recording and finalization

1. Enable `replay: {mode: 'record', capture: true}` separately from display capture.
2. Each root owns a sequence counter, records a tool name/key, hashes canonical sanitized input, and captures a complete sanitized JSON return or safe error.
3. Await all tools. Overlapping/nested boundaries and pending work make the fixture unavailable. If a tool returns an unsupported value, the application still gets that original value, but the recording becomes incomplete.
4. At root completion (success or application error), the SDK validates the independent fixture and queues finalization after span delivery.
5. The collector verifies a completed root, all referenced parents, and the exact number/names of tool spans in one transaction. It stores fixture metadata plus ordered calls in dedicated tables. Later new spans for that finalized run are rejected, preventing export from silently drifting.

An application failure can therefore have a complete replay fixture. A truncated input/output preview cannot supply one. The SDK keeps only the latest completed root fixture; persist each fixture immediately if multiple runs matter.

## Strict sequential matching

A call's key is `boundary_name#sequence`, where sequence starts at zero per root. The hash is `sha256:` plus 64 lowercase hex digits over canonical sanitized JSON input. Object keys are recursively sorted; array order matters. The sanitizer and application input policy must be the same during recording and replay. Differences removed by sanitization (for example two different secret tokens) intentionally do not produce different input hashes.

On replay, the next call must match name, key, and hash. A return is defensively cloned; a throw becomes `RecordedToolError` with `recordedType` and safe message. Wrong input/name, exhausted calls, missing calls at root completion, or even a caught mismatch mark divergence and raise `ReplayMismatchError`. No live fallback exists.

Sequential tools only: v0.1 refuses finalized recordings for overlapping/nested tool handlers. This includes deterministic `Promise.all` boundaries; use sequential awaits or await a future stable-key mode. Ordinary concurrent spans remain fully supported. A tool handler may contain normal spans, but those inner spans are skipped along with the handler during replay and appear as missing in comparison.

Sanitized outputs are the replay values. Redaction may change local branches, and reconstructed errors have a different prototype from the original exception. Check `RecordedToolError.recordedType` if application logic needs to branch by safe recorded type. Do not assume exact object identity or arbitrary exception subclass reenactment.

## Files and imports

Version 1 fixtures require `finalized: true`, `capture_policy: 'explicit-opt-in-sanitized'`, source run/trace IDs, service, creation time, and contiguous ordered calls. Limits and schemas reject unsafe/unknown formats. Known raw credential fields are rejected, but the policy marker is not cryptographic proof of sanitization: inspect fixtures from third parties and configure PII redaction.

The demo creates synthetic fixtures with private permissions under ignored `.tracekit/`. For your own fixtures, `saveReplayFixture` creates a new file exclusively with mode 0600. It never overwrites an existing file. `loadReplayFixture` validates before a replay client is created. The replay client service must match the fixture service.

Use `GET /v1/runs/{id}/replay-fixture` for server export. To import/finalize into the collector, POST the fixture to the same path for an existing matching record run. To replay an external fixture, simply load it in Node; source spans do not need to exist locally. The replay trace links back by source UUID.

## Outside the guarantee

Unwrapped network/filesystem/database calls, provider SDK calls outside registered boundaries, randomness, time, environment, global state, process boundaries, detached async work, changed code, and nondeterministic scheduling can diverge or repeat side effects. The collector has no code execution endpoint; the dashboard provides local CLI guidance. Compare hierarchy/status in the dashboard and interpret replay duration as substitution overhead, not a performance improvement.
