//! The sync engine (step S4): one sync cycle against a cloud folder.
//!
//! Cloud layout (everything except `vault.json` encrypted, see `crypto`):
//!
//! ```text
//! vault.json                                  key-derivation settings + check value
//! devices/<device id>/changes/<seq>.bundle.enc  that device's changes, numbered 1, 2, 3…
//! devices/<device id>/info.json.enc           its name and when it last synced
//! devices/<device id>/ack.json.enc            how far it has applied every other device
//! blobs/<sha256>.enc                          attachment files, by content
//! ```
//!
//! Each device writes only under its own `devices/<id>/` folder (plus
//! content-addressed blobs, where two writers write identical bytes), so
//! plain cloud drives work without any locking. A cycle:
//!
//! 1. checks the vault is still the one this device joined;
//! 2. backs up the local database (first sync, then daily);
//! 3. **pulls**: applies every other device's new change files in order
//!    (`merge::apply_bundle`), each with its progress record in one
//!    transaction. A file that can't be read is quarantined and that
//!    device's later files wait behind it; a bundle that would delete many
//!    pages or segments is held until the user confirms;
//! 4. moves attachment files: uploads blobs other devices will need, and
//!    downloads the ones this device's attachments are missing;
//! 5. **pushes**: if this device made changes, uploads them as its next
//!    change file. A device's log on its own is always enough to apply: a
//!    bundle carries everything the device learned since its last upload.
//!    Changes it only received from others aren't re-uploaded — they're in
//!    their authors' logs.

#[cfg(test)]
mod fake_clouds;
#[cfg(test)]
mod fake_http;
pub mod gdrive;
pub mod http;
pub mod oauth;
pub mod onedrive;
pub mod service;
mod target;
pub use target::{LocalFolderTarget, MemoryTarget, RemoteFile, SyncTarget};

use automerge::ChangeHash;
use base64::Engine as _;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::PathBuf;

use crate::crypto::{self, KdfParams, UnlockError, VaultKey};
use crate::store::{in_transaction, now_ms};
use crate::{crdt, merge, store};

pub const VAULT_PATH: &str = "vault.json";
const BUNDLE_FORMAT: u64 = 1;
const BACKUP_INTERVAL_MS: i64 = 24 * 60 * 60 * 1000;
const BACKUPS_KEPT: usize = 7;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn b64() -> base64::engine::GeneralPurpose {
    base64::engine::general_purpose::STANDARD
}

pub fn changes_path(device: &str, seq: u64) -> String {
    format!("devices/{device}/changes/{seq:010}.bundle.enc")
}

fn info_path(device: &str) -> String {
    format!("devices/{device}/info.json.enc")
}

fn ack_path(device: &str) -> String {
    format!("devices/{device}/ack.json.enc")
}

fn blob_path(sha256: &str) -> String {
    format!("blobs/{sha256}.enc")
}

/// `devices/<id>/changes/<seq>.bundle.enc` → `(id, seq)`.
fn parse_changes_path(path: &str) -> Option<(String, u64)> {
    let rest = path.strip_prefix("devices/")?;
    let (device, file) = rest.split_once("/changes/")?;
    let seq = file.strip_suffix(".bundle.enc")?.parse().ok()?;
    (!device.contains('/')).then(|| (device.to_string(), seq))
}

// ------------------------------------------------------------------ vault

#[derive(Debug, PartialEq)]
pub enum ConnectError {
    WrongPassphrase,
    Other(String),
}

impl std::fmt::Display for ConnectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConnectError::WrongPassphrase => f.write_str("wrong passphrase"),
            ConnectError::Other(e) => f.write_str(e),
        }
    }
}

impl From<String> for ConnectError {
    fn from(e: String) -> Self {
        ConnectError::Other(e)
    }
}

fn read_vault(target: &dyn SyncTarget) -> Result<Option<Value>, String> {
    match target.get(VAULT_PATH)? {
        Some(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| format!("vault.json is not valid: {e}")),
        None => Ok(None),
    }
}

