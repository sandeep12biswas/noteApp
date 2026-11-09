//! Sync step S5: runs the sync engine in the background for a shell.
//!
//! Both shells start one [`SyncService`] next to their database pool and
//! forward its events to the frontend (the Electron sidecar as
//! `{"event":"sync","data":…}` lines, Tauri as a `sync-event` app event).
//! Settings commands (`status`, `configure`, `sign_in`, `connect`,
//! `sync_now`, `confirm_mass_delete`, `disconnect`) are methods here, so the
//! two shells can't behave differently.
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
//! - `conflict`: `{ segmentIds }` — conflict copies just created;
//! - `signIn`: `{ url }` — a cloud sign-in is waiting in the browser at
//!   `url` (shown as a link in case the browser didn't open).

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use super::gdrive::{self, GoogleDriveTarget};
use super::http::{Http, Retry};
use super::oauth::{self, Provider, TokenSource, Tokens, SIGN_IN_AGAIN};
use super::onedrive::{self, OneDriveTarget};
use super::{connect_vault, stored_vault_key, sync_once, ConnectError, LocalFolderTarget, MassDelete, SyncOptions, SyncTarget};
use std::sync::atomic::{AtomicBool, Ordering};
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

pub const TARGET_NONE: &str = "none";
pub const TARGET_FOLDER: &str = "folder";
pub const TARGET_ONEDRIVE: &str = "onedrive";
pub const TARGET_GDRIVE: &str = "gdrive";

fn is_cloud(target: &str) -> bool {
    target == TARGET_ONEDRIVE || target == TARGET_GDRIVE
}

/// This app's OAuth registrations and the cloud APIs' addresses.
#[derive(Debug, Clone)]
pub struct Cloud {
    /// `None` when this build has no OneDrive app id (see [`Cloud::from_env`]).
    pub onedrive: Option<Provider>,
    pub google: Option<Provider>,
    pub graph_api: String,
    pub drive_api: String,
    pub retry: Retry,
    /// How long a sign-in waits for the browser.
    pub sign_in_timeout: Duration,
}

/// A build-time setting, overridable at run time (developers, tests).
fn setting(runtime: &str, built_in: Option<&'static str>) -> Option<String> {
    std::env::var(runtime).ok().or(built_in.map(str::to_string)).filter(|v| !v.trim().is_empty())
}

impl Cloud {
    /// The app registrations come from `FLOWNOTE_ONEDRIVE_CLIENT_ID`,
    /// `FLOWNOTE_GOOGLE_CLIENT_ID` and `FLOWNOTE_GOOGLE_CLIENT_SECRET`, set
    /// when building (compiled in) or when running. docs/sync-cloud-setup.md
    /// explains how to register the apps.
    pub fn from_env() -> Cloud {
        let onedrive = setting("FLOWNOTE_ONEDRIVE_CLIENT_ID", option_env!("FLOWNOTE_ONEDRIVE_CLIENT_ID")).map(|client_id| Provider {
            name: "OneDrive",
            auth_url: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize".into(),
            token_url: "https://login.microsoftonline.com/common/oauth2/v2.0/token".into(),
            client_id,
            client_secret: None,
            scopes: "Files.ReadWrite.AppFolder User.Read offline_access".into(),
            redirect_host: "localhost",
            extra_auth_params: vec![("prompt", "select_account")],
        });
        let google = setting("FLOWNOTE_GOOGLE_CLIENT_ID", option_env!("FLOWNOTE_GOOGLE_CLIENT_ID")).map(|client_id| Provider {
            name: "Google Drive",
            auth_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token_url: "https://oauth2.googleapis.com/token".into(),
            client_id,
            client_secret: setting("FLOWNOTE_GOOGLE_CLIENT_SECRET", option_env!("FLOWNOTE_GOOGLE_CLIENT_SECRET")),
            scopes: "https://www.googleapis.com/auth/drive.file".into(),
            redirect_host: "127.0.0.1",
            // A refresh token every time, so sync keeps working unattended.
            extra_auth_params: vec![("access_type", "offline"), ("prompt", "consent")],
        });
        Cloud {
            onedrive,
            google,
            graph_api: onedrive::GRAPH_API.into(),
            drive_api: gdrive::DRIVE_API.into(),
            retry: Retry::default(),
            sign_in_timeout: Duration::from_secs(300),
        }
    }

    fn provider(&self, target: &str) -> Result<Provider, String> {
        let (found, name, var) = match target {
            TARGET_ONEDRIVE => (&self.onedrive, "OneDrive", "FLOWNOTE_ONEDRIVE_CLIENT_ID"),
            TARGET_GDRIVE => (&self.google, "Google Drive", "FLOWNOTE_GOOGLE_CLIENT_ID"),
            other => return Err(format!("Syncing to \"{other}\" isn't available in this version.")),
        };
        found.clone().ok_or_else(|| format!("This build of FlowNote isn't registered with {name} ({var} wasn't set; see docs/sync-cloud-setup.md)."))
    }

