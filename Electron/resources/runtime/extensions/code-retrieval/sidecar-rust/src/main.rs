//! Tantivy exact-index sidecar (spec D2 / D6 / D8).
//!
//! Compatible with the existing Node query-sidecar HTTP surface:
//!   GET  /health
//!   POST /attach
//!   POST /heartbeat
//!   POST /detach
//!   POST /search
//! plus index management:
//!   POST /v1/index/open
//!   POST /v1/index/update
//!   POST /v1/index/delete
//!   POST /v1/index/commit
//!
//! Discovery file: {project}/.pi/agent/code-retrieval/sidecar.json

mod engine;
mod git;
mod util;
mod watch;

use engine::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use util::{now_ms, random_token, retrieval_home, sidecar_json_path};

static SNAPSHOT_PATH: OnceLock<PathBuf> = OnceLock::new();

#[derive(Clone, Copy, Debug)]
struct SessionLease {
    last_seen_at: u64,
    expires_at: u64,
}

struct Shared {
    project_root: PathBuf,
    token: String,
    idle_ms: u64,
    session_ttl_ms: u64,
    port: AtomicU16,
    last_used: AtomicU64,
    ready: AtomicBool,
    sessions: Mutex<HashMap<String, SessionLease>>,
    engine: Arc<Mutex<Engine>>,
    shutting_down: AtomicBool,
}

#[derive(Debug, Deserialize, Default)]
struct AttachBody {
    #[serde(rename = "sessionId")]
    session_id: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct SearchBody {
    query: Option<String>,
    path: Option<String>,
    glob: Option<String>,
    #[serde(rename = "topK")]
    top_k: Option<usize>,
    #[serde(rename = "excludeGlobs")]
    exclude_globs: Option<Vec<String>>,
}

#[derive(Debug, Deserialize, Default)]
struct IndexOpenBody {
    #[serde(rename = "forceRebuild")]
    force_rebuild: Option<bool>,
}

#[derive(Debug, Deserialize, Default)]
struct IndexUpdateBody {
    path: Option<String>,
    content: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct IndexDeleteBody {
    path: Option<String>,
}

fn main() {
    let project_root = PathBuf::from(
        std::env::var("PIPIUI_CODE_RETRIEVAL_PROJECT").unwrap_or_else(|_| {
            std::env::current_dir()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|_| ".".into())
        }),
    );
    let idle_ms = parse_positive_ms(std::env::var("PIPIUI_CODE_RETRIEVAL_IDLE_MS").ok(), 60_000);
    let session_ttl_ms =
        parse_positive_ms(std::env::var("PIPIUI_CODE_RETRIEVAL_SESSION_TTL_MS").ok(), 300_000);
    let token = std::env::var("PIPIUI_CODE_RETRIEVAL_TOKEN").unwrap_or_else(|_| random_token());

    let _ = std::fs::create_dir_all(retrieval_home(&project_root));

    let listener = TcpListener::bind("127.0.0.1:0").expect("listen 127.0.0.1:0");
    let port = listener.local_addr().expect("local_addr").port();

    let engine = Arc::new(Mutex::new(Engine::new(project_root.clone())));
    let shared = Arc::new(Shared {
        project_root: project_root.clone(),
        token: token.clone(),
        idle_ms,
        session_ttl_ms,
        port: AtomicU16::new(port),
        last_used: AtomicU64::new(now_ms()),
        ready: AtomicBool::new(false),
        sessions: Mutex::new(HashMap::new()),
        engine: Arc::clone(&engine),
        shutting_down: AtomicBool::new(false),
    });

    let _ = SNAPSHOT_PATH.set(sidecar_json_path(&project_root));
    write_snapshot(&shared);
    let boot = json!({
        "ok": true,
        "pid": std::process::id(),
        "port": port,
        "token": token,
        "provider": "tantivy",
    });
    println!("{boot}");
    let _ = std::io::stdout().flush();
    install_unix_signals();

    {
        let shared = Arc::clone(&shared);
        let engine = Arc::clone(&engine);
        let root = project_root.clone();
        std::thread::Builder::new()
            .name("tantivy-index".into())
            .spawn(move || {
                let result = {
                    let mut eng = lock_engine(&engine);
                    eng.open_or_build()
                };
                match result {
                    Ok(()) => {
                        shared.ready.store(true, Ordering::SeqCst);
                        if let Err(err) = watch::spawn_watcher(root, engine) {
                            eprintln!("tantivy-sidecar watcher failed: {err}");
                        }
                    }
                    Err(err) => eprintln!("tantivy-sidecar index open failed: {err}"),
                }
            })
            .expect("index thread");
    }

