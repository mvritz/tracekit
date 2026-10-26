pub mod error;
pub mod models;
pub mod storage;
use axum::{
    body::Body,
    extract::{rejection::JsonRejection, DefaultBodyLimit, Path, Query, State},
    http::{header, Method, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use error::ApiError;
use models::{Batch, Fixture};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{QueryBuilder, Row, Sqlite, SqlitePool};
#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub origin: String,
}
pub fn router(pool: SqlitePool, origin: String) -> Router {
    let state = AppState { pool, origin };
    Router::new()
        .route("/healthz", get(health))
        .route("/v1/meta", get(meta))
        .route("/v1/ingest/spans", post(ingest))
        .route("/v1/traces", get(list))
        .route("/v1/traces/{id}", get(detail))
        .route("/v1/traces/{id}/spans", get(spans))
        .route("/v1/runs/{id}", get(run))
        .route("/v1/runs/{id}/replay-fixture", get(export).post(import))
        .fallback(|| async { ApiError::missing() })
        .layer(DefaultBodyLimit::max(1048576))
        .layer(middleware::from_fn_with_state(state.clone(), guard))
        .with_state(state)
}
async fn guard(State(state): State<AppState>, request: Request<Body>, next: Next) -> Response {
    if let Some(host) = request.headers().get(header::HOST) {
        let h = host.to_str().unwrap_or("");
        if !["localhost", "127.0.0.1", "[::1]"].iter().any(|allowed| {
            h == *allowed
                || h.strip_prefix(allowed)
                    .is_some_and(|s| s.starts_with(':') && s[1..].parse::<u16>().is_ok())
        }) {
            return ApiError(
                StatusCode::FORBIDDEN,
                "forbidden_host",
                "Collector accepts loopback hosts only",
            )
            .into_response();
        }
    }
    let origin = request.headers().get(header::ORIGIN).cloned();
    if origin
        .as_ref()
        .is_some_and(|o| o.to_str().ok() != Some(state.origin.as_str()))
    {
        return ApiError(
            StatusCode::FORBIDDEN,
            "forbidden_origin",
            "Origin is not allowed",
        )
        .into_response();
    }
    if request.method() == Method::POST
        && request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_none_or(|s| s.split(';').next() != Some("application/json"))
    {
        return ApiError(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media_type",
            "Use application/json",
        )
        .into_response();
    }
    let started = std::time::Instant::now();
    let route = request
        .extensions()
        .get::<axum::extract::MatchedPath>()
        .map(|m| m.as_str().to_owned())
        .unwrap_or_else(|| "unmatched".into());
    let method = match *request.method() {
        Method::GET => "GET",
        Method::POST => "POST",
        Method::OPTIONS => "OPTIONS",
        _ => "OTHER",
    };
    let mut response = if request.method() == Method::OPTIONS {
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(request).await
    };
    if let Some(origin) = origin {
        response
            .headers_mut()
            .insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin);
        response
            .headers_mut()
            .insert(header::VARY, header::HeaderValue::from_static("Origin"));
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            header::HeaderValue::from_static("GET, POST, OPTIONS"),
        );
        response.headers_mut().insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            header::HeaderValue::from_static("content-type"),
        );
    }
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    let request_id = response
        .headers()
        .get("x-request-id")
        .cloned()
        .unwrap_or_else(|| {
            header::HeaderValue::from_str(&uuid::Uuid::new_v4().to_string())
                .expect("UUID is a valid header")
        });
    tracing::debug!(request_id=?request_id,route,method,status=response.status().as_u16(),duration_ms=started.elapsed().as_millis(),"collector request");
    response.headers_mut().insert("x-request-id", request_id);
    response
}
fn body_error(e: JsonRejection) -> ApiError {
    if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
        ApiError(
            StatusCode::PAYLOAD_TOO_LARGE,
            "payload_too_large",
            "Request exceeds 1 MiB",
        )
    } else {
        ApiError::invalid()
    }
}
async fn meta(State(s): State<AppState>) -> Result<Json<Value>, ApiError> {
    let count: i64 = sqlx::query_scalar("PRAGMA page_count")
        .fetch_one(&s.pool)
        .await?;
    let size: i64 = sqlx::query_scalar("PRAGMA page_size")
        .fetch_one(&s.pool)
        .await?;
    Ok(Json(
        json!({"version":"0.1.0","schema_versions":[1],"max_spans_per_trace":10000,"replay":"sequential-strict","database_logical_bytes":count*size,"retention":"manual"}),
    ))
}
async fn health(State(s): State<AppState>) -> Result<Json<Value>, ApiError> {
    sqlx::query("SELECT 1").execute(&s.pool).await?;
    Ok(Json(json!({"status":"ok"})))
}
async fn ingest(
    State(s): State<AppState>,
    body: Result<Json<Batch>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        storage::ingest(&s.pool, body.map_err(body_error)?.0).await?,
    ))
}
async fn run(State(s): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        serde_json::to_value(storage::get_run(&s.pool, &id).await?)
            .map_err(|_| ApiError::invalid())?,
    ))
}
async fn export(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let content = sqlx::query_scalar::<_, String>(
        "SELECT canonical_json FROM replay_fixtures WHERE run_id=?",
    )
    .bind(id)
    .fetch_optional(&s.pool)
    .await?
    .ok_or_else(ApiError::missing)?;
    Ok(Json(
        serde_json::from_str(&content).map_err(|_| ApiError::invalid())?,
    ))
}
async fn import(
    State(s): State<AppState>,
    Path(id): Path<String>,
    body: Result<Json<Fixture>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        storage::finalize(&s.pool, &id, body.map_err(body_error)?.0).await?,
    ))
}
async fn spans(State(s): State<AppState>, Path(id): Path<String>) -> Result<Response, ApiError> {
    if !models::id(&id, 32) {
        return Err(ApiError::invalid());
    }
    let rows=sqlx::query_scalar::<_,String>("SELECT canonical_json FROM spans WHERE trace_id=? ORDER BY start_time_ms,span_id LIMIT 10000").bind(id).fetch_all(&s.pool).await?;
    if rows.is_empty() {
        return Err(ApiError::missing());
    }
    // Validate the stored JSON without building and reserializing thousands of object trees.
    // RawValue's serializer copies the validated JSON into the response unchanged.
    #[derive(serde::Serialize)]
    struct SpanPage<'a> {
        items: Vec<&'a serde_json::value::RawValue>,
        truncated: bool,
    }
    let items = rows
        .iter()
        .map(|v| serde_json::from_str::<&serde_json::value::RawValue>(v))
        .collect::<Result<_, _>>()
        .map_err(|_| ApiError::invalid())?;
    Ok(Json(SpanPage {
        items,
        truncated: false,
    })
    .into_response())
}
const SUMMARY:&str="SELECT r.*, COALESCE((SELECT name FROM spans WHERE trace_id=r.trace_id AND parent_span_id IS NULL), (SELECT name FROM spans WHERE trace_id=r.trace_id ORDER BY start_time_ms,span_id LIMIT 1)) AS name, (SELECT COUNT(*) FROM spans WHERE trace_id=r.trace_id) AS span_count, (SELECT COUNT(*) FROM spans WHERE trace_id=r.trace_id AND status='error') AS error_count, (SELECT COUNT(*) FROM spans WHERE trace_id=r.trace_id AND status='cancelled') AS cancelled_count, (SELECT COUNT(*) FROM spans WHERE trace_id=r.trace_id AND parent_span_id IS NULL) AS root_count, (SELECT MAX(end_time_ms) FROM spans WHERE trace_id=r.trace_id) AS end_time_ms, COALESCE((SELECT duration_ns FROM spans WHERE trace_id=r.trace_id AND parent_span_id IS NULL), ((SELECT MAX(end_time_ms) FROM spans WHERE trace_id=r.trace_id)-r.started_at_ms)*1000000) AS duration_ns FROM runs r";
fn summary(row: &sqlx::sqlite::SqliteRow) -> Value {
    let errors: i64 = row.get("error_count");
    let cancelled: i64 = row.get("cancelled_count");
    json!({"run_id":row.get::<String,_>("run_id"),"trace_id":row.get::<String,_>("trace_id"),"service_name":row.get::<String,_>("service_name"),"mode":row.get::<String,_>("mode"),"replay_of_run_id":row.get::<Option<String>,_>("replay_of_run_id"),"name":row.get::<String,_>("name"),"start_time_unix_ms":row.get::<i64,_>("started_at_ms"),"end_time_unix_ms":row.get::<i64,_>("end_time_ms"),"duration_ns":row.get::<i64,_>("duration_ns"),"span_count":row.get::<i64,_>("span_count"),"error_count":errors,"status":if errors>0{"error"}else if cancelled>0{"cancelled"}else{"ok"},"complete":row.get::<i64,_>("root_count")==1})
}
async fn detail(
    State(s): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    if !models::id(&id, 32) {
        return Err(ApiError::invalid());
    }
    let row = sqlx::query(&format!("{SUMMARY} WHERE r.trace_id=?"))
        .bind(id)
        .fetch_optional(&s.pool)
        .await?
        .ok_or_else(ApiError::missing)?;
    Ok(Json(summary(&row)))
}
#[derive(Default, Deserialize)]
#[serde(deny_unknown_fields)]
struct Filters {
    limit: Option<u32>,
    cursor: Option<String>,
    service_name: Option<String>,
    status: Option<String>,
    mode: Option<String>,
    from: Option<i64>,
    to: Option<i64>,
    q: Option<String>,
}
async fn list(
    State(s): State<AppState>,
    filters: Result<Query<Filters>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let f = filters.map_err(|_| ApiError::invalid())?.0;
    let limit = f.limit.unwrap_or(25);
    if !(1..=100).contains(&limit)
        || f.status
            .as_ref()
            .is_some_and(|v| !["ok", "error", "cancelled"].contains(&v.as_str()))
        || f.mode
            .as_ref()
            .is_some_and(|v| !["record", "replay"].contains(&v.as_str()))
        || f.q.as_ref().is_some_and(|v| v.len() > 200)
        || f.service_name.as_ref().is_some_and(|v| v.len() > 100)
        || f.from.is_some_and(|v| v < 0)
        || f.to.is_some_and(|v| v < 0)
        || f.from.zip(f.to).is_some_and(|(a, b)| a > b)
    {
        return Err(ApiError::invalid());
    }
    let cursor: Option<(i64, String, String)> = match f.cursor {
        Some(c) if c.len() <= 256 => {
            let b = URL_SAFE_NO_PAD.decode(c).map_err(|_| ApiError::invalid())?;
            let v: (i64, String, String) =
                serde_json::from_slice(&b).map_err(|_| ApiError::invalid())?;
            if v.0 < 0 || !models::id(&v.1, 32) || uuid::Uuid::parse_str(&v.2).is_err() {
                return Err(ApiError::invalid());
            }
            Some(v)
        }
        Some(_) => return Err(ApiError::invalid()),
        None => None,
    };
    let mut query = QueryBuilder::<Sqlite>::new(format!("SELECT * FROM ({SUMMARY}) WHERE 1=1"));
    if let Some(v) = f.service_name {
        query.push(" AND service_name=").push_bind(v);
    }
    if let Some(v) = f.mode {
        query.push(" AND mode=").push_bind(v);
    }
    if let Some(v) = f.status {
        query.push(match v.as_str() {
            "error" => " AND error_count>0",
            "cancelled" => " AND error_count=0 AND cancelled_count>0",
            _ => " AND error_count=0 AND cancelled_count=0",
        });
    }
    if let Some(v) = f.from {
        query.push(" AND started_at_ms>=").push_bind(v);
    }
    if let Some(v) = f.to {
        query.push(" AND started_at_ms<=").push_bind(v);
    }
    if let Some(v) = f.q {
        query
            .push(" AND (instr(lower(name),lower(")
            .push_bind(v.clone())
            .push("))>0 OR instr(trace_id,")
            .push_bind(v)
            .push(")>0)");
    }
    if let Some((time, trace, run)) = cursor {
        query
            .push(" AND (started_at_ms,trace_id,run_id)<(")
            .push_bind(time)
            .push(",")
            .push_bind(trace)
            .push(",")
            .push_bind(run)
            .push(")");
    }
    query
        .push(" ORDER BY started_at_ms DESC,trace_id DESC,run_id DESC LIMIT ")
        .push_bind(i64::from(limit) + 1);
    let mut rows = query.build().fetch_all(&s.pool).await?;
    let more = rows.len() > limit as usize;
    rows.truncate(limit as usize);
    let next = if more {
        rows.last().map(|r| {
            URL_SAFE_NO_PAD.encode(
                serde_json::to_vec(&(
                    r.get::<i64, _>("started_at_ms"),
                    r.get::<String, _>("trace_id"),
                    r.get::<String, _>("run_id"),
                ))
                .unwrap_or_default(),
            )
        })
    } else {
        None
    };
    Ok(Json(
        json!({"items":rows.iter().map(summary).collect::<Vec<_>>(),"next_cursor":next}),
    ))
}