/// Joins the cloud folder's vault with `passphrase` — or, on the first
/// device, creates it — and keeps the key in this device's database.
pub fn connect_vault(conn: &Connection, target: &dyn SyncTarget, passphrase: &str, params: KdfParams) -> Result<VaultKey, ConnectError> {
    let unlock = |vault: &Value| {
        crypto::unlock_vault(vault, passphrase).map_err(|e| match e {
            UnlockError::WrongPassphrase => ConnectError::WrongPassphrase,
            other => ConnectError::Other(other.to_string()),
        })
    };
    let (vault, key) = match read_vault(target)? {
        Some(vault) => {
            let key = unlock(&vault)?;
            (vault, key)
        }
        None => {
            let (vault, key) = crypto::create_vault(passphrase, params)?;
            target.put(VAULT_PATH, vault.to_string().as_bytes())?;
            // Another device may have created one at the same moment; the
            // one stored is the one everybody uses.
            match read_vault(target)? {
                Some(stored) if stored["vaultId"] == vault["vaultId"] => (vault, key),
                Some(stored) => {
                    let key = unlock(&stored)?;
                    (stored, key)
                }
                None => return Err(ConnectError::Other("vault.json disappeared right after it was written".into())),
            }
        }
    };
    crdt::device_id(conn)?;
    in_transaction(conn, || {
        let previous: Option<String> =
            conn.query_row("SELECT vault_id FROM sync_settings WHERE id = 1", [], |r| r.get(0)).map_err(err)?;
        if previous.is_some_and(|p| Some(p.as_str()) != vault["vaultId"].as_str()) {
            reset_for_new_vault(conn)?;
        }
        conn.execute(
            "UPDATE sync_settings SET vault_key = ?1, vault_id = ?2 WHERE id = 1",
            rusqlite::params![key.to_base64(), vault["vaultId"].as_str()],
        )
        .map_err(err)?;
        Ok(())
    })?;
    Ok(key)
}

/// Joining a different vault than before (another cloud, or the old cloud
/// folder was deleted and set up again): nothing there is this device's yet.
/// Numbering starts again at 1, other devices are forgotten, and every
/// document gets a change by this device so its next push uploads all of it
/// — including content it only received from devices that aren't in the new
/// vault, which its own log must now carry. Local notes are untouched.
fn reset_for_new_vault(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "UPDATE sync_settings SET upload_seq = 0, last_sync_at = NULL WHERE id = 1;
         DELETE FROM sync_peers;
         DELETE FROM sync_quarantine;
         UPDATE crdt_docs SET synced_heads = '[]';",
    )
    .map_err(err)?;
    let actor = crdt::device_actor(conn)?;
    let ids: Vec<String> = conn
        .prepare("SELECT doc_id FROM crdt_docs")
        .map_err(err)?
        .query_map([], |r| r.get(0))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    for id in ids {
        let Some(mut doc) = crdt::load_doc(conn, &id)? else { continue };
        doc.set_actor(actor.clone());
        doc.empty_change(automerge::transaction::CommitOptions::default().with_time(now_ms()));
        crdt::store_doc(conn, &id, &mut doc)?;
    }
    Ok(())
}

/// The key saved by `connect_vault`, if this device has joined a vault.
pub fn stored_vault_key(conn: &Connection) -> Result<Option<VaultKey>, String> {
    let text: Option<String> = conn
        .query_row("SELECT vault_key FROM sync_settings WHERE id = 1", [], |r| r.get(0))
        .optional()
        .map_err(err)?
        .flatten();
    text.map(|t| VaultKey::from_base64(&t)).transpose()
}

fn check_vault(conn: &Connection, target: &dyn SyncTarget) -> Result<(), String> {
    let joined: Option<String> =
        conn.query_row("SELECT vault_id FROM sync_settings WHERE id = 1", [], |r| r.get(0)).optional().map_err(err)?.flatten();
    let Some(joined) = joined else { return Err("this device hasn't joined a sync vault yet".into()) };
    match read_vault(target)? {
        None => Err("The cloud folder no longer has FlowNote's vault.json (was the folder deleted?). Sync is paused so nothing is lost.".into()),
        Some(vault) if vault["vaultId"].as_str() != Some(joined.as_str()) => {
            Err("The cloud folder now holds a different FlowNote vault. Sync is paused so nothing is lost.".into())
        }
        Some(_) => Ok(()),
    }
}