    {
        let shared = Arc::clone(&shared);
        std::thread::Builder::new()
            .name("tantivy-idle".into())
            .spawn(move || idle_loop(shared))
            .ok();
    }

    for incoming in listener.incoming() {
        if shared.shutting_down.load(Ordering::SeqCst) {
            break;
        }
        let Ok(stream) = incoming else { continue };
        let shared = Arc::clone(&shared);
        std::thread::spawn(move || {
            if let Err(err) = handle_client(stream, &shared) {
                eprintln!("tantivy-sidecar request error: {err}");
            }
        });
    }
}

fn lock_engine(engine: &Mutex<Engine>) -> std::sync::MutexGuard<'_, Engine> {
    match engine.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    }
}

fn parse_positive_ms(raw: Option<String>, default_ms: u64) -> u64 {
    raw.and_then(|s| s.parse::<u64>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(default_ms)
        .max(50)
}

fn renew_lease(
    sessions: &mut HashMap<String, SessionLease>,
    session_id: String,
    now: u64,
    ttl_ms: u64,
) -> SessionLease {
    let lease = SessionLease {
        last_seen_at: now,
        expires_at: now.saturating_add(ttl_ms),
    };
    sessions.insert(session_id, lease);
    lease
}

/// Renew an existing session only. Unknown / detached ids must not upsert.
fn touch_lease(
    sessions: &mut HashMap<String, SessionLease>,
    session_id: &str,
    now: u64,
    ttl_ms: u64,
) -> Option<SessionLease> {
    let lease = sessions.get_mut(session_id)?;
    lease.last_seen_at = now;
    lease.expires_at = now.saturating_add(ttl_ms);
    Some(*lease)
}

fn expire_sessions(sessions: &mut HashMap<String, SessionLease>, now: u64) {
    sessions.retain(|_, lease| lease.expires_at > now);
}

fn lock_sessions(shared: &Shared) -> std::sync::MutexGuard<'_, HashMap<String, SessionLease>> {
    match shared.sessions.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    }
}

fn live_session_payload(sessions: &HashMap<String, SessionLease>) -> Vec<Value> {
    sessions
        .iter()
        .map(|(session_id, lease)| {
            json!({
                "sessionId": session_id,
                "lastSeenAt": lease.last_seen_at,
                "expiresAt": lease.expires_at,
            })
        })
        .collect()
}

fn oldest_expires_at(sessions: &HashMap<String, SessionLease>) -> Option<u64> {
    sessions.values().map(|lease| lease.expires_at).min()
}

fn idle_loop(shared: Arc<Shared>) {
    let slice = shared.idle_ms.min(250).max(40);
    loop {
        std::thread::sleep(Duration::from_millis(slice));
        if shared.shutting_down.load(Ordering::SeqCst) {
            return;
        }
        let refs = {
            let mut sessions = lock_sessions(&shared);
            expire_sessions(&mut sessions, now_ms());
            sessions.len()
        };
        if refs > 0 {
            continue;
        }
        let last = shared.last_used.load(Ordering::SeqCst);
        if now_ms().saturating_sub(last) >= shared.idle_ms {
            shutdown(&shared);
            std::process::exit(0);
        }
    }
}

fn install_unix_signals() {
    #[cfg(unix)]
    unsafe {
        extern "C" fn on_signal(_: i32) {
            if let Some(path) = SNAPSHOT_PATH.get() {
                let _ = std::fs::remove_file(path);
            }
            std::process::exit(0);
        }
        extern "C" {
            fn signal(sig: i32, handler: extern "C" fn(i32)) -> extern "C" fn(i32);
        }
        let _ = signal(15, on_signal); // SIGTERM
        let _ = signal(2, on_signal); // SIGINT
    }
}

fn shutdown(shared: &Shared) {
    if shared
        .shutting_down
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    invalidate_snapshot();
}

fn write_snapshot(shared: &Shared) {
    let dest = sidecar_json_path(&shared.project_root);
    if let Some(dir) = dest.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = dest.with_extension(format!("json.{}.tmp", std::process::id()));
    let body = json!({
        "pid": std::process::id(),
        "port": shared.port.load(Ordering::SeqCst),
        "token": shared.token,
        "startedAt": now_ms(),
    });
    if std::fs::write(&tmp, body.to_string()).is_ok() {
        if std::fs::rename(&tmp, &dest).is_err() {
            let _ = std::fs::copy(&tmp, &dest);
            let _ = std::fs::remove_file(&tmp);
        }
    }
}

