# Contributing

Use Node 22.12+ (CI uses 24.0.1), pnpm 9.15.4, and the pinned Rust 1.92 toolchain. Clone, run `pnpm install --frozen-lockfile`, then `pnpm check`. No API keys are needed. After dependencies and Chromium are installed, unit and browser tests require no external services or internet access.

## Development

`pnpm dev` builds the packages and starts the collector and Vite dashboard under one signal-forwarding supervisor. For two terminals, run `cargo run --locked -p tracekit-collector` and `pnpm --filter @tracekit/dashboard dev` after `pnpm build`. The default database is `.tracekit/tracekit.db` relative to the collector's working directory.

## Required checks

```bash
pnpm check
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm test` runs TypeScript unit, golden protocol, and React component tests. Rust integration tests use temporary SQLite databases and in-process HTTP requests. Browser tests run the real collector and SDK demo. CI supplies a temporary DB path. Locally, E2E may reuse running services and adds synthetic traces; use a separate `TRACEKIT_DB_PATH` if desired. Checks must pass without relying on previously built output: `pnpm check` builds first.

## Package checks

The SDK and protocol packages are not yet published to npm. Build and inspect tarballs:

```bash
pnpm build
pnpm --filter @tracekit/protocol exec npm pack --dry-run
pnpm --filter @tracekit/sdk exec npm pack --dry-run
pnpm --dir packages/protocol pack
pnpm --dir packages/sdk pack
```

`pnpm pack` rewrites workspace dependencies to version 0.1.0. Install **both** resulting tarballs in another local Node project. `npm pack --dry-run` is only a file-list check; use `pnpm pack` to produce distributable tarballs. Package publication and Git tags are separate maintainer actions.

## Changes

Open an issue for a substantial contract change. Keep PRs focused on behavior and include the relevant verification. Add regression tests for context, serialization, replay, and storage invariants. Keep TS and Rust validation in agreement with shared golden fixtures. Add migrations instead of modifying an already released migration. Never include real traces, credentials, fixture outputs, or environment files.

The dashboard uses plain CSS and a white/gray Swiss grid with one orange accent. Status indicators must have text, focus rings must remain visible, and absent payloads must stay distinct from captured nulls. All trace content must be rendered as escaped text.

Benchmarks are manual, reproducible commands, not noisy PR gates. Record machine and tool versions with raw samples. See the [code of conduct](CODE_OF_CONDUCT.md) and [security policy](SECURITY.md).