// ---------------------------------------------------------------- report

#[derive(Debug, Default, Clone)]
pub struct SyncOptions {
    /// Set after the user confirmed a held-back mass delete.
    pub allow_mass_delete: bool,
    /// Shown to the user's other devices.
    pub device_name: String,
}

/// A bundle held back because it would delete a lot at once.
#[derive(Debug, Clone, PartialEq)]
pub struct MassDelete {
    pub device: String,
    pub seq: u64,
    pub pages_deleted: usize,
    pub pages_total: usize,
    pub segments_deleted: usize,
    pub segments_total: usize,
}

#[derive(Debug, Default)]
pub struct SyncReport {
    /// Number of this device's change file uploaded, if any.
    pub uploaded: Option<u64>,
    /// Change files applied, as `(device, seq)`.
    pub applied: Vec<(String, u64)>,
    pub changed_docs: Vec<String>,
    pub restored: Vec<String>,
    pub conflict_copies: Vec<String>,
    pub blobs_uploaded: usize,
    pub blobs_downloaded: usize,
    /// Files that couldn't be read this cycle.
    pub quarantined: Vec<String>,
    /// Change files that can't be applied yet (an earlier file or another
    /// device's changes they build on are missing).
    pub waiting: Vec<String>,
    pub held_back: Option<MassDelete>,
}

// ------------------------------------------------------------------ cycle

/// Runs one sync cycle. On error nothing half-applied is left behind (each
/// applied change file is its own transaction), and the error is also
/// recorded in `sync_settings.last_error`.
pub fn sync_once(conn: &Connection, target: &dyn SyncTarget, key: &VaultKey, options: &SyncOptions) -> Result<SyncReport, String> {
    let result = run_cycle(conn, target, key, options);
    let (at, error) = match &result {
        Ok(_) => (Some(now_ms()), None),
        Err(e) => (None, Some(e.clone())),
    };
    conn.execute(
        "UPDATE sync_settings SET last_sync_at = COALESCE(?1, last_sync_at), last_error = ?2 WHERE id = 1",
        rusqlite::params![at, error],
    )
    .map_err(err)?;
    result
}

fn run_cycle(conn: &Connection, target: &dyn SyncTarget, key: &VaultKey, options: &SyncOptions) -> Result<SyncReport, String> {
    let me = crdt::device_id(conn)?;
    check_vault(conn, target)?;
    backup_if_due(conn)?;

    let first_sync: bool = conn
        .query_row("SELECT last_sync_at IS NULL FROM sync_settings WHERE id = 1", [], |r| r.get(0))
        .map_err(err)?;
    if first_sync {
        // Notes written before sync was ever on aren't in any document yet.
        crdt::bootstrap(conn)?;
    }

    let mut report = SyncReport::default();
    let device_files = target.list("devices/")?;
    pull(conn, target, key, &me, &device_files, options, &mut report)?;
    sync_blobs(conn, target, key, &mut report)?;
    push(conn, target, key, &me, &device_files, options, &mut report)?;
    if !report.applied.is_empty() {
        write_ack(conn, target, key, &me)?;
    }
    Ok(report)
}

fn quarantine(conn: &Connection, path: &str, error: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_quarantine (path, error, at) VALUES (?1, ?2, ?3)
         ON CONFLICT(path) DO UPDATE SET error = excluded.error, at = excluded.at",
        rusqlite::params![path, error, now_ms()],
    )
    .map_err(err)?;
    Ok(())
}

fn release_quarantine(conn: &Connection, path: &str) -> Result<(), String> {
    conn.execute("DELETE FROM sync_quarantine WHERE path = ?1", [path]).map_err(err)?;
    Ok(())
}

