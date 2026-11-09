//! Sync step S5: runs the sync engine in the background for a shell.
//!
//! Both shells start one [`SyncService`] next to their database pool and
//! forward its events to the frontend (the Electron sidecar as
//! `{"event":"sync","data":…}` lines, Tauri as a `sync-event` app event).
//! Settings commands (`status`, `configure`, `connect`, `sync_now`,
//! `confirm_mass_delete`, `disconnect`) are methods here, so the two shells
//! can't behave differently.
//!
//! A cycle runs:
//! - when the app starts, if sync is set up;
//! - a few seconds after a local edit (V9's triggers put it in `sync_outbox`;
//!   the worker looks there, so no write path has to tell it);
//! - every minute;
//! - on "Sync now".
//!
//! After a failed cycle, the automatic ones wait a minute before trying again.
//!
//! Events, all JSON with a `type`:
//! - `status`: the same object [`SyncService::status`] returns;
//! - `docsChanged`: `{ pageIds, folders }` — pages whose segments, ink or
//!   attachments another device changed, and whether the folder tree, page
//!   list or dictionary changed;
//! - `conflict`: `{ segmentIds }` — conflict copies just created.

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::{connect_vault, stored_vault_key, sync_once, ConnectError, LocalFolderTarget, MassDelete, SyncOptions, SyncTarget};
use crate::crypto::KdfParams;
use crate::crdt;
use crate::store::now_ms;

pub type Emit = Arc<dyn Fn(Value) + Send + Sync>;

/// When cycles run. [`Timing::default`] is what the app uses; tests shorten it.
#[derive(Debug, Clone)]
pub struct Timing {
    /// How often the worker checks whether a cycle is due.
    pub poll: Duration,
    /// How long after a local edit the cycle runs.
    pub after_edit: Duration,
    /// How often a cycle runs anyway, to pick up other devices' changes.
    pub interval: Duration,
    /// How long automatic cycles wait after a failed one.
    pub retry: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Timing {
            poll: Duration::from_secs(1),
            after_edit: Duration::from_secs(5),
            interval: Duration::from_secs(60),
            retry: Duration::from_secs(60),
        }
    }
}

/// Targets this build can sync to. OneDrive and Google Drive arrive with S6.
pub const TARGET_NONE: &str = "none";
pub const TARGET_FOLDER: &str = "folder";

#[derive(Default)]
struct Runtime {
    stop: bool,
    /// "Sync now" (or confirm / connect) pressed since the last cycle started.
    requested: bool,
    allow_mass_delete: bool,
    syncing: bool,
    last_attempt: Option<Instant>,
    last_failed: bool,
    held_back: Option<MassDelete>,
    waiting: usize,
}

struct Shared {
    pool: Pool<SqliteConnectionManager>,
    emit: Emit,
    timing: Timing,
    kdf: KdfParams,
    runtime: Mutex<Runtime>,
    wake: Condvar,
    /// Held for a whole cycle and while (dis)connecting, so settings never
    /// change under a running cycle.
    cycle: Mutex<()>,
}

pub struct SyncService {
    shared: Arc<Shared>,
    worker: Option<JoinHandle<()>>,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

struct Settings {
    device_id: String,
    device_name: String,
    target: String,
    account_label: Option<String>,
    enabled: bool,
    last_sync_at: Option<i64>,
    last_error: Option<String>,
}

fn read_settings(conn: &Connection) -> Result<Settings, String> {
    crdt::device_id(conn)?;
    conn.query_row(
        "SELECT device_id, device_name, target, account_label, enabled, last_sync_at, last_error FROM sync_settings WHERE id = 1",
        [],
        |r| {
            Ok(Settings {
                device_id: r.get(0)?,
                device_name: r.get(1)?,
                target: r.get(2)?,
                account_label: r.get(3)?,
                enabled: r.get::<_, i64>(4)? != 0,
                last_sync_at: r.get(5)?,
                last_error: r.get(6)?,
            })
        },
    )
    .map_err(err)
}

/// The cloud folder for the configured target, if there is one.
fn open_target(settings: &Settings) -> Result<Option<Box<dyn SyncTarget>>, String> {
    match settings.target.as_str() {
        TARGET_NONE => Ok(None),
        TARGET_FOLDER => {
            let path = settings.account_label.as_deref().unwrap_or_default();
            if !Path::new(path).is_dir() {
                return Err(format!("The sync folder {path} isn't there (is the drive connected?)."));
            }
            Ok(Some(Box::new(LocalFolderTarget::new(path))))
        }
        other => Err(format!("Syncing to \"{other}\" isn't available in this version.")),
    }
}

/// This computer's name, shown on the user's other devices until they pick one.
fn default_device_name() -> String {
    let from_env = std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).ok();
    let from_file = || std::fs::read_to_string("/etc/hostname").ok();
    from_env
        .or_else(from_file)
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "FlowNote device".into())
}