fn invalidate_snapshot() {
    if let Some(dest) = SNAPSHOT_PATH.get() {
        let _ = std::fs::remove_file(dest);
    }
}

fn touch(shared: &Shared) {
    shared.last_used.store(now_ms(), Ordering::SeqCst);
}

fn authorized(shared: &Shared, headers: &[(String, String)]) -> bool {
    let mut presented = String::new();
    for (k, v) in headers {
        if k.eq_ignore_ascii_case("authorization")
            && v.len() > 7
            && v[..7].eq_ignore_ascii_case("Bearer ")
        {
            presented = v[7..].trim().to_string();
        }
        if k.eq_ignore_ascii_case("x-pipiui-token") {
            presented = v.trim().to_string();
        }
    }
    if presented.len() != shared.token.len() {
        return false;
    }
    presented
        .as_bytes()
        .iter()
        .zip(shared.token.as_bytes())
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

fn handle_client(mut stream: TcpStream, shared: &Shared) -> Result<(), String> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(15)));
    let req = read_http(&mut stream)?;
    if !authorized(shared, &req.headers) {
        return write_json(
            &mut stream,
            401,
            json!({"ok": false, "error": "unauthorized"}),
        );
    }
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/health") => {
            touch(shared);
            let now = now_ms();
            let (refs, sessions, oldest) = {
                let mut sessions = lock_sessions(shared);
                expire_sessions(&mut sessions, now);
                let payload = live_session_payload(&sessions);
                let oldest = oldest_expires_at(&sessions);
                (sessions.len(), payload, oldest)
            };
            let (head, baseline, overlay, ready) = {
                let eng = lock_engine(&shared.engine);
                (eng.head.clone(), eng.baseline_docs, eng.overlay_docs, eng.ready)
            };
            shared.ready.store(ready, Ordering::SeqCst);
            write_json(
                &mut stream,
                200,
                json!({
                    "ok": true,
                    "ready": ready,
                    "pid": std::process::id(),
                    "port": shared.port.load(Ordering::SeqCst),
                    "refcount": refs,
                    "lastUsed": shared.last_used.load(Ordering::SeqCst),
                    "sessionTtlMs": shared.session_ttl_ms,
                    "oldestExpiresAt": oldest,
                    "sessions": sessions,
                    "provider": "tantivy",
                    "head": head,
                    "baselineDocs": baseline,
                    "overlayDocs": overlay,
                }),
            )
        }
        ("POST", "/attach") => {
            let body: AttachBody = serde_json::from_str(&req.body).unwrap_or_default();
            let session_id = body
                .session_id
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| format!("anon-{}", now_ms()));
            let now = now_ms();
            let (refs, lease) = {
                let mut sessions = lock_sessions(shared);
                expire_sessions(&mut sessions, now);
                let lease = renew_lease(
                    &mut sessions,
                    session_id.clone(),
                    now,
                    shared.session_ttl_ms,
                );
                (sessions.len(), lease)
            };
            touch(shared);
            write_json(
                &mut stream,
                200,
                json!({
                    "ok": true,
                    "sessionId": session_id,
                    "refcount": refs,
                    "pid": std::process::id(),
                    "port": shared.port.load(Ordering::SeqCst),
                    "lastSeenAt": lease.last_seen_at,
                    "expiresAt": lease.expires_at,
                }),
            )
        }
        ("POST", "/heartbeat") => {
            let body: AttachBody = serde_json::from_str(&req.body).unwrap_or_default();
            let Some(session_id) = body.session_id.filter(|s| !s.is_empty()) else {
                return write_json(
                    &mut stream,
                    400,
                    json!({"ok": false, "error": "sessionId required"}),
                );
            };
            let now = now_ms();
            let renewed = {
                let mut sessions = lock_sessions(shared);
                expire_sessions(&mut sessions, now);
                touch_lease(
                    &mut sessions,
                    &session_id,
                    now,
                    shared.session_ttl_ms,
                )
                .map(|lease| (sessions.len(), lease))
            };
            let Some((refs, lease)) = renewed else {
                return write_json(
                    &mut stream,
                    404,
                    json!({"ok": false, "error": "session not found"}),
                );
            };
            touch(shared);
            write_json(
                &mut stream,
                200,
                json!({
                    "ok": true,
                    "sessionId": session_id,
                    "refcount": refs,
                    "pid": std::process::id(),
                    "port": shared.port.load(Ordering::SeqCst),
                    "lastSeenAt": lease.last_seen_at,
                    "expiresAt": lease.expires_at,
                }),
            )
        }
        ("POST", "/detach") => {
            let body: AttachBody = serde_json::from_str(&req.body).unwrap_or_default();
            let refs = {
                let mut sessions = lock_sessions(shared);
                expire_sessions(&mut sessions, now_ms());
                if let Some(id) = body.session_id {
                    sessions.remove(&id);
                }
                sessions.len()
            };
            touch(shared);
            write_json(
                &mut stream,
                200,
                json!({
                    "ok": true,
                    "refcount": refs,
                    "pid": std::process::id(),
                }),
            )
        }
        ("POST", "/search") => {
            let body: SearchBody = serde_json::from_str(&req.body).unwrap_or_default();
            let query = body.query.unwrap_or_default();
            if query.is_empty() {
                return write_json(
                    &mut stream,
                    400,
                    json!({"ok": false, "error": "query required"}),
                );
            }
            touch(shared);
            let eng = lock_engine(&shared.engine);
            if !eng.ready {
                return write_json(
                    &mut stream,
                    503,
                    json!({"ok": false, "error": "index not ready"}),
                );
            }
            let excludes = body.exclude_globs.unwrap_or_default();
            match eng.search(
                &query,
                body.path.as_deref(),
                body.glob.as_deref(),
                body.top_k,
                &excludes,
            ) {
                Ok(hits) => write_json(
                    &mut stream,
                    200,
                    json!({"ok": true, "hits": hits, "degraded": false}),
                ),
                Err(err) => write_json(&mut stream, 400, json!({"ok": false, "error": err})),
            }
        }
        ("POST", "/v1/index/open") => {
            let body: IndexOpenBody = serde_json::from_str(&req.body).unwrap_or_default();
            touch(shared);
            let mut eng = lock_engine(&shared.engine);
            if body.force_rebuild.unwrap_or(false) {
                let state = util::index_root(&shared.project_root).join("state.json");
                let _ = std::fs::remove_file(state);
            }
            match eng.open_or_build() {
                Ok(()) => {
                    shared.ready.store(true, Ordering::SeqCst);
                    write_json(
                        &mut stream,
                        200,
                        json!({
                            "ok": true,
                            "ready": true,
                            "baselineDocs": eng.baseline_docs,
                            "overlayDocs": eng.overlay_docs,
                            "head": eng.head,
                        }),
                    )
                }
                Err(err) => write_json(&mut stream, 500, json!({"ok": false, "error": err})),
            }
        }
        ("POST", "/v1/index/update") => {
            let body: IndexUpdateBody = serde_json::from_str(&req.body).unwrap_or_default();
            let Some(path) = body.path.filter(|p| !p.is_empty()) else {
                return write_json(
                    &mut stream,
                    400,
                    json!({"ok": false, "error": "path required"}),
                );
            };
            touch(shared);
            let mut eng = lock_engine(&shared.engine);
            let result = if let Some(content) = body.content {
                eng.update_overlay_content(&path, &content)
            } else {
                eng.update_overlay_from_disk(&path)
            };
            match result {
                Ok(()) => write_json(&mut stream, 200, json!({"ok": true})),
                Err(err) => write_json(&mut stream, 500, json!({"ok": false, "error": err})),
            }
        }
        ("POST", "/v1/index/delete") => {
            let body: IndexDeleteBody = serde_json::from_str(&req.body).unwrap_or_default();
            let Some(path) = body.path.filter(|p| !p.is_empty()) else {
                return write_json(
                    &mut stream,
                    400,
                    json!({"ok": false, "error": "path required"}),
                );
            };
            touch(shared);
            let mut eng = lock_engine(&shared.engine);
            match eng.delete_overlay_path(&path, true) {
                Ok(()) => write_json(&mut stream, 200, json!({"ok": true})),
                Err(err) => write_json(&mut stream, 500, json!({"ok": false, "error": err})),
            }
        }
        ("POST", "/v1/index/commit") => {
            touch(shared);
            let mut eng = lock_engine(&shared.engine);
            match eng.commit() {
                Ok(()) => write_json(&mut stream, 200, json!({"ok": true})),
                Err(err) => write_json(&mut stream, 500, json!({"ok": false, "error": err})),
            }
        }
        _ => write_json(&mut stream, 404, json!({"ok": false, "error": "not found"})),
    }
}