/// Downloads, decrypts and decodes one change file.
fn fetch_bundle(target: &dyn SyncTarget, key: &VaultKey, path: &str, device: &str, seq: u64) -> Result<Vec<(String, Vec<u8>)>, String> {
    let sealed = target.get(path)?.ok_or_else(|| format!("{path} disappeared"))?;
    let plain = crypto::open(key, path, &sealed)?;
    let bundle: Value = serde_json::from_slice(&plain).map_err(|e| format!("{path}: {e}"))?;
    if bundle["format"].as_u64() != Some(BUNDLE_FORMAT) {
        return Err(format!("{path}: unsupported bundle format (made by a newer FlowNote?)"));
    }
    if bundle["device"].as_str() != Some(device) || bundle["seq"].as_u64() != Some(seq) {
        return Err(format!("{path}: contents don't match the file name"));
    }
    let docs = bundle["docs"].as_object().ok_or_else(|| format!("{path}: no docs"))?;
    docs.iter()
        .map(|(doc_id, bytes)| {
            let bytes = bytes.as_str().and_then(|s| b64().decode(s).ok()).ok_or_else(|| format!("{path}: bad data for {doc_id}"))?;
            Ok((doc_id.clone(), bytes))
        })
        .collect()
}

enum ApplyFailure {
    MissingDependencies,
    MassDelete(MassDelete),
    Other(String),
}

fn ids(conn: &Connection, sql: &str) -> Result<BTreeSet<String>, String> {
    conn.prepare(sql).map_err(err)?.query_map([], |r| r.get(0)).map_err(err)?.collect::<Result<_, _>>().map_err(err)
}

/// Applies one change file and records it as applied, in one transaction.
fn apply_change_file(
    conn: &Connection,
    device: &str,
    seq: u64,
    bundle: &[(String, Vec<u8>)],
    options: &SyncOptions,
) -> Result<merge::ApplyOutcome, ApplyFailure> {
    let mut held = None;
    let result = in_transaction(conn, || {
        let pages_before = ids(conn, "SELECT id FROM pages")?;
        let segments_before = ids(conn, "SELECT id FROM segments")?;
        let outcome = merge::apply_bundle(conn, bundle)?;
        let pages_deleted = pages_before.difference(&ids(conn, "SELECT id FROM pages")?).count();
        let segments_deleted = segments_before.difference(&ids(conn, "SELECT id FROM segments")?).count();
        let too_many = (pages_deleted >= 5 && (pages_deleted * 5 > pages_before.len() || pages_deleted > 50))
            || (segments_deleted >= 20 && segments_deleted * 2 > segments_before.len());
        if too_many && !options.allow_mass_delete {
            held = Some(MassDelete {
                device: device.to_string(),
                seq,
                pages_deleted,
                pages_total: pages_before.len(),
                segments_deleted,
                segments_total: segments_before.len(),
            });
            return Err("held back: mass delete".into());
        }
        conn.execute(
            "INSERT INTO sync_peers (device_id, applied_seq, last_seen_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(device_id) DO UPDATE SET applied_seq = excluded.applied_seq, last_seen_at = excluded.last_seen_at",
            rusqlite::params![device, seq as i64, now_ms()],
        )
        .map_err(err)?;
        Ok(outcome)
    });
    match result {
        Ok(outcome) => Ok(outcome),
        Err(_) if held.is_some() => Err(ApplyFailure::MassDelete(held.unwrap())),
        Err(e) if e.starts_with(merge::MISSING_DEPENDENCIES) => Err(ApplyFailure::MissingDependencies),
        Err(e) => Err(ApplyFailure::Other(e)),
    }
}

fn applied_seq(conn: &Connection, device: &str) -> Result<u64, String> {
    let seq: Option<i64> =
        conn.query_row("SELECT applied_seq FROM sync_peers WHERE device_id = ?1", [device], |r| r.get(0)).optional().map_err(err)?;
    Ok(seq.unwrap_or(0) as u64)
}

