use crate::{
    error::ApiError,
    models::{acyclic, Batch, Fixture, Run},
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::{path::Path, time::Duration};
pub async fn connect(path: &Path) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true)
        .journal_mode(SqliteJournalMode::Wal)
        .busy_timeout(Duration::from_secs(5));
    let pool = SqlitePoolOptions::new()
        .max_connections(4)
        .connect_with(options)
        .await?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|e| sqlx::Error::Protocol(e.to_string()))?;
    Ok(pool)
}
fn canonical<T: serde::Serialize>(value: &T) -> Result<String, ApiError> {
    serde_json::to_value(value)
        .and_then(|v| serde_json::to_string(&v))
        .map_err(|_| ApiError::invalid())
}
fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
pub async fn ingest(pool: &SqlitePool, batch: Batch) -> Result<Value, ApiError> {
    if !batch.valid() {
        return Err(ApiError::invalid());
    }
    // BEGIN IMMEDIATE serializes writers before reading immutable identities.
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let run = &batch.run;
    if let Some(row) =
        sqlx::query("SELECT trace_id,service_name,mode,replay_of_run_id FROM runs WHERE run_id=?")
            .bind(&run.run_id)
            .fetch_optional(&mut *tx)
            .await?
    {
        if row.get::<String, _>("trace_id") != run.trace_id
            || row.get::<String, _>("service_name") != run.service_name
            || row.get::<String, _>("mode") != run.mode
            || row.get::<Option<String>, _>("replay_of_run_id") != run.replay_of_run_id
        {
            return Err(ApiError::conflict());
        }
    } else {
        if sqlx::query_scalar::<_, String>("SELECT run_id FROM runs WHERE trace_id=?")
            .bind(&run.trace_id)
            .fetch_optional(&mut *tx)
            .await?
            .is_some()
        {
            return Err(ApiError::conflict());
        }
        sqlx::query("INSERT INTO runs (run_id,trace_id,service_name,mode,replay_of_run_id,started_at_ms) VALUES(?,?,?,?,?,?)").bind(&run.run_id).bind(&run.trace_id).bind(&run.service_name).bind(&run.mode).bind(&run.replay_of_run_id).bind(batch.spans.iter().map(|s|s.start_time_unix_ms as i64).min().unwrap_or(0)).execute(&mut *tx).await?;
    }
    let finalized =
        sqlx::query_scalar::<_, String>("SELECT run_id FROM replay_fixtures WHERE run_id=?")
            .bind(&run.run_id)
            .fetch_optional(&mut *tx)
            .await?
            .is_some();
    let mut accepted = 0;
    let mut deduplicated = 0;
    for span in &batch.spans {
        let content = canonical(span)?;
        let hash = digest(&content);
        if let Some(old) = sqlx::query_scalar::<_, String>(
            "SELECT canonical_hash FROM spans WHERE trace_id=? AND span_id=?",
        )
        .bind(&span.trace_id)
        .bind(&span.span_id)
        .fetch_optional(&mut *tx)
        .await?
        {
            if old != hash {
                return Err(ApiError::conflict());
            }
            deduplicated += 1;
            continue;
        }
        if finalized {
            return Err(ApiError::conflict());
        }
        if span.parent_span_id.is_none()
            && sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM spans WHERE trace_id=? AND parent_span_id IS NULL",
            )
            .bind(&span.trace_id)
            .fetch_one(&mut *tx)
            .await?
                > 0
        {
            return Err(ApiError::conflict());
        }
        sqlx::query("INSERT INTO spans (trace_id,span_id,run_id,parent_span_id,name,status,kind,start_time_ms,end_time_ms,duration_ns,canonical_json,canonical_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(&span.trace_id).bind(&span.span_id).bind(&span.run_id).bind(&span.parent_span_id).bind(&span.name).bind(&span.status).bind(&span.kind).bind(span.start_time_unix_ms as i64).bind(span.end_time_unix_ms as i64).bind(span.duration_ns as i64).bind(content).bind(hash).execute(&mut *tx).await?;
        accepted += 1;
    }
    let edges: Vec<(String, Option<String>)> =
        sqlx::query_as("SELECT span_id,parent_span_id FROM spans WHERE trace_id=?")
            .bind(&run.trace_id)
            .fetch_all(&mut *tx)
            .await?;
    if edges.len() > 10000 || !acyclic(&edges) {
        return Err(ApiError::invalid());
    }
    sqlx::query("UPDATE runs SET started_at_ms=MIN(started_at_ms,?) WHERE run_id=?")
        .bind(
            batch
                .spans
                .iter()
                .map(|s| s.start_time_unix_ms as i64)
                .min()
                .unwrap_or(0),
        )
        .bind(&run.run_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(json!({"accepted":accepted,"deduplicated":deduplicated,"rejected":0}))
}
pub async fn get_run(pool: &SqlitePool, id: &str) -> Result<Run, ApiError> {
    let r = sqlx::query(
        "SELECT run_id,trace_id,service_name,mode,replay_of_run_id FROM runs WHERE run_id=?",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(ApiError::missing)?;
    Ok(Run {
        run_id: r.get("run_id"),
        trace_id: r.get("trace_id"),
        service_name: r.get("service_name"),
        mode: r.get("mode"),
        replay_of_run_id: r.get("replay_of_run_id"),
    })
}
fn safe_fixture(v: &Value) -> bool {
    static INLINE: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"(?i)\b(password|token|api[_-]?key|secret)\s*[:=]\s*([^\s,;]+)")
            .expect("Static credential pattern")
    });
    match v {
        Value::Array(a) => a.iter().all(safe_fixture),
        Value::Object(o) => o.iter().all(|(k, v)| {
            let key: String = k
                .to_lowercase()
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .collect();
            if [
                "authorization",
                "cookie",
                "setcookie",
                "token",
                "apikey",
                "secret",
                "password",
                "privatekey",
                "accesskey",
                "accesstoken",
                "refreshtoken",
                "sessiontoken",
                "clientsecret",
            ]
            .contains(&key.as_str())
            {
                v == "[REDACTED]"
            } else {
                safe_fixture(v)
            }
        }),
        Value::String(s) => {
            !INLINE
                .captures_iter(s)
                .any(|c| c.get(2).is_some_and(|v| v.as_str() != "[REDACTED]"))
                && !s
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .windows(2)
                    .any(|w| w[0].eq_ignore_ascii_case("bearer") && w[1] != "[REDACTED]")
        }
        _ => true,
    }
}
pub async fn finalize(pool: &SqlitePool, id: &str, fixture: Fixture) -> Result<Value, ApiError> {
    if !fixture.valid()
        || fixture.source_run_id != id
        || !safe_fixture(&serde_json::to_value(&fixture).map_err(|_| ApiError::invalid())?)
    {
        return Err(ApiError::invalid());
    }
    let content = canonical(&fixture)?;
    let hash = digest(&content);
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let run = get_run(pool, id).await?;
    if run.mode != "record"
        || fixture.source_trace_id != run.trace_id
        || fixture.service_name != run.service_name
    {
        return Err(ApiError::conflict());
    }
    if let Some(old) =
        sqlx::query_scalar::<_, String>("SELECT canonical_hash FROM replay_fixtures WHERE run_id=?")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
    {
        if old != hash {
            return Err(ApiError::conflict());
        }
        return Ok(json!({"finalized":true,"deduplicated":true}));
    }
    let rows = sqlx::query("SELECT name,kind,parent_span_id,span_id FROM spans WHERE run_id=?")
        .bind(id)
        .fetch_all(&mut *tx)
        .await?;
    let roots = rows
        .iter()
        .filter(|r| r.get::<Option<String>, _>("parent_span_id").is_none())
        .count();
    let mut tools: Vec<String> = rows
        .iter()
        .filter(|r| r.get::<String, _>("kind") == "tool")
        .map(|r| r.get("name"))
        .collect();
    let mut expected: Vec<String> = fixture
        .calls
        .iter()
        .map(|c| c.boundary_name.clone())
        .collect();
    tools.sort();
    expected.sort();
    if roots != 1
        || tools != expected
        || rows.iter().any(|r| {
            r.get::<Option<String>, _>("parent_span_id")
                .is_some_and(|p| !rows.iter().any(|x| x.get::<String, _>("span_id") == p))
        })
    {
        return Err(ApiError::conflict());
    }
    sqlx::query("INSERT INTO replay_fixtures (run_id,canonical_json,canonical_hash) VALUES(?,?,?)")
        .bind(id)
        .bind(content)
        .bind(hash)
        .execute(&mut *tx)
        .await?;
    for c in fixture.calls {
        sqlx::query("INSERT INTO replay_calls (run_id,sequence,boundary_name,boundary_key,input_hash,outcome_json) VALUES(?,?,?,?,?,?)").bind(id).bind(c.sequence as i64).bind(c.boundary_name).bind(c.boundary_key).bind(c.input_hash).bind(canonical(&c.outcome)?).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(json!({"finalized":true,"deduplicated":false}))
}
