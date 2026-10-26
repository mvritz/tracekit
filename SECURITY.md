# Security policy

Report vulnerabilities privately using [GitHub private vulnerability reporting](https://github.com/mvritz/tracekit/security/advisories/new). Do not put live credentials, customer traces, or exploit payloads containing personal data in public issues. Include a minimal synthetic reproduction, affected commit/version, and expected impact.

The initial 0.1 branch is experimental; fixes will land on the default branch. No response-time SLA or enterprise security certification is promised.

## Trust boundaries

- The collector accepts only loopback bind addresses and loopback Host headers, with a single configured browser Origin. State-changing endpoints require JSON. These controls restrict browser access; they do not authenticate other local processes.
- The SQLite file is chmod 0600 on Unix. The demo creates its data directory with 0700 and fixtures with 0600. Use an encrypted/trusted local disk and restrict backup access. Windows access follows your directory ACLs. Do not expose the collector through a public proxy or tunnel.
- Inputs, outputs, and error messages are disabled by default. The SDK serializes and sanitizes before enqueueing. Default key and common credential-pattern scrubbing is heuristic, not comprehensive PII detection. Attribute values, operation names, and custom sanitizer policy are the caller's responsibility.
- Replay data has a separate explicit opt-in and complete-value limits. Imported fixtures must use the sanitized policy, pass the versioned schema, and reject obvious unredacted credential fields. An attacker can forge that declaration; inspect external fixtures and trust their producer. Replayed values can influence your application's own local behavior.
- Replay never invokes the registered live handler. Other network, database, filesystem, and arbitrary application behavior outside a tool boundary still runs. TraceKit is not a sandbox.
- The collector never executes application source or shells out on behalf of the dashboard. Payloads are escaped text, never HTML. SQLite queries are bound parameters. Invalid batches roll back atomically.
- Bodies are capped at 1 MiB, batches at 100 spans, a trace at 10,000 spans, fixture calls at 1,000, and JSON nesting at 8. The SDK queue is count- and byte-bounded. Local trusted clients can still consume disk by creating many runs; retention is manual in v0.1.

Logs contain startup metadata and no submitted bodies. Error responses contain fixed messages and generated request IDs. Read the [privacy model](docs/privacy.md) and [replay limitations](docs/replay.md) before enabling capture on sensitive applications.