#[allow(clippy::too_many_arguments)]
fn pull(
    conn: &Connection,
    target: &dyn SyncTarget,
    key: &VaultKey,
    me: &str,
    device_files: &[RemoteFile],
    options: &SyncOptions,
    report: &mut SyncReport,
) -> Result<(), String> {
    // Each other device's change files newer than what's applied, in order.
    let mut queues: BTreeMap<String, Vec<(u64, String)>> = BTreeMap::new();
    for file in device_files {
        if let Some((device, seq)) = parse_changes_path(&file.path)
            && device != me
        {
            queues.entry(device).or_default().push((seq, file.path.clone()));
        }
    }
    for (device, queue) in queues.iter_mut() {
        let applied = applied_seq(conn, device)?;
        queue.retain(|(seq, _)| *seq > applied);
        queue.sort();
        remember_peer_name(conn, target, key, device)?;
    }

    // Round-robin over devices, so a bundle that builds on another device's
    // changes waits until those are applied.
    let mut fetched: HashMap<String, Vec<(String, Vec<u8>)>> = HashMap::new();
    let mut blocked: BTreeSet<String> = BTreeSet::new();
    loop {
        let mut progress = false;
        for (device, queue) in queues.iter_mut() {
            if blocked.contains(device) {
                continue;
            }
            while let Some((seq, path)) = queue.first().cloned() {
                if seq != applied_seq(conn, device)? + 1 {
                    blocked.insert(device.clone()); // a file is missing in between
                    break;
                }
                if !fetched.contains_key(&path) {
                    match fetch_bundle(target, key, &path, device, seq) {
                        Ok(bundle) => {
                            release_quarantine(conn, &path)?;
                            fetched.insert(path.clone(), bundle);
                        }
                        Err(e) => {
                            quarantine(conn, &path, &e)?;
                            report.quarantined.push(path);
                            blocked.insert(device.clone());
                            break;
                        }
                    }
                }
                match apply_change_file(conn, device, seq, &fetched[&path], options) {
                    Ok(outcome) => {
                        report.applied.push((device.clone(), seq));
                        for doc in outcome.changed_docs {
                            if !report.changed_docs.contains(&doc) {
                                report.changed_docs.push(doc);
                            }
                        }
                        report.restored.extend(outcome.restored);
                        report.conflict_copies.extend(outcome.conflict_copies);
                        queue.remove(0);
                        progress = true;
                    }
                    Err(ApplyFailure::MissingDependencies) => break,
                    Err(ApplyFailure::MassDelete(held)) => {
                        report.held_back = Some(held);
                        blocked.insert(device.clone());
                        break;
                    }
                    Err(ApplyFailure::Other(e)) => return Err(e),
                }
            }
        }
        if !progress {
            break;
        }
    }
    report.waiting = queues.values().flatten().map(|(_, path)| path.clone()).filter(|p| !report.quarantined.contains(p)).collect();
    Ok(())
}

/// Records another device's name from its info file, the first time it's seen.
fn remember_peer_name(conn: &Connection, target: &dyn SyncTarget, key: &VaultKey, device: &str) -> Result<(), String> {
    let known: bool = conn
        .query_row("SELECT name IS NOT NULL FROM sync_peers WHERE device_id = ?1", [device], |r| r.get(0))
        .optional()
        .map_err(err)?
        .unwrap_or(false);
    if known {
        return Ok(());
    }
    let path = info_path(device);
    let Some(sealed) = target.get(&path)? else { return Ok(()) };
    let Ok(plain) = crypto::open(key, &path, &sealed) else { return Ok(()) };
    let name = serde_json::from_slice::<Value>(&plain).ok().and_then(|v| v["name"].as_str().map(str::to_string));
    conn.execute(
        "INSERT INTO sync_peers (device_id, name) VALUES (?1, ?2) ON CONFLICT(device_id) DO UPDATE SET name = excluded.name",
        rusqlite::params![device, name],
    )
    .map_err(err)?;
    Ok(())
}

fn parse_heads(text: &str) -> Vec<ChangeHash> {
    serde_json::from_str::<Vec<String>>(text).unwrap_or_default().iter().filter_map(|h| h.parse().ok()).collect()
}

fn heads_json(heads: &[ChangeHash]) -> String {
    serde_json::to_string(&heads.iter().map(|h| h.to_string()).collect::<Vec<_>>()).unwrap_or_else(|_| "[]".into())
}