    fn target(&self, kind: &str, tokens: Arc<TokenSource>) -> Result<CloudTarget, String> {
        let http = Http::new(self.retry.clone())?;
        Ok(match kind {
            TARGET_ONEDRIVE => CloudTarget::OneDrive(OneDriveTarget::with_api(http, tokens, &self.graph_api)),
            _ => CloudTarget::Google(GoogleDriveTarget::with_api(http, tokens, &self.drive_api)),
        })
    }
}

enum CloudTarget {
    OneDrive(OneDriveTarget),
    Google(GoogleDriveTarget),
}

impl CloudTarget {
    fn account(&self) -> Result<String, String> {
        match self {
            CloudTarget::OneDrive(t) => t.account(),
            CloudTarget::Google(t) => t.account(),
        }
    }

    fn boxed(self) -> Box<dyn SyncTarget> {
        match self {
            CloudTarget::OneDrive(t) => Box::new(t),
            CloudTarget::Google(t) => Box::new(t),
        }
    }
}

/// Everything [`SyncService::start_with`] can change; tests shorten it.
#[derive(Debug, Clone)]
pub struct Config {
    pub timing: Timing,
    pub kdf: KdfParams,
    pub cloud: Cloud,
}

impl Default for Config {
    fn default() -> Self {
        Config { timing: Timing::default(), kdf: KdfParams::default(), cloud: Cloud::from_env() }
    }
}

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
    /// Set to stop the sign-in waiting in the browser, if any.
    sign_in_cancel: Option<Arc<AtomicBool>>,
}

struct Shared {
    pool: Pool<SqliteConnectionManager>,
    emit: Emit,
    timing: Timing,
    kdf: KdfParams,
    cloud: Cloud,
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
    oauth_tokens: Option<String>,
    enabled: bool,
    last_sync_at: Option<i64>,
    last_error: Option<String>,
}

impl Settings {
    /// A cloud target chosen but not signed in (or the sign-in was revoked).
    fn needs_sign_in(&self) -> bool {
        is_cloud(&self.target) && self.oauth_tokens.is_none()
    }
}

