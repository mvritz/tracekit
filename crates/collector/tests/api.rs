use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tempfile::TempDir;
use tower::ServiceExt;
use tracekit_collector::{models::Batch, router, storage};
struct App {
    router: Router,
    _dir: TempDir,
}
async fn app() -> App {
    let dir = TempDir::new().unwrap();
    let pool = storage::connect(&dir.path().join("test.db")).await.unwrap();
    App {
        router: router(pool, "http://127.0.0.1:3000".into()),
        _dir: dir,
    }
}
fn batch() -> Value {
    serde_json::from_str(include_str!(
        "../../../packages/protocol/src/fixtures/valid-batch.json"
    ))
    .unwrap()
}
async fn request(
    app: &Router,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(path);
    let body = if let Some(v) = body {
        req = req.header("content-type", "application/json");
        Body::from(serde_json::to_vec(&v).unwrap())
    } else {
        Body::empty()
    };
    let res = app.clone().oneshot(req.body(body).unwrap()).await.unwrap();
    let status = res.status();
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
#[test]
fn golden_contracts() {
    let cases: Vec<Value> = serde_json::from_str(include_str!(
        "../../../packages/protocol/src/fixtures/batches.json"
    ))
    .unwrap();
    for c in cases {
        let parsed = serde_json::from_value::<Batch>(c["batch"].clone());
        let valid = parsed.as_ref().is_ok_and(Batch::valid);
        assert_eq!(valid, c["valid"].as_bool().unwrap(), "{}", c["name"]);
        if valid {
            assert_eq!(serde_json::to_value(parsed.unwrap()).unwrap(), c["batch"]);
        }
    }
}
#[tokio::test]
async fn atomic_dedup_and_conflict() {
    let a = app().await;
    let b = batch();
    assert_eq!(
        request(&a.router, "POST", "/v1/ingest/spans", Some(b.clone()))
            .await
            .1["accepted"],
        1
    );
    assert_eq!(
        request(&a.router, "POST", "/v1/ingest/spans", Some(b.clone()))
            .await
            .1["deduplicated"],
        1
    );
    let mut conflict = b.clone();
    conflict["spans"][0]["name"] = json!("changed");
    let mut new = b["spans"][0].clone();
    new["span_id"] = json!("4444444444444444");
    new["parent_span_id"] = b["spans"][0]["span_id"].clone();
    conflict["spans"].as_array_mut().unwrap().insert(0, new);
    assert_eq!(
        request(&a.router, "POST", "/v1/ingest/spans", Some(conflict))
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        request(
            &a.router,
            "GET",
            "/v1/traces/11111111111111111111111111111111/spans",
            None
        )
        .await
        .1["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}
#[tokio::test]
async fn child_first_and_error_summary() {
    let a = app().await;
    let mut b = batch();
    b["spans"][0]["parent_span_id"] = json!("3333333333333333");
    b["spans"][0]["status"] = json!("error");
    assert_eq!(
        request(&a.router, "POST", "/v1/ingest/spans", Some(b))
            .await
            .0,
        StatusCode::OK
    );
    let mut root = batch();
    root["spans"][0]["span_id"] = json!("3333333333333333");
    root["spans"][0]["start_time_unix_ms"] = json!(1779999999990u64);
    assert_eq!(
        request(&a.router, "POST", "/v1/ingest/spans", Some(root))
            .await
            .0,
        StatusCode::OK
    );
    let (_, page) = request(&a.router, "GET", "/v1/traces", None).await;
    assert_eq!(page["items"][0]["status"], "error");
    assert_eq!(page["items"][0]["span_count"], 2);
    assert_eq!(page["items"][0]["start_time_unix_ms"], 1779999999990u64);
}
#[tokio::test]
async fn rejects_cycles_and_run_inconsistency() {
    let a = app().await;
    let mut b = batch();
    b["spans"][0]["parent_span_id"] = json!("3333333333333333");
    assert_eq!(
        request(&a.router, "POST", "/v1/ingest/spans", Some(b.clone()))
            .await
            .0,
        StatusCode::OK
    );
    let mut cycle = b.clone();
    cycle["spans"][0]["span_id"] = json!("3333333333333333");
    cycle["spans"][0]["parent_span_id"] = json!("2222222222222222");
    assert_eq!(
        request(&a.router, "POST", "/v1/ingest/spans", Some(cycle))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    b["run"]["mode"] = json!("replay");
    b["run"]["replay_of_run_id"] = json!("22222222-2222-4222-8222-222222222222");
    assert_eq!(
        request(&a.router, "POST", "/v1/ingest/spans", Some(b))
            .await
            .0,
        StatusCode::CONFLICT
    );
}
#[tokio::test]
async fn pagination_and_filters() {
    let a = app().await;
    for i in 1..=4 {
        let mut b = batch();
        let trace = format!("{i:032x}");
        let run = uuid::Uuid::new_v4().to_string();
        b["run"]["trace_id"] = json!(trace);
        b["run"]["run_id"] = json!(run);
        b["spans"][0]["trace_id"] = b["run"]["trace_id"].clone();
        b["spans"][0]["run_id"] = b["run"]["run_id"].clone();
        assert_eq!(
            request(&a.router, "POST", "/v1/ingest/spans", Some(b))
                .await
                .0,
            StatusCode::OK
        );
    }
    let (_, first) = request(&a.router, "GET", "/v1/traces?limit=2", None).await;
    assert_eq!(first["items"].as_array().unwrap().len(), 2);
    let cursor = first["next_cursor"].as_str().unwrap();
    let (_, second) = request(
        &a.router,
        "GET",
        &format!("/v1/traces?limit=2&cursor={cursor}"),
        None,
    )
    .await;
    assert_ne!(
        first["items"][0]["trace_id"],
        second["items"][0]["trace_id"]
    );
    assert!(second["next_cursor"].is_null());
    assert_eq!(
        request(&a.router, "GET", "/v1/traces?status=error", None)
            .await
            .1["items"],
        json!([])
    );
    assert_eq!(
        request(&a.router, "GET", "/v1/traces?q=golden", None)
            .await
            .1["items"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
    for path in [
        "/v1/traces?cursor=bad",
        "/v1/traces?limit=101",
        "/v1/traces?mode=unsafe",
        "/v1/traces?from=-1",
    ] {
        assert_eq!(
            request(&a.router, "GET", path, None).await.0,
            StatusCode::BAD_REQUEST
        );
    }
}
#[tokio::test]
async fn concurrent_writes() {
    let a = app().await;
    let mut handles = Vec::new();
    for _ in 0..10 {
        let router = a.router.clone();
        handles.push(tokio::spawn(async move {
            request(&router, "POST", "/v1/ingest/spans", Some(batch()))
                .await
                .0
        }));
    }
    for h in handles {
        assert_eq!(h.await.unwrap(), StatusCode::OK);
    }
    assert_eq!(
        request(&a.router, "GET", "/v1/traces", None).await.1["items"][0]["span_count"],
        1
    );
}
#[tokio::test]
async fn malformed_atomic_and_safe_errors() {
    let a = app().await;
    let mut b = batch();
    let mut bad = b["spans"][0].clone();
    bad["span_id"] = json!("secret-DO-NOT-ECHO");
    b["spans"].as_array_mut().unwrap().push(bad);
    let (status, error) = request(&a.router, "POST", "/v1/ingest/spans", Some(b)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!error.to_string().contains("DO-NOT-ECHO"));
    assert_eq!(
        request(&a.router, "GET", "/v1/traces", None).await.1["items"],
        json!([])
    );
    let req = Request::builder()
        .method("POST")
        .uri("/v1/ingest/spans")
        .header("content-type", "application/json")
        .body(Body::from("x".repeat(1048577)))
        .unwrap();
    assert_eq!(
        a.router.clone().oneshot(req).await.unwrap().status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
}
#[tokio::test]
async fn cors_and_host_guards() {
    let a = app().await;
    for (header, value) in [
        ("origin", "https://malicious.example"),
        ("host", "evil.example:4319"),
    ] {
        let req = Request::builder()
            .uri("/healthz")
            .header(header, value)
            .body(Body::empty())
            .unwrap();
        assert_eq!(
            a.router.clone().oneshot(req).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }
    let req = Request::builder()
        .method("OPTIONS")
        .uri("/v1/ingest/spans")
        .header("origin", "http://127.0.0.1:3000")
        .body(Body::empty())
        .unwrap();
    let res = a.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        res.headers()["access-control-allow-origin"],
        "http://127.0.0.1:3000"
    );
    assert_eq!(
        request(&a.router, "POST", "/v1/ingest/spans", None).await.0,
        StatusCode::UNSUPPORTED_MEDIA_TYPE
    );
}
#[tokio::test]
async fn finalized_fixture_export_and_immutability() {
    let a = app().await;
    let run = "11111111-1111-4111-8111-111111111111";
    let path = format!("/v1/runs/{run}/replay-fixture");
    request(&a.router, "POST", "/v1/ingest/spans", Some(batch())).await;
    let f = json!({"fixture_version":1,"source_run_id":run,"source_trace_id":"11111111111111111111111111111111","service_name":"contract","created_at_unix_ms":1780000000002u64,"capture_policy":"explicit-opt-in-sanitized","finalized":true,"calls":[]});
    assert_eq!(
        request(&a.router, "POST", &path, Some(f.clone())).await.0,
        StatusCode::OK
    );
    assert_eq!(request(&a.router, "GET", &path, None).await.1, f);
    assert_eq!(
        request(&a.router, "POST", &path, Some(f.clone())).await.1["deduplicated"],
        true
    );
    let mut added = batch();
    added["spans"][0]["span_id"] = json!("5555555555555555");
    added["spans"][0]["parent_span_id"] = json!("2222222222222222");
    assert_eq!(
        request(&a.router, "POST", "/v1/ingest/spans", Some(added))
            .await
            .0,
        StatusCode::CONFLICT
    );
    let mut unsafe_fixture = f;
    unsafe_fixture["capture_policy"] = json!("raw");
    assert_eq!(
        request(&a.router, "POST", &path, Some(unsafe_fixture))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn span_read_preserves_json_values_and_rejects_corruption() {
    let a = app().await;
    let mut b = batch();
    b["spans"][0]["payload"] = json!({"input": null, "output": {"text": "</script>\"\n🌲", "literal": "[undefined]"}, "output_state": "value"});
    assert_eq!(
        request(&a.router, "POST", "/v1/ingest/spans", Some(b.clone()))
            .await
            .0,
        StatusCode::OK
    );
    let path = "/v1/traces/11111111111111111111111111111111/spans";
    let res = a
        .router
        .clone()
        .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers()["content-type"], "application/json");
    assert_eq!(res.headers()["cache-control"], "no-store");
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    let page: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(page["items"][0], b["spans"][0]);
    assert_eq!(page["truncated"], false);
    let pool = storage::connect(&a._dir.path().join("test.db"))
        .await
        .unwrap();
    sqlx::query("UPDATE spans SET canonical_json='invalid-private-marker'")
        .execute(&pool)
        .await
        .unwrap();
    let (status, error) = request(&a.router, "GET", path, None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(!error.to_string().contains("invalid-private-marker"));
}