impl SyncService {
    pub fn start(pool: Pool<SqliteConnectionManager>, emit: Emit) -> Result<SyncService, String> {
        Self::start_with(pool, emit, Timing::default(), KdfParams::default())
    }

    /// [`start`](Self::start) with other timings and key-derivation cost (tests).
    pub fn start_with(pool: Pool<SqliteConnectionManager>, emit: Emit, timing: Timing, kdf: KdfParams) -> Result<SyncService, String> {
        {
            let conn = pool.get().map_err(err)?;
            let settings = read_settings(&conn)?;
            if settings.device_name.is_empty() {
                conn.execute("UPDATE sync_settings SET device_name = ?1 WHERE id = 1", [default_device_name()]).map_err(err)?;
            }
        }
        let shared = Arc::new(Shared {
            pool,
            emit,
            timing,
            kdf,
            runtime: Mutex::new(Runtime { requested: true, ..Runtime::default() }), // sync on start
            wake: Condvar::new(),
            cycle: Mutex::new(()),
        });
        let worker_shared = shared.clone();
        let worker = std::thread::Builder::new()
            .name("flownote-sync".into())
            .spawn(move || worker_loop(&worker_shared))
            .map_err(err)?;
        Ok(SyncService { shared, worker: Some(worker) })
    }

    /// The settings and state the Sync settings screen and status bar show.
    /// Secrets (the vault key, OAuth tokens) are never included.
    pub fn status(&self) -> Result<Value, String> {
        self.shared.status()
    }

    /// Picks where to sync and/or names this device. `input`:
    /// `{ target?: "none" | "folder", folderPath?, deviceName? }`. Choosing a
    /// different target forgets the passphrase key, so [`connect`](Self::connect)
    /// is needed again; local notes are untouched.
    pub fn configure(&self, input: &Value) -> Result<Value, String> {
        let shared = &self.shared;
        let _cycle = lock(&shared.cycle);
        let conn = shared.pool.get().map_err(err)?;
        let current = read_settings(&conn)?;
        if let Some(name) = input.get("deviceName").and_then(Value::as_str) {
            let name = name.trim();
            if name.is_empty() {
                return Err("The device name can't be empty.".into());
            }
            conn.execute("UPDATE sync_settings SET device_name = ?1 WHERE id = 1", [name]).map_err(err)?;
        }
        if let Some(target) = input.get("target").and_then(Value::as_str) {
            let label = match target {
                TARGET_NONE => None,
                TARGET_FOLDER => {
                    let path = input.get("folderPath").and_then(Value::as_str).map(str::trim).unwrap_or_default();
                    if !Path::new(path).is_absolute() {
                        return Err("Choose the sync folder by its full path.".into());
                    }
                    if !Path::new(path).is_dir() {
                        return Err(format!("There's no folder at {path}."));
                    }
                    Some(path.to_string())
                }
                other => return Err(format!("Syncing to \"{other}\" isn't available in this version.")),
            };
            if target != current.target || label != current.account_label {
                conn.execute(
                    "UPDATE sync_settings SET target = ?1, account_label = ?2, oauth_tokens = NULL, vault_key = NULL,
                       enabled = 0, last_error = NULL WHERE id = 1",
                    rusqlite::params![target, label],
                )
                .map_err(err)?;
                lock(&shared.runtime).held_back = None;
            }
        }
        drop(conn);
        shared.emit_status();
        shared.status()
    }

    /// Joins the target's vault with `passphrase` (creating it on the first
    /// device), turns sync on and starts a cycle. A wrong passphrase fails
    /// with an error starting "Wrong passphrase".
    pub fn connect(&self, passphrase: &str) -> Result<Value, String> {
        let shared = &self.shared;
        if passphrase.is_empty() {
            return Err("Enter a passphrase.".into());
        }
        {
            let _cycle = lock(&shared.cycle);
            let conn = shared.pool.get().map_err(err)?;
            let settings = read_settings(&conn)?;
            let Some(target) = open_target(&settings)? else {
                return Err("Choose where to sync first.".into());
            };
            match connect_vault(&conn, target.as_ref(), passphrase, shared.kdf) {
                Ok(_) => {}
                Err(ConnectError::WrongPassphrase) => {
                    return Err("Wrong passphrase: it doesn't match the one this sync folder was set up with.".into());
                }
                Err(ConnectError::Other(e)) => return Err(e),
            }
            conn.execute("UPDATE sync_settings SET enabled = 1, last_error = NULL WHERE id = 1", []).map_err(err)?;
        }
        shared.request(false);
        shared.emit_status();
        shared.status()
    }