struct HttpReq {
    method: String,
    path: String,
    headers: Vec<(String, String)>,
    body: String,
}

fn read_http(stream: &mut TcpStream) -> Result<HttpReq, String> {
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut start = String::new();
    reader.read_line(&mut start).map_err(|e| e.to_string())?;
    let mut parts = start.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts
        .next()
        .unwrap_or("/")
        .split('?')
        .next()
        .unwrap_or("/")
        .to_string();
    if method.is_empty() {
        return Err("empty request".into());
    }
    let mut headers = Vec::new();
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if line == "\r\n" || line == "\n" || line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().to_string();
            let val = v.trim().trim_end_matches(['\r', '\n']).to_string();
            if key.eq_ignore_ascii_case("content-length") {
                content_length = val.parse().unwrap_or(0);
            }
            headers.push((key, val));
        }
        if headers.len() > 80 {
            break;
        }
    }
    content_length = content_length.min(8 * 1024 * 1024);
    let mut body_buf = vec![0u8; content_length];
    if content_length > 0 {
        reader
            .read_exact(&mut body_buf)
            .map_err(|e| e.to_string())?;
    }
    Ok(HttpReq {
        method,
        path,
        headers,
        body: String::from_utf8_lossy(&body_buf).into_owned(),
    })
}