#[allow(clippy::too_many_arguments)]
fn push(
    conn: &Connection,
    target: &dyn SyncTarget,
    key: &VaultKey,
    me: &str,
    device_files: &[RemoteFile],
    options: &SyncOptions,
    report: &mut SyncReport,
) -> Result<(), String> {
    crdt::reconcile_dirty(conn)?;
    let actor = crdt::device_actor(conn)?;
    let docs: Vec<(String, String)> = conn
        .prepare("SELECT doc_id, synced_heads FROM crdt_docs ORDER BY doc_id")
        .map_err(err)?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;

    let mut upload: Vec<(String, Vec<u8>, Vec<ChangeHash>)> = Vec::new();
    let mut caught_up: Vec<(String, Vec<ChangeHash>)> = Vec::new();
    for (doc_id, synced) in docs {
        let synced = parse_heads(&synced);
        let Some(mut doc) = crdt::load_doc(conn, &doc_id)? else { continue };
        let heads = doc.get_heads();
        if heads.iter().collect::<BTreeSet<_>>() == synced.iter().collect::<BTreeSet<_>>() {
            continue;
        }
        if doc.get_changes(&synced).iter().any(|c| c.actor_id() == &actor) {
            let bytes = if synced.is_empty() { doc.save() } else { doc.save_after(&synced) };
            upload.push((doc_id, bytes, heads));
        } else {
            caught_up.push((doc_id, heads)); // only others' changes: nothing to share
        }
    }

    if !upload.is_empty() {
        // Never reuse a number already in the cloud — if the last upload
        // succeeded but recording it didn't, its file is there and other
        // devices may have applied it.
        let remote_max = device_files
            .iter()
            .filter_map(|f| parse_changes_path(&f.path))
            .filter(|(device, _)| device == me)
            .map(|(_, seq)| seq)
            .max()
            .unwrap_or(0);
        let recorded: i64 = conn.query_row("SELECT upload_seq FROM sync_settings WHERE id = 1", [], |r| r.get(0)).map_err(err)?;
        let seq = remote_max.max(recorded as u64) + 1;
        let path = changes_path(me, seq);
        let docs: serde_json::Map<String, Value> =
            upload.iter().map(|(id, bytes, _)| (id.clone(), Value::from(b64().encode(bytes)))).collect();
        let bundle = json!({ "format": BUNDLE_FORMAT, "device": me, "seq": seq, "docs": docs });
        target.put(&path, &crypto::seal(key, &path, bundle.to_string().as_bytes())?)?;

        in_transaction(conn, || {
            conn.execute("UPDATE sync_settings SET upload_seq = ?1 WHERE id = 1", [seq as i64]).map_err(err)?;
            for (doc_id, _, heads) in &upload {
                conn.execute("UPDATE crdt_docs SET synced_heads = ?1 WHERE doc_id = ?2", rusqlite::params![heads_json(heads), doc_id])
                    .map_err(err)?;
            }
            Ok(())
        })?;
        report.uploaded = Some(seq);

        let info_path = info_path(me);
        let info = json!({ "name": options.device_name, "lastSyncAt": now_ms() });
        target.put(&info_path, &crypto::seal(key, &info_path, info.to_string().as_bytes())?)?;
    }
    for (doc_id, heads) in caught_up {
        conn.execute("UPDATE crdt_docs SET synced_heads = ?1 WHERE doc_id = ?2", rusqlite::params![heads_json(&heads), doc_id])
            .map_err(err)?;
    }
    Ok(())
}

fn write_ack(conn: &Connection, target: &dyn SyncTarget, key: &VaultKey, me: &str) -> Result<(), String> {
    let applied: serde_json::Map<String, Value> = conn
        .prepare("SELECT device_id, applied_seq FROM sync_peers ORDER BY device_id")
        .map_err(err)?
        .query_map([], |r| Ok((r.get::<_, String>(0)?, Value::from(r.get::<_, i64>(1)?))))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let path = ack_path(me);
    target.put(&path, &crypto::seal(key, &path, json!({ "applied": applied }).to_string().as_bytes())?)
}

// ------------------------------------------------------------ attachments

