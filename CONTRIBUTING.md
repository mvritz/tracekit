# Contributing

Use Node 22.12+ (CI uses 24.0.1), Bun 1.3.13, and the pinned Rust 1.92 toolchain. Clone, run `bun install --frozen-lockfile`, then `bun run check`. Bun is pinned in `.bun-version`, `packageManager`, the install guard, and CI; commit `bun.lock` changes and verify with `bun install --frozen-lockfile`. No API keys are needed. After dependencies and Chromium are installed, unit and browser tests require no external services or internet access.

## Development

`bun run dev` builds the packages and starts the collector and Vite dashboard under one signal-forwarding supervisor. For two terminals, run `cargo run --locked -p tracekit-collector` and `bun run --filter @tracekit/dashboard dev` after `bun run build`. The default database is `.tracekit/tracekit.db` relative to the collector's working directory.

## Required checks

```bash
bun run check
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
bunx --no-install playwright install chromium
bun run test:e2e
```

`bun run test` runs TypeScript unit, golden protocol, and React component tests. Rust integration tests use temporary SQLite databases and in-process HTTP requests. Browser tests run the real collector and SDK demo. CI supplies a temporary DB path. Locally, E2E may reuse running services and adds synthetic traces; use a separate `TRACEKIT_DB_PATH` if desired. Checks must pass without relying on previously built output: `bun run check` builds first.

## Package checks

The SDK and protocol packages are not yet published to npm. Build and inspect tarballs:

```bash
bun run build
bun pm --cwd packages/protocol pack --dry-run
bun pm --cwd packages/sdk pack --dry-run
bun pm --cwd packages/protocol pack
bun pm --cwd packages/sdk pack
```

`bun pm pack` rewrites workspace dependencies to version 0.1.0. Install **both** resulting tarballs in another local Node project. Until these packages are published, Bun consumers must also override the SDK's protocol dependency to the local protocol tarball (otherwise Bun tries the registry). For example, in the consuming project's `package.json`:

```json
{
  "dependencies": {
    "@tracekit/protocol": "file:/absolute/path/tracekit-protocol-0.1.0.tgz",
    "@tracekit/sdk": "file:/absolute/path/tracekit-sdk-0.1.0.tgz"
  },
  "overrides": {
    "@tracekit/protocol": "file:/absolute/path/tracekit-protocol-0.1.0.tgz"
  }
}
```

Then run `bun install`. The packed SDK can run in Node. Package publication and Git tags are separate maintainer actions.

## Changes

Open an issue for a substantial contract change. Keep PRs focused on behavior and include the relevant verification. Add regression tests for context, serialization, replay, and storage invariants. Keep TS and Rust validation in agreement with shared golden fixtures. Add migrations instead of modifying an already released migration. Never include real traces, credentials, fixture outputs, or environment files.

The dashboard uses plain CSS, a static dark gradient, opaque surfaces, and mint accents. Avoid backdrop filters, photographic backgrounds, and entrance blur animations. See docs/visual-design.md for layout rules. Status indicators must have text, focus rings must remain visible, and absent payloads, captured nulls, undefined returns, and literal strings must stay distinct. All trace content must be rendered as escaped text.

Benchmarks are manual, reproducible commands, not noisy PR gates. Record machine and tool versions with raw samples. See the [code of conduct](CODE_OF_CONDUCT.md) and [security policy](SECURITY.md).