fn write_json(stream: &mut TcpStream, status: u16, body: Value) -> Result<(), String> {
    let text = body.to_string();
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        500 => "Internal Server Error",
        503 => "Service Unavailable",
        _ => "OK",
    };
    let header = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        text.len()
    );
    stream
        .write_all(header.as_bytes())
        .and_then(|_| stream.write_all(text.as_bytes()))
        .and_then(|_| stream.flush())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ttl_defaults_conservatively() {
        assert_eq!(parse_positive_ms(None, 300_000), 300_000);
        assert_eq!(parse_positive_ms(Some("0".into()), 300_000), 300_000);
        assert_eq!(parse_positive_ms(Some("abc".into()), 300_000), 300_000);
        assert_eq!(parse_positive_ms(Some("200".into()), 300_000), 200);
        assert_eq!(parse_positive_ms(Some("10".into()), 300_000), 50);
    }

    #[test]
    fn expire_removes_stale_and_keeps_live() {
        let mut sessions = HashMap::new();
        renew_lease(&mut sessions, "stale".into(), 1_000, 100);
        renew_lease(&mut sessions, "live".into(), 1_050, 100);
        expire_sessions(&mut sessions, 1_101);
        assert_eq!(sessions.len(), 1);
        assert!(sessions.contains_key("live"));
        assert!(!sessions.contains_key("stale"));
    }

    #[test]
    fn renew_is_idempotent_and_extends() {
        let mut sessions = HashMap::new();
        let first = renew_lease(&mut sessions, "A".into(), 1_000, 300);
        let second = renew_lease(&mut sessions, "A".into(), 1_200, 300);
        assert_eq!(sessions.len(), 1);
        assert_eq!(first.expires_at, 1_300);
        assert_eq!(second.expires_at, 1_500);
        assert_eq!(sessions.get("A").unwrap().last_seen_at, 1_200);
    }

    #[test]
    fn health_session_payload_has_no_token() {
        let mut sessions = HashMap::new();
        renew_lease(&mut sessions, "A".into(), 10, 50);
        let payload = live_session_payload(&sessions);
        let text = serde_json::to_string(&payload).unwrap();
        assert!(text.contains("sessionId"));
        assert!(text.contains("lastSeenAt"));
        assert!(text.contains("expiresAt"));
        assert!(!text.contains("token"));
        assert_eq!(oldest_expires_at(&sessions), Some(60));
    }

    #[test]
    fn heartbeat_unknown_does_not_insert() {
        let mut sessions = HashMap::new();
        assert!(touch_lease(&mut sessions, "ghost", 1_000, 100).is_none());
        assert!(sessions.is_empty());
        renew_lease(&mut sessions, "H".into(), 1_000, 100);
        sessions.remove("H");
        assert!(touch_lease(&mut sessions, "H", 1_200, 100).is_none());
        assert!(sessions.is_empty());
    }

    #[test]
    fn heartbeat_renews_existing_only() {
        let mut sessions = HashMap::new();
        renew_lease(&mut sessions, "H".into(), 1_000, 300);
        let lease = touch_lease(&mut sessions, "H", 1_200, 300).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(lease.last_seen_at, 1_200);
        assert_eq!(lease.expires_at, 1_500);
        assert!(touch_lease(&mut sessions, "other", 1_300, 300).is_none());
        assert_eq!(sessions.len(), 1);
    }
}
