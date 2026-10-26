# ADR 0001: Loopback collector and SQLite WAL

Accepted. TraceKit's first audience is a developer investigating one local Node application. Use Rust/Axum on loopback and SQLite WAL with numbered migrations, foreign keys, bounded pool, and serialized transactional writes. No hosted account, remote auth, or team service is included. Reject public binds and unexpected Host/Origin headers. Local processes remain trusted. This keeps the developer loop inspectable but requires manual retention and backups.
