# Changelog

## 0.1.0 — Initial source release

- Typed Node ESM SDK with nested async spans, concurrent sibling context, safe previews, redaction, bounded transport, diagnostics, and graceful drain.
- Rust Axum collector with versioned validation, SQLite WAL migrations, immutable atomic ingestion, deterministic cursor pagination, filters, and loopback access checks.
- React dashboard with real trace data, waterfall, keyboard selection, inspector, linked replay comparison, offline state, and fixture export.
- Independently opted-in, finalized sequential replay fixtures. JSON tool returns and safe recorded errors substitute handlers; mismatches fail closed.
- Offline research-agent example, cross-language contract fixtures, regression tests, browser E2E, CI, package dry-runs, screenshots, and reproducible benchmark scripts.

Known limitations: no npm publication, hosted/multi-user support, automatic framework instrumentation, full OTel bridge, streaming, retention scheduling, or concurrent/nested tool replay capture. Display is capped at 10,000 spans and is not virtualized. Sanitized replay data can differ from original private values. Uninstrumented side effects and nondeterminism remain the application's responsibility.
