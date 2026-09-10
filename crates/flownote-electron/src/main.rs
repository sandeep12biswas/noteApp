//! flownote-electron — the Rust sidecar binary for the Linux (Electron)
//! shell. DESIGN.md §3.2/§8.1: Electron's main process spawns this as a
//! subprocess and talks to it over stdio using the newline-delimited JSON
//! protocol in `protocol.rs`. All real storage/CRDT/collision/AI logic
//! lives in `flownote-core`; this binary is just the process boundary and
//! the request loop.

mod protocol;

use protocol::{Request, Response};
use std::io::{self, BufRead, Write};

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
    let mut stdout = io::stdout();

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

        let response = match serde_json::from_str::<Request>(&line) {
            Ok(req) => {
                let conn = match pool.get() {
                    Ok(conn) => conn,
                    Err(e) => {
                        // Pool exhaustion/poisoning shouldn't take the whole
                        // process down — report it as a per-request error.
                        let id = req.id;
                        write_response(
                            &mut stdout,
                            &Response { id, result: None, error: Some(format!("db pool error: {e}")) },
                        );
                        continue;
                    }
                };
                protocol::dispatch(&conn, req)
            }
            Err(e) => {
                // We can't recover the request `id` from unparseable input;
                // id 0 is reserved (real requests start at 1 on the Node
                // side) so the caller can tell this apart from a real reply.
                Response { id: 0, result: None, error: Some(format!("invalid request JSON: {e}")) }
            }
        };

        write_response(&mut stdout, &response);
    }
}

fn write_response(stdout: &mut impl Write, response: &Response) {
    let Ok(json) = serde_json::to_string(response) else {
        eprintln!("flownote-electron: failed to serialize response for id {}", response.id);
        return;
    };
    if writeln!(stdout, "{json}").is_err() || stdout.flush().is_err() {
        eprintln!("flownote-electron: failed to write response to stdout");
    }
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