    /// Runs a cycle now (or right after the one in progress).
    pub fn sync_now(&self) -> Result<Value, String> {
        self.shared.request(false);
        self.shared.status()
    }

    /// The user confirmed the held-back mass delete: the next cycle applies it.
    pub fn confirm_mass_delete(&self) -> Result<Value, String> {
        self.shared.request(true);
        self.shared.status()
    }

    /// Stops syncing and forgets the target and key. Notes stay on this
    /// device and in the cloud; connecting to the same folder again later
    /// carries on where it stopped.
    pub fn disconnect(&self) -> Result<Value, String> {
        let shared = &self.shared;
        {
            let _cycle = lock(&shared.cycle);
            let conn = shared.pool.get().map_err(err)?;
            read_settings(&conn)?;
            conn.execute(
                "UPDATE sync_settings SET target = 'none', account_label = NULL, oauth_tokens = NULL, vault_key = NULL,
                   enabled = 0, last_error = NULL WHERE id = 1",
                [],
            )
            .map_err(err)?;
            let mut rt = lock(&shared.runtime);
            rt.held_back = None;
            rt.waiting = 0;
        }
        shared.emit_status();
        shared.status()
    }
}

impl Drop for SyncService {
    fn drop(&mut self) {
        lock(&self.shared.runtime).stop = true;
        self.shared.wake.notify_all();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

/// A poisoned lock only means a cycle panicked; the state is still usable.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|p| p.into_inner())
}

impl Shared {
    fn request(&self, allow_mass_delete: bool) {
        let mut rt = lock(&self.runtime);
        rt.requested = true;
        rt.allow_mass_delete |= allow_mass_delete;
        self.wake.notify_all();
    }

    fn emit_status(&self) {
        match self.status() {
            Ok(status) => (self.emit)(json!({ "type": "status", "status": status })),
            Err(e) => eprintln!("flownote sync: couldn't read sync status: {e}"),
        }
    }

    fn status(&self) -> Result<Value, String> {
        let conn = self.pool.get().map_err(err)?;
        let s = read_settings(&conn)?;
        let connected = s.enabled && stored_vault_key(&conn)?.is_some();
        let quarantined: i64 = conn.query_row("SELECT COUNT(*) FROM sync_quarantine", [], |r| r.get(0)).map_err(err)?;
        let peers: Vec<Value> = conn
            .prepare("SELECT device_id, name, last_seen_at FROM sync_peers ORDER BY name, device_id")
            .map_err(err)?
            .query_map([], |r| {
                Ok(json!({ "deviceId": r.get::<_, String>(0)?, "name": r.get::<_, Option<String>>(1)?, "lastSeenAt": r.get::<_, Option<i64>>(2)? }))
            })
            .map_err(err)?
            .collect::<Result<_, _>>()
            .map_err(err)?;
        let rt = lock(&self.runtime);
        let held_back = match &rt.held_back {
            Some(h) => {
                let name: Option<String> = conn
                    .query_row("SELECT name FROM sync_peers WHERE device_id = ?1", [&h.device], |r| r.get(0))
                    .optional()
                    .map_err(err)?
                    .flatten();
                json!({
                    "deviceId": h.device,
                    "deviceName": name,
                    "pagesDeleted": h.pages_deleted,
                    "pagesTotal": h.pages_total,
                    "segmentsDeleted": h.segments_deleted,
                    "segmentsTotal": h.segments_total,
                })
            }
            None => Value::Null,
        };
        let state = if s.target == TARGET_NONE {
            "off"
        } else if !connected {
            "needsPassphrase"
        } else if rt.syncing {
            "syncing"
        } else if rt.held_back.is_some() {
            "heldBack"
        } else if s.last_error.is_some() {
            "error"
        } else {
            "idle"
        };
        Ok(json!({
            "state": state,
            "target": s.target,
            "folderPath": if s.target == TARGET_FOLDER { s.account_label.clone() } else { None },
            "deviceId": s.device_id,
            "deviceName": s.device_name,
            "connected": connected,
            "lastSyncAt": s.last_sync_at,
            "lastError": s.last_error,
            "heldBack": held_back,
            "quarantined": quarantined,
            "waiting": rt.waiting,
            "peers": peers,
        }))
    }

