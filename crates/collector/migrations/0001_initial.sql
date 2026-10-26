CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  trace_id TEXT NOT NULL UNIQUE,
  service_name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('record','replay')),
  replay_of_run_id TEXT,
  started_at_ms INTEGER NOT NULL,
  CHECK ((mode = 'record' AND replay_of_run_id IS NULL) OR (mode = 'replay' AND replay_of_run_id IS NOT NULL))
);
CREATE TABLE spans (
  trace_id TEXT NOT NULL,
  span_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  parent_span_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  kind TEXT NOT NULL,
  start_time_ms INTEGER NOT NULL,
  end_time_ms INTEGER NOT NULL,
  duration_ns INTEGER NOT NULL,
  canonical_json TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  PRIMARY KEY (trace_id, span_id)
);
CREATE UNIQUE INDEX one_root_per_trace ON spans(trace_id) WHERE parent_span_id IS NULL;
CREATE INDEX idx_spans_run ON spans(run_id);
CREATE INDEX idx_spans_parent ON spans(trace_id, parent_span_id);
CREATE INDEX idx_runs_start ON runs(started_at_ms DESC, trace_id DESC, run_id DESC);
CREATE INDEX idx_runs_mode ON runs(mode, started_at_ms DESC);
CREATE TABLE replay_fixtures (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
  canonical_json TEXT NOT NULL,
  canonical_hash TEXT NOT NULL
);
CREATE TABLE replay_calls (
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  boundary_name TEXT NOT NULL,
  boundary_key TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  outcome_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (run_id, sequence),
  UNIQUE (run_id, boundary_key)
);
