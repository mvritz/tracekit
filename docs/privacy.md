# Privacy and local data

Default SDK capture is off for input, output, and error message. TraceKit still records names, kinds, timestamps, durations, service, IDs, and explicitly provided attributes. Treat metadata as potentially sensitive. No hosted service or analytics is contacted by TraceKit at runtime; the application itself can of course perform its own network calls. Dependency installation and development tooling downloads require network access.

Sanitization happens in the application before any queue, request, or persistent replay record. Denied keys include authorization, cookie, set-cookie, token, api_key, apikey, secret, password, private_key, and access_key, normalized case/punctuation-insensitively. Common Bearer and inline key/value credentials are also scrubbed. Add exact keys, regex patterns, or a custom sanitizer for email, account IDs, and domain-specific fields. Heuristics cannot guarantee that arbitrary strings contain no secrets.

Raw callback inputs and outputs are never kept as deferred telemetry references. Safe previews are separate from replay records, which need their own explicit opt-in. Replay hashes contain only canonical sanitized input digests, not raw inputs. Redacted values are unavailable during replay and may alter application behavior.

Error details are disabled by default. Opted-in errors capture sanitized type/message without stacks. Errors during transport and collector validation never echo submitted content. SDK counters and fixed diagnostics are intended for outage investigations.

## Storage, backups, deletion

The default path is `.tracekit/tracekit.db` relative to the collector's current directory, configurable with `TRACEKIT_DB_PATH`. SQLite uses WAL, so an active DB can also have `-wal` and `-shm` files. Stop the collector before a simple filesystem backup, then copy the entire directory. Alternatively, use SQLite's online backup API. Never copy only a live DB file and assume it contains uncheckpointed writes.

Unix DB files are chmod 0600; the demo creates directories with 0700 and fixtures with 0600. Existing directory permissions and Windows ACLs are your responsibility. Files and backups are not encrypted by TraceKit. Keep them on a trusted disk. Exported browser downloads follow the browser's directory permissions; review before sharing.

There is no automatic retention. Stop the collector, back up anything needed, and run `pnpm clean:data --yes` from the repository root to permanently remove that checkout's `.tracekit/` directory. The command refuses while the default collector is reachable. For custom DB paths, stop the corresponding collector and delete only your intended DB/sidecars manually. Migration failures preserve existing data and fail startup.

`.tracekit/`, `.env*` (except `.env.example`), and tarballs are Git-ignored. Checked-in contract data and screenshots are synthetic. Never commit customer fixtures, traces, or credentials.
