//! flownote-electron — the Rust sidecar binary for the Linux (Electron)
//! shell. DESIGN.md §3.2/§8.1: Electron's main process spawns this as a
//! subprocess and talks to it over stdio using the newline-delimited JSON
//! protocol in `protocol.rs`. All real storage/CRDT/collision/AI logic
//! lives in `flownote-core`; this binary is just the process boundary and
//! the request loop.

mod protocol;

use protocol::{Request, Response};
use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

fn main() {
    let db_path = std::env::var("FLOWNOTE_DB_PATH").unwrap_or_else(|_| default_db_path());
    if let Some(parent) = std::path::Path::new(&db_path).parent()
        && let Err(e) = std::fs::create_dir_all(parent)
    {
        eprintln!("flownote-electron: failed to create db directory {}: {e}", parent.display());
        std::process::exit(1);
    }
    let pool = flownote_core::db::open(&db_path).unwrap_or_else(|e| {
        eprintln!("flownote-electron: failed to open database at {db_path}: {e}");
        std::process::exit(1);
    });

    eprintln!("flownote-electron: ready (db: {db_path})");

    let stdin = io::stdin();
    // Cancel flags for in-flight `ai_complete` streams, by request id.
    let ai_streams: Arc<Mutex<HashMap<u64, Arc<AtomicBool>>>> = Arc::default();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("flownote-electron: stdin read error: {e}");
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }

        let req = match serde_json::from_str::<Request>(&line) {
            Ok(req) => req,
            Err(e) => {
                // We can't recover the request `id` from unparseable input;
                // id 0 is reserved (real requests start at 1 on the Node
                // side) so the caller can tell this apart from a real reply.
                write_response(&Response { id: 0, result: None, error: Some(format!("invalid request JSON: {e}")) });
                continue;
            }
        };
        let conn = match pool.get() {
            Ok(conn) => conn,
            Err(e) => {
                // Pool exhaustion/poisoning shouldn't take the whole
                // process down — report it as a per-request error.
                write_response(&Response { id: req.id, result: None, error: Some(format!("db pool error: {e}")) });
                continue;
            }
        };

        match req.method.as_str() {
            // Streams: `{"id", "chunk"}` lines as text arrives, then the usual
            // final response. Runs on its own thread so other requests (saves,
            // loads) keep being answered meanwhile.
            "ai_complete" => {
                let prompt = req.params.get("prompt").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let context = req.params.get("context").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let provider_id = req.params.get("providerId").and_then(|v| v.as_str()).map(str::to_string);
                let cfg = match flownote_core::store::ai_provider_config(&conn, provider_id.as_deref()) {
                    Ok(cfg) => cfg,
                    Err(e) => {
                        write_response(&Response { id: req.id, result: None, error: Some(e) });
                        continue;
                    }
                };
                drop(conn); // the stream doesn't need the database
                let cancel = Arc::new(AtomicBool::new(false));
                ai_streams.lock().unwrap().insert(req.id, cancel.clone());
                let streams = ai_streams.clone();
                let id = req.id;
                std::thread::spawn(move || {
                    let result = flownote_core::ai::stream_completion(&cfg, &prompt, &context, &cancel, |text| {
                        write_line(&serde_json::json!({ "id": id, "chunk": text }));
                    });
                    streams.lock().unwrap().remove(&id);
                    let response = match result {
                        Ok(()) => Response { id, result: Some(serde_json::Value::Null), error: None },
                        Err(e) => Response { id, result: None, error: Some(e) },
                    };
                    write_response(&response);
                });
            }
            // Stops an in-flight `ai_complete` (the "Stop" button); its own
            // final response follows shortly after.
            "ai_cancel" => {
                let target = req.params.get("streamId").and_then(|v| v.as_u64());
                if let Some(flag) = target.and_then(|t| ai_streams.lock().unwrap().get(&t).cloned()) {
                    flag.store(true, Ordering::Relaxed);
                }
                write_response(&Response { id: req.id, result: Some(serde_json::Value::Null), error: None });
            }
            _ => write_response(&protocol::dispatch(&conn, req)),
        }
    }
}

/// Writes one JSON line to stdout, holding the lock for the whole line so
/// streaming threads and the request loop never interleave mid-line.
fn write_line(value: &impl serde::Serialize) {
    let Ok(json) = serde_json::to_string(value) else {
        eprintln!("flownote-electron: failed to serialize an output line");
        return;
    };
    let mut out = io::stdout().lock();
    if writeln!(out, "{json}").is_err() || out.flush().is_err() {
        eprintln!("flownote-electron: failed to write to stdout");
    }
}

fn write_response(response: &Response) {
    write_line(response);
}

/// Falls back to a `flownote.sqlite3` file under the OS-appropriate user
/// data directory when Electron doesn't override `FLOWNOTE_DB_PATH` (it
/// always will in practice, passing `app.getPath('userData')`, but the
/// fallback keeps this binary runnable standalone for debugging).
fn default_db_path() -> String {
    let base = std::env::var("XDG_DATA_HOME")
        .or_else(|_| std::env::var("HOME").map(|h| format!("{h}/.local/share")))
        .unwrap_or_else(|_| ".".into());
    format!("{base}/flownote/flownote.sqlite3")
}