    /// Whether an automatic cycle is due (sync set up, and an edit waiting
    /// long enough or the interval passed), outside a retry pause.
    fn auto_due(&self, last_attempt: Option<Instant>, last_failed: bool) -> Result<bool, String> {
        if let (true, Some(at)) = (last_failed, last_attempt)
            && at.elapsed() < self.timing.retry
        {
            return Ok(false);
        }
        let conn = self.pool.get().map_err(err)?;
        let s = read_settings(&conn)?;
        if s.target == TARGET_NONE || !s.enabled {
            return Ok(false);
        }
        if last_attempt.is_none_or(|at| at.elapsed() >= self.timing.interval) {
            return Ok(true);
        }
        let oldest_edit: Option<i64> = conn.query_row("SELECT MIN(queued_at) FROM sync_outbox", [], |r| r.get(0)).map_err(err)?;
        Ok(oldest_edit.is_some_and(|at| now_ms() - at >= self.timing.after_edit.as_millis() as i64))
    }

    fn run_cycle(&self, allow_mass_delete: bool) {
        let _cycle = lock(&self.cycle);
        lock(&self.runtime).syncing = true;
        self.emit_status();

        let outcome = self.cycle_inner(allow_mass_delete);

        {
            let mut rt = lock(&self.runtime);
            rt.syncing = false;
            rt.last_attempt = Some(Instant::now());
            rt.last_failed = outcome.is_err();
            if let Ok(Some(report)) = &outcome {
                rt.held_back = report.held_back.clone();
                rt.waiting = report.waiting.len();
            }
        }
        match outcome {
            Ok(Some(report)) => {
                let page_ids: Vec<&str> = report.changed_docs.iter().filter_map(|d| d.strip_prefix("page:")).collect();
                let folders = report.changed_docs.iter().any(|d| d == crdt::NOTEBOOK_DOC);
                if folders || !page_ids.is_empty() {
                    (self.emit)(json!({ "type": "docsChanged", "pageIds": page_ids, "folders": folders }));
                }
                if !report.conflict_copies.is_empty() {
                    (self.emit)(json!({ "type": "conflict", "segmentIds": report.conflict_copies }));
                }
            }
            Ok(None) => {}
            Err(e) => eprintln!("flownote sync: {e}"),
        }
        self.emit_status();
    }

    /// One cycle; `Ok(None)` when sync isn't set up. Errors are also left in
    /// `sync_settings.last_error` for the status.
    fn cycle_inner(&self, allow_mass_delete: bool) -> Result<Option<super::SyncReport>, String> {
        let conn = self.pool.get().map_err(err)?;
        let settings = read_settings(&conn)?;
        if !settings.enabled {
            return Ok(None);
        }
        let prepared = (|| {
            let target = open_target(&settings)?;
            let key = stored_vault_key(&conn)?;
            Ok::<_, String>(target.zip(key))
        })();
        let (target, key) = match prepared {
            Ok(Some(pair)) => pair,
            Ok(None) => return Ok(None),
            Err(e) => {
                conn.execute("UPDATE sync_settings SET last_error = ?1 WHERE id = 1", [&e]).map_err(err)?;
                return Err(e);
            }
        };
        let options = SyncOptions { allow_mass_delete, device_name: settings.device_name };
        sync_once(&conn, target.as_ref(), &key, &options).map(Some)
    }
}

fn worker_loop(shared: &Shared) {
    loop {
        let (manual, allow_mass_delete) = {
            let mut rt = lock(&shared.runtime);
            if !rt.requested && !rt.stop {
                rt = shared.wake.wait_timeout(rt, shared.timing.poll).map(|(g, _)| g).unwrap_or_else(|p| p.into_inner().0);
            }
            if rt.stop {
                return;
            }
            let manual = std::mem::take(&mut rt.requested);
            let allow = std::mem::take(&mut rt.allow_mass_delete);
            (manual, allow)
        };
        let due = manual || {
            let (last_attempt, last_failed) = {
                let rt = lock(&shared.runtime);
                (rt.last_attempt, rt.last_failed)
            };
            shared.auto_due(last_attempt, last_failed).unwrap_or_else(|e| {
                eprintln!("flownote sync: {e}");
                false
            })
        };
        if due {
            shared.run_cycle(allow_mass_delete);
        }
    }
}

#[cfg(test)]
#[path = "service_tests.rs"]
mod tests;
