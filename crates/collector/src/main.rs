use std::{
    net::{IpAddr, SocketAddr},
    path::PathBuf,
};
use tracekit_collector::{router, storage};
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("TRACEKIT_LOG_LEVEL").unwrap_or_else(|_| "info".into()))
        .init();
    let host: IpAddr = std::env::var("TRACEKIT_SERVER_HOST")
        .unwrap_or_else(|_| "127.0.0.1".into())
        .parse()?;
    if !host.is_loopback() {
        return Err("Only loopback addresses are supported in v0.1".into());
    }
    let port: u16 = std::env::var("TRACEKIT_SERVER_PORT")
        .unwrap_or_else(|_| "4319".into())
        .parse()?;
    let path = PathBuf::from(
        std::env::var("TRACEKIT_DB_PATH").unwrap_or_else(|_| ".tracekit/tracekit.db".into()),
    );
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            tokio::fs::create_dir_all(parent).await?;
        }
    }
    let pool = storage::connect(&path).await?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    }
    let origin =
        std::env::var("TRACEKIT_ALLOWED_ORIGIN").unwrap_or_else(|_| "http://127.0.0.1:3000".into());
    if !["http://127.0.0.1:", "http://localhost:"].iter().any(|p| {
        origin
            .strip_prefix(p)
            .is_some_and(|s| s.parse::<u16>().is_ok())
    }) {
        return Err(
            "Dashboard origin must use a loopback HTTP origin with an explicit port".into(),
        );
    }
    let listener = tokio::net::TcpListener::bind(SocketAddr::new(host, port)).await?;
    tracing::info!(address=%listener.local_addr()?,"TraceKit collector ready");
    axum::serve(listener, router(pool.clone(), origin))
        .with_graceful_shutdown(shutdown())
        .await?;
    pool.close().await;
    Ok(())
}
async fn shutdown() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            signal.recv().await;
        } else {
            std::future::pending::<()>().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {_=ctrl_c=>{},_=terminate=>{}}
}