fn read_settings(conn: &Connection) -> Result<Settings, String> {
    crdt::device_id(conn)?;
    conn.query_row(
        "SELECT device_id, device_name, target, account_label, oauth_tokens, enabled, last_sync_at, last_error FROM sync_settings WHERE id = 1",
        [],
        |r| {
            Ok(Settings {
                device_id: r.get(0)?,
                device_name: r.get(1)?,
                target: r.get(2)?,
                account_label: r.get(3)?,
                oauth_tokens: r.get(4)?,
                enabled: r.get::<_, i64>(5)? != 0,
                last_sync_at: r.get(6)?,
                last_error: r.get(7)?,
            })
        },
    )
    .map_err(err)
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
        Self::start_with(pool, emit, Config::default())
    }

    /// [`start`](Self::start) with other timings, key-derivation cost or
    /// cloud endpoints (tests).
    pub fn start_with(pool: Pool<SqliteConnectionManager>, emit: Emit, config: Config) -> Result<SyncService, String> {
        let Config { timing, kdf, cloud } = config;
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
            cloud,
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
    /// `{ target?: "none" | "folder" | "onedrive" | "gdrive", folderPath?,
    /// deviceName? }`. Choosing a different target forgets the sign-in and the
    /// passphrase key, so [`sign_in`](Self::sign_in) (cloud targets) and
    /// [`connect`](Self::connect) are needed again; local notes are untouched.
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
                cloud => {
                    shared.cloud.provider(cloud)?;
                    if cloud == current.target {
                        current.account_label.clone() // same drive: keep the sign-in
                    } else {
                        None
                    }
                }
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
            if settings.needs_sign_in() {
                return Err("Sign in first.".into());
            }
            let Some(target) = shared.open_target(&settings)? else {
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

    /// Signs in to a cloud drive (`"onedrive"` or `"gdrive"`) in the system
    /// browser, which `open_browser` opens at the sign-in URL (also sent as a
    /// `signIn` event, for a link in case it didn't open). Blocks until the
    /// browser comes back, [`cancel_sign_in`](Self::cancel_sign_in), or a
    /// timeout. Then the drive is the target: the passphrase is still needed
    /// ([`connect`](Self::connect)) — unless this was the same account again
    /// (e.g. after the sign-in expired), which carries on syncing.
    pub fn sign_in(&self, target: &str, open_browser: &dyn Fn(&str) -> Result<(), String>) -> Result<Value, String> {
        let shared = &self.shared;
        let provider = shared.cloud.provider(target)?;
        let cancel = Arc::new(AtomicBool::new(false));
        if let Some(previous) = lock(&shared.runtime).sign_in_cancel.replace(cancel.clone()) {
            previous.store(true, Ordering::Relaxed); // one sign-in at a time
        }
        let result = (|| {
            let http = Http::new(shared.cloud.retry.clone())?;
            let auth = oauth::begin(&provider)?;
            (shared.emit)(json!({ "type": "signIn", "url": auth.url }));
            if let Err(e) = open_browser(&auth.url) {
                eprintln!("flownote sync: couldn't open the browser: {e}");
            }
            let code = auth.wait(&cancel, shared.cloud.sign_in_timeout)?;
            let tokens = oauth::exchange(&http, &provider, &auth, &code)?;
            let source = Arc::new(TokenSource::new(provider.clone(), tokens.clone(), Box::new(|_| Ok(()))));
            let account = shared.cloud.target(target, source)?.account()?;
            Ok::<_, String>((tokens, account))
        })();
        {
            let mut rt = lock(&shared.runtime);
            if rt.sign_in_cancel.as_ref().is_some_and(|c| Arc::ptr_eq(c, &cancel)) {
                rt.sign_in_cancel = None;
            }
        }
        let (tokens, account) = result?;

        let carry_on = {
            let _cycle = lock(&shared.cycle);
            let conn = shared.pool.get().map_err(err)?;
            let current = read_settings(&conn)?;
            let same_account = current.target == target && current.account_label.as_deref() == Some(account.as_str());
            if same_account {
                conn.execute(
                    "UPDATE sync_settings SET oauth_tokens = ?1, last_error = NULL WHERE id = 1",
                    [tokens.to_json()],
                )
                .map_err(err)?;
            } else {
                conn.execute(
                    "UPDATE sync_settings SET target = ?1, account_label = ?2, oauth_tokens = ?3, vault_key = NULL,
                       enabled = 0, last_error = NULL WHERE id = 1",
                    rusqlite::params![target, account, tokens.to_json()],
                )
                .map_err(err)?;
                lock(&shared.runtime).held_back = None;
            }
            same_account && current.enabled
        };
        if carry_on {
            shared.request(false);
        }
        shared.emit_status();
        shared.status()
    }

    /// Stops a sign-in waiting in the browser; its `sign_in` call then fails.
    pub fn cancel_sign_in(&self) -> Result<Value, String> {
        if let Some(cancel) = lock(&self.shared.runtime).sign_in_cancel.take() {
            cancel.store(true, Ordering::Relaxed);
        }
        self.shared.status()
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
    /// Where the configured target stores files, if one is chosen.
    fn open_target(&self, settings: &Settings) -> Result<Option<Box<dyn SyncTarget>>, String> {
        match settings.target.as_str() {
            TARGET_NONE => Ok(None),
            TARGET_FOLDER => {
                let path = settings.account_label.as_deref().unwrap_or_default();
                if !Path::new(path).is_dir() {
                    return Err(format!("The sync folder {path} isn't there (is the drive connected?)."));
                }
                Ok(Some(Box::new(LocalFolderTarget::new(path))))
            }
            cloud => {
                let provider = self.cloud.provider(cloud)?;
                let stored = settings.oauth_tokens.as_deref().ok_or_else(|| format!("Sign in to {} first.", provider.name))?;
                let tokens = Tokens::from_json(stored)?;
                let pool = self.pool.clone();
                let save = Box::new(move |t: &Tokens| {
                    let conn = pool.get().map_err(err)?;
                    conn.execute("UPDATE sync_settings SET oauth_tokens = ?1 WHERE id = 1", [t.to_json()]).map_err(err)?;
                    Ok(())
                });
                let source = Arc::new(TokenSource::new(provider, tokens, save));
                Ok(Some(self.cloud.target(cloud, source)?.boxed()))
            }
        }
    }

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
        } else if s.needs_sign_in() {
            "needsSignIn"
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
            "accountLabel": if is_cloud(&s.target) { s.account_label.clone() } else { None },
            "signingIn": rt.sign_in_cancel.is_some(),
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
        if s.target == TARGET_NONE || !s.enabled || s.needs_sign_in() {
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
        if !settings.enabled || settings.needs_sign_in() {
            return Ok(None);
        }
        let prepared = (|| {
            let target = self.open_target(&settings)?;
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
        let result = sync_once(&conn, target.as_ref(), &key, &options).map(Some);
        if let Err(e) = &result
            && e.contains(SIGN_IN_AGAIN)
        {
            // Only a new sign-in helps: forget the dead tokens so the status
            // says so, instead of failing again every minute.
            conn.execute("UPDATE sync_settings SET oauth_tokens = NULL WHERE id = 1", []).map_err(err)?;
        }
        result
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