fn sync_blobs(conn: &Connection, target: &dyn SyncTarget, key: &VaultKey, report: &mut SyncReport) -> Result<(), String> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM attachments", [], |r| r.get(0)).map_err(err)?;
    if count == 0 {
        return Ok(());
    }
    let dir = store::attachments_dir(conn)?;

    // Attachments saved before hashes were recorded get theirs now (the
    // update is queued for the next push like any other write).
    let unhashed: Vec<(String, String)> = conn
        .prepare("SELECT id, relative_path FROM attachments WHERE sha256 IS NULL")
        .map_err(err)?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    for (id, rel) in unhashed {
        if let Ok(bytes) = std::fs::read(dir.join(&rel)) {
            conn.execute("UPDATE attachments SET sha256 = ?1 WHERE id = ?2", rusqlite::params![store::sha256_hex(&bytes), id])
                .map_err(err)?;
        }
    }

    let mut remote: BTreeSet<String> = target
        .list("blobs/")?
        .into_iter()
        .filter_map(|f| f.path.strip_prefix("blobs/").and_then(|p| p.strip_suffix(".enc")).map(str::to_string))
        .collect();
    let rows: Vec<(String, String)> = conn
        .prepare("SELECT sha256, relative_path FROM attachments WHERE sha256 IS NOT NULL ORDER BY id")
        .map_err(err)?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;

    for (sha, rel) in &rows {
        let local: PathBuf = dir.join(rel);
        if local.exists() {
            if !remote.contains(sha) {
                let bytes = std::fs::read(&local).map_err(err)?;
                let path = blob_path(sha);
                target.put(&path, &crypto::seal(key, &path, &bytes)?)?;
                remote.insert(sha.clone());
                report.blobs_uploaded += 1;
            }
        } else if remote.contains(sha) {
            let path = blob_path(sha);
            let downloaded = target
                .get(&path)?
                .ok_or_else(|| format!("{path} disappeared"))
                .and_then(|sealed| crypto::open(key, &path, &sealed))
                .and_then(|bytes| {
                    if store::sha256_hex(&bytes) == *sha { Ok(bytes) } else { Err(format!("{path}: contents don't match its hash")) }
                });
            match downloaded {
                Ok(bytes) => {
                    let tmp = dir.join(format!("{rel}.flownote-tmp"));
                    std::fs::write(&tmp, &bytes).and_then(|_| std::fs::rename(&tmp, &local)).map_err(err)?;
                    release_quarantine(conn, &path)?;
                    report.blobs_downloaded += 1;
                }
                Err(e) => {
                    quarantine(conn, &path, &e)?;
                    report.quarantined.push(path);
                }
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- backups

/// Copies the database to `backups/` next to it before the first sync and
/// then at most daily, keeping the newest few. A backup restored onto a
/// *different* device must not keep this device's id (sync_settings) — see
/// `crdt::device_id`.
fn backup_if_due(conn: &Connection) -> Result<(), String> {
    let Some(db_path) = conn.path().filter(|p| !p.is_empty()) else { return Ok(()) };
    let last: Option<i64> =
        conn.query_row("SELECT last_backup_at FROM sync_settings WHERE id = 1", [], |r| r.get(0)).map_err(err)?;
    let now = now_ms();
    if last.is_some_and(|t| now - t < BACKUP_INTERVAL_MS) {
        return Ok(());
    }
    let dir = std::path::Path::new(db_path).parent().ok_or("database path has no parent directory")?.join("backups");
    std::fs::create_dir_all(&dir).map_err(err)?;
    let file = dir.join(format!("flownote-{now}.sqlite3"));
    conn.execute("VACUUM INTO ?1", [file.to_string_lossy()]).map_err(|e| format!("backup failed: {e}"))?;

    let mut backups: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map_err(err)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("flownote-")))
        .collect();
    backups.sort();
    while backups.len() > BACKUPS_KEPT {
        let _ = std::fs::remove_file(backups.remove(0));
    }
    conn.execute("UPDATE sync_settings SET last_backup_at = ?1 WHERE id = 1", [now]).map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests;
