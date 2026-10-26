use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
pub struct ApiError(pub StatusCode, pub &'static str, pub &'static str);
impl ApiError {
    pub fn invalid() -> Self {
        Self(
            StatusCode::BAD_REQUEST,
            "validation_error",
            "Request does not match the version 1 protocol",
        )
    }
    pub fn conflict() -> Self {
        Self(
            StatusCode::CONFLICT,
            "conflict",
            "Immutable span or run metadata conflicts with stored data",
        )
    }
    pub fn missing() -> Self {
        Self(
            StatusCode::NOT_FOUND,
            "not_found",
            "Requested resource is not available",
        )
    }
}
impl From<sqlx::Error> for ApiError {
    fn from(_: sqlx::Error) -> Self {
        Self(
            StatusCode::SERVICE_UNAVAILABLE,
            "storage_unavailable",
            "Local storage is unavailable; retry later",
        )
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let id = uuid::Uuid::new_v4().to_string();
        (
            self.0,
            [("x-request-id", id.clone())],
            Json(json!({"error":{"code":self.1,"message":self.2,"request_id":id}})),
        )
            .into_response()
    }
}
