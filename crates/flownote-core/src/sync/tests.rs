use super::*;
use crate::merge::tests::dump;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

/// Cheap key derivation so tests run fast; real vaults use the default.
const FAST: KdfParams = KdfParams { memory_kib: 256, iterations: 1, parallelism: 1 };
const PASS: &str = "correct horse battery";

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("flownote-sync-{}-{}-{name}", std::process::id(), uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// One device: a real database file (attachments and backups need one).
struct Device {
    conn: Connection,
    dir: PathBuf,
    key: Option<VaultKey>,
    name: String,
}

impl Device {
    fn new(name: &str) -> Device {
        let dir = temp_dir(name);
        let mut conn = Connection::open(dir.join("flownote.sqlite3")).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        crate::migrations::run(&mut conn).unwrap();
        Device { conn, dir, key: None, name: name.to_string() }
    }

    fn connect(&mut self, target: &dyn SyncTarget) {
        self.key = Some(connect_vault(&self.conn, target, PASS, FAST).unwrap());
    }

    fn sync_with(&self, target: &dyn SyncTarget, options: SyncOptions) -> SyncReport {
        sync_once(&self.conn, target, self.key.as_ref().unwrap(), &SyncOptions { device_name: self.name.clone(), ..options }).unwrap()
    }

    fn sync(&self, target: &dyn SyncTarget) -> SyncReport {
        self.sync_with(target, SyncOptions::default())
    }
}

impl Drop for Device {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn doc_text(text: &str) -> Value {
    json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }] })
}

fn save_seg(conn: &Connection, id: &str, page_id: &str, text: &str) {
    store::save_segment(conn, &json!({ "id": id, "pageId": page_id, "x": 0, "y": 0, "w": 200, "h": 40, "content": doc_text(text) })).unwrap();
}

fn notebook(conn: &Connection) {
    store::save_folder(conn, &json!({ "id": "f1", "name": "Notes" })).unwrap();
    store::save_page(conn, &json!({ "id": "p1", "folderId": "f1", "title": "Ideas" })).unwrap();
    save_seg(conn, "s1", "p1", "hello");
}

fn texts(conn: &Connection, page_id: &str) -> Vec<String> {
    let mut t: Vec<String> =
        store::list_segments(conn, page_id).unwrap().iter().map(|s| store::flatten_tiptap_text(&s["content"])).collect();
    t.sort();
    t
}

/// Syncs every device until nothing moves, like several cycles would.
fn settle(devices: &[&Device], target: &dyn SyncTarget) {
    for _ in 0..4 {
        for d in devices {
            d.sync(target);
        }
    }
}

#[test]
fn three_devices_converge() {
    let cloud_dir = temp_dir("cloud");
    let cloud = LocalFolderTarget::new(&cloud_dir);
    let (mut a, mut b, mut c) = (Device::new("a"), Device::new("b"), Device::new("c"));
    notebook(&a.conn);
    a.connect(&cloud);
    a.sync(&cloud);
    b.connect(&cloud);
    c.connect(&cloud);
    settle(&[&a, &b, &c], &cloud);
    assert_eq!(texts(&c.conn, "p1"), ["hello"]);

    // Edits everywhere, some concurrent.
    save_seg(&a.conn, "s2", "p1", "from a");
    save_seg(&b.conn, "s1", "p1", "hello, edited on b");
    store::save_page(&c.conn, &json!({ "id": "p2", "folderId": "f1", "title": "From C" })).unwrap();
    save_seg(&c.conn, "s3", "p2", "from c");
    settle(&[&a, &b, &c], &cloud);

    assert_eq!(dump(&a.conn), dump(&b.conn));
    assert_eq!(dump(&a.conn), dump(&c.conn));
    assert_eq!(texts(&a.conn, "p1"), ["from a", "hello, edited on b"]);
    assert_eq!(texts(&b.conn, "p2"), ["from c"]);
    std::fs::remove_dir_all(&cloud_dir).ok();
}

#[test]
fn the_second_device_needs_the_right_passphrase() {
    let cloud = MemoryTarget::default();
    let mut a = Device::new("a");
    a.connect(&cloud);
    let b = Device::new("b");
    assert_eq!(connect_vault(&b.conn, &cloud, "wrong", FAST).unwrap_err(), ConnectError::WrongPassphrase);
    assert!(stored_vault_key(&b.conn).unwrap().is_none());
    let key = connect_vault(&b.conn, &cloud, PASS, FAST).unwrap();
    assert_eq!(Some(key), stored_vault_key(&a.conn).unwrap(), "same vault, same key");
}

#[test]
fn the_cloud_only_ever_holds_ciphertext() {
    let cloud = MemoryTarget::default();
    let mut a = Device::new("a");
    notebook(&a.conn);
    store::save_folder(&a.conn, &json!({ "id": "f2", "name": "Secret Folder Name" })).unwrap();
    a.connect(&cloud);
    a.sync(&cloud);
    let files = cloud.list("").unwrap();
    assert!(files.len() >= 3, "{files:?}");
    for file in files {
        let bytes = cloud.get(&file.path).unwrap().unwrap();
        if file.path == VAULT_PATH {
            continue;
        }
        assert!(bytes.starts_with(b"FNE1"), "{} isn't encrypted", file.path);
        let text = String::from_utf8_lossy(&bytes);
        assert!(!text.contains("hello") && !text.contains("Secret Folder Name"), "{} leaks plaintext", file.path);
    }
}

#[test]
fn a_device_with_nothing_new_uploads_nothing() {
    let cloud = MemoryTarget::default();
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    notebook(&a.conn);
    a.connect(&cloud);
    b.connect(&cloud);
    assert_eq!(a.sync(&cloud).uploaded, Some(1));
    let report = b.sync(&cloud);
    assert_eq!(report.applied.len(), 1);
    assert_eq!(report.uploaded, None, "b only received; it doesn't re-upload a's changes");
    assert_eq!(a.sync(&cloud).applied, vec![], "and a has nothing new to apply");
    assert_eq!(b.sync(&cloud).uploaded, None);
}

#[test]
fn notes_already_on_both_devices_are_merged_on_first_sync() {
    let cloud = MemoryTarget::default();
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    notebook(&a.conn);
    store::save_folder(&b.conn, &json!({ "id": "fb", "name": "B's notes" })).unwrap();
    store::save_page(&b.conn, &json!({ "id": "pb", "folderId": "fb", "title": "Mine" })).unwrap();
    save_seg(&b.conn, "sb", "pb", "written on b before sync");
    // Pretend these were written before sync existed: nothing queued.
    b.conn.execute("DELETE FROM sync_outbox", []).unwrap();
    a.connect(&cloud);
    b.connect(&cloud);
    settle(&[&a, &b], &cloud);
    assert_eq!(dump(&a.conn), dump(&b.conn));
    assert_eq!(texts(&a.conn, "pb"), ["written on b before sync"]);
    assert_eq!(texts(&b.conn, "p1"), ["hello"]);
}

/// Fails the next `put` when asked to.
struct Flaky<'a> {
    inner: &'a dyn SyncTarget,
    fail_next_put: AtomicBool,
}

impl SyncTarget for Flaky<'_> {
    fn list(&self, prefix: &str) -> Result<Vec<RemoteFile>, String> {
        self.inner.list(prefix)
    }
    fn get(&self, path: &str) -> Result<Option<Vec<u8>>, String> {
        self.inner.get(path)
    }
    fn put(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        if self.fail_next_put.swap(false, Ordering::SeqCst) {
            return Err("network went away".into());
        }
        self.inner.put(path, bytes)
    }
    fn delete(&self, path: &str) -> Result<(), String> {
        self.inner.delete(path)
    }
}

#[test]
fn a_failed_upload_is_retried_without_losing_anything() {
    let memory = MemoryTarget::default();
    let cloud = Flaky { inner: &memory, fail_next_put: AtomicBool::new(false) };
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    a.connect(&cloud);
    b.connect(&cloud);
    notebook(&a.conn);
    cloud.fail_next_put.store(true, Ordering::SeqCst);
    let error = sync_once(&a.conn, &cloud, a.key.as_ref().unwrap(), &SyncOptions::default()).unwrap_err();
    assert!(error.contains("network went away"));
    let recorded: Option<String> = a.conn.query_row("SELECT last_error FROM sync_settings", [], |r| r.get(0)).unwrap();
    assert_eq!(recorded.as_deref(), Some(error.as_str()));
    assert!(memory.list("devices/").unwrap().is_empty(), "nothing half-uploaded");

    assert_eq!(a.sync(&cloud).uploaded, Some(1));
    b.sync(&cloud);
    assert_eq!(texts(&b.conn, "p1"), ["hello"]);
}

#[test]
fn an_upload_that_was_not_recorded_is_not_lost() {
    let cloud = MemoryTarget::default();
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    a.connect(&cloud);
    b.connect(&cloud);
    notebook(&a.conn);
    a.sync(&cloud);
    b.sync(&cloud); // b applied a's file 1
    // a crashed after uploading but before recording it.
    a.conn.execute("UPDATE sync_settings SET upload_seq = 0", []).unwrap();
    a.conn.execute("UPDATE crdt_docs SET synced_heads = '[]'", []).unwrap();
    save_seg(&a.conn, "s2", "p1", "after the crash");
    assert_eq!(a.sync(&cloud).uploaded, Some(2), "a new number, never file 1 again");
    b.sync(&cloud);
    assert_eq!(texts(&b.conn, "p1"), ["after the crash", "hello"]);
    assert_eq!(dump(&a.conn), dump(&b.conn));
}

#[test]
fn a_damaged_file_is_quarantined_and_later_ones_wait_behind_it() {
    let cloud = MemoryTarget::default();
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    a.connect(&cloud);
    b.connect(&cloud);
    notebook(&a.conn);
    a.sync(&cloud);
    save_seg(&a.conn, "s2", "p1", "second");
    a.sync(&cloud);

    let me_a = crdt::device_id(&a.conn).unwrap();
    let first = changes_path(&me_a, 1);
    let good = cloud.get(&first).unwrap().unwrap();
    let mut damaged = good.clone();
    let last = damaged.len() - 1;
    damaged[last] ^= 0xff;
    cloud.put(&first, &damaged).unwrap();

    let report = b.sync(&cloud);
    assert_eq!(report.quarantined, std::slice::from_ref(&first));
    assert_eq!(report.waiting, [changes_path(&me_a, 2)]);
    assert!(report.applied.is_empty());
    assert_eq!(dump(&b.conn)["pages"], json!([]), "nothing applied out of order");
    let held: i64 = b.conn.query_row("SELECT COUNT(*) FROM sync_quarantine", [], |r| r.get(0)).unwrap();
    assert_eq!(held, 1);

    // The file reads correctly again (e.g. a sync client finished writing it).
    cloud.put(&first, &good).unwrap();
    let report = b.sync(&cloud);
    assert_eq!(report.applied.len(), 2);
    assert_eq!(texts(&b.conn, "p1"), ["hello", "second"]);
    let held: i64 = b.conn.query_row("SELECT COUNT(*) FROM sync_quarantine", [], |r| r.get(0)).unwrap();
    assert_eq!(held, 0);
}

/// Hides files under a prefix, as if they hadn't arrived yet.
struct Hiding<'a> {
    inner: &'a dyn SyncTarget,
    hidden: Mutex<Option<String>>,
}

impl SyncTarget for Hiding<'_> {
    fn list(&self, prefix: &str) -> Result<Vec<RemoteFile>, String> {
        let hidden = self.hidden.lock().unwrap().clone();
        Ok(self.inner.list(prefix)?.into_iter().filter(|f| hidden.as_ref().is_none_or(|h| !f.path.starts_with(h))).collect())
    }
    fn get(&self, path: &str) -> Result<Option<Vec<u8>>, String> {
        self.inner.get(path)
    }
    fn put(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        self.inner.put(path, bytes)
    }
    fn delete(&self, path: &str) -> Result<(), String> {
        self.inner.delete(path)
    }
}

#[test]
fn a_bundle_waits_for_the_changes_it_builds_on() {
    let memory = MemoryTarget::default();
    let cloud = Hiding { inner: &memory, hidden: Mutex::new(None) };
    let (mut a, mut b, mut c) = (Device::new("a"), Device::new("b"), Device::new("c"));
    for d in [&mut a, &mut b, &mut c] {
        d.connect(&cloud);
    }
    notebook(&a.conn);
    a.sync(&cloud);
    b.sync(&cloud);
    save_seg(&b.conn, "s1", "p1", "hello from b"); // builds on a's segment
    b.sync(&cloud);

    // c sees b's file before a's has arrived.
    *cloud.hidden.lock().unwrap() = Some(format!("devices/{}/", crdt::device_id(&a.conn).unwrap()));
    let report = c.sync(&cloud);
    assert!(report.applied.is_empty());
    assert_eq!(report.waiting.len(), 1);
    assert_eq!(dump(&c.conn)["segments"], json!([]));

    *cloud.hidden.lock().unwrap() = None;
    let report = c.sync(&cloud);
    assert_eq!(report.applied.len(), 2);
    assert_eq!(texts(&c.conn, "p1"), ["hello from b"]);
}

#[test]
fn a_mass_delete_waits_for_confirmation() {
    let cloud = MemoryTarget::default();
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    store::save_folder(&a.conn, &json!({ "id": "f1", "name": "Notes" })).unwrap();
    for i in 0..10 {
        store::save_page(&a.conn, &json!({ "id": format!("p{i}"), "folderId": "f1", "title": format!("Page {i}") })).unwrap();
    }
    a.connect(&cloud);
    b.connect(&cloud);
    settle(&[&a, &b], &cloud);
    for i in 0..8 {
        store::delete_page(&b.conn, &format!("p{i}")).unwrap();
    }
    b.sync(&cloud);

    let report = a.sync(&cloud);
    let held = report.held_back.expect("held back");
    assert_eq!((held.pages_deleted, held.pages_total), (8, 10));
    assert_eq!(dump(&a.conn)["pages"].as_array().unwrap().len(), 10, "nothing deleted yet");
    // Still held on the next ordinary cycle.
    assert!(a.sync(&cloud).held_back.is_some());

    let report = a.sync_with(&cloud, SyncOptions { allow_mass_delete: true, ..Default::default() });
    assert!(report.held_back.is_none());
    assert_eq!(dump(&a.conn)["pages"].as_array().unwrap().len(), 2);
}

#[test]
fn attachments_travel_as_encrypted_blobs() {
    let cloud = MemoryTarget::default();
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    notebook(&a.conn);
    let photo = b"\x89PNG not really a photo".to_vec();
    store::save_attachment(
        &a.conn,
        &json!({ "id": "att1", "segmentId": "s1", "fileName": "photo.png", "mimeType": "image/png", "dataBase64": b64().encode(&photo) }),
    )
    .unwrap();
    a.connect(&cloud);
    b.connect(&cloud);
    assert_eq!(a.sync(&cloud).blobs_uploaded, 1);
    let blob = cloud.get(&blob_path(&store::sha256_hex(&photo))).unwrap().unwrap();
    assert!(blob.starts_with(b"FNE1") && !blob.windows(4).any(|w| w == b"PNG "));

    assert_eq!(b.sync(&cloud).blobs_downloaded, 1);
    let path = store::get_attachment(&b.conn, "att1").unwrap().unwrap()["path"].as_str().unwrap().to_string();
    assert_eq!(std::fs::read(path).unwrap(), photo);
    assert_eq!(a.sync(&cloud).blobs_uploaded, 0, "uploaded once");
}

#[test]
fn the_database_is_backed_up_before_the_first_sync() {
    let cloud = MemoryTarget::default();
    let mut a = Device::new("a");
    notebook(&a.conn);
    a.connect(&cloud);
    a.sync(&cloud);
    a.sync(&cloud);
    let backups: Vec<PathBuf> = std::fs::read_dir(a.dir.join("backups")).unwrap().map(|e| e.unwrap().path()).collect();
    assert_eq!(backups.len(), 1, "once, not every cycle");
    let copy = Connection::open(&backups[0]).unwrap();
    let pages: i64 = copy.query_row("SELECT COUNT(*) FROM pages", [], |r| r.get(0)).unwrap();
    assert_eq!(pages, 1);
}

#[test]
fn a_missing_or_replaced_vault_stops_sync() {
    let cloud = MemoryTarget::default();
    let mut a = Device::new("a");
    notebook(&a.conn);
    a.connect(&cloud);
    a.sync(&cloud);

    let vault = cloud.get(VAULT_PATH).unwrap().unwrap();
    cloud.delete(VAULT_PATH).unwrap();
    let error = sync_once(&a.conn, &cloud, a.key.as_ref().unwrap(), &SyncOptions::default()).unwrap_err();
    assert!(error.contains("no longer has FlowNote's vault.json"), "{error}");

    let (other, _) = crypto::create_vault("someone else", FAST).unwrap();
    cloud.put(VAULT_PATH, other.to_string().as_bytes()).unwrap();
    let error = sync_once(&a.conn, &cloud, a.key.as_ref().unwrap(), &SyncOptions::default()).unwrap_err();
    assert!(error.contains("different FlowNote vault"), "{error}");

    cloud.put(VAULT_PATH, &vault).unwrap();
    a.sync(&cloud);
    assert_eq!(texts(&a.conn, "p1"), ["hello"], "local notes untouched throughout");
}

#[test]
fn peers_are_named_from_their_info_file() {
    let cloud = MemoryTarget::default();
    let (mut a, mut b) = (Device::new("Laptop"), Device::new("Phone"));
    notebook(&a.conn);
    a.connect(&cloud);
    b.connect(&cloud);
    a.sync(&cloud);
    b.sync(&cloud);
    let name: String = b.conn.query_row("SELECT name FROM sync_peers", [], |r| r.get(0)).unwrap();
    assert_eq!(name, "Laptop");
}

#[test]
fn change_file_names_parse_back() {
    assert_eq!(parse_changes_path(&changes_path("dev-1", 42)), Some(("dev-1".to_string(), 42)));
    assert_eq!(parse_changes_path("devices/dev-1/info.json.enc"), None);
    assert_eq!(parse_changes_path("devices/a/b/changes/1.bundle.enc"), None);
    assert_eq!(parse_snapshot_path(&snapshot_path("dev-1", 7)), Some(("dev-1".to_string(), 7)));
    assert_eq!(parse_changes_path(&snapshot_path("dev-1", 7)), None, "a snapshot isn't a change file");
    assert_eq!(parse_snapshot_path("devices/dev-1/info.json.enc"), None);
}

#[test]
fn reconnecting_to_the_same_vault_keeps_going() {
    let cloud = MemoryTarget::default();
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    notebook(&a.conn);
    a.connect(&cloud);
    a.sync(&cloud);
    b.connect(&cloud);
    settle(&[&a, &b], &cloud);
    let seq: i64 = a.conn.query_row("SELECT upload_seq FROM sync_settings", [], |r| r.get(0)).unwrap();

    a.connect(&cloud); // e.g. after "Disconnect", the same folder again
    let seq_after: i64 = a.conn.query_row("SELECT upload_seq FROM sync_settings", [], |r| r.get(0)).unwrap();
    assert_eq!(seq_after, seq, "same vault: numbering continues");
    save_seg(&a.conn, "s2", "p1", "after reconnect");
    settle(&[&a, &b], &cloud);
    assert_eq!(texts(&b.conn, "p1"), ["after reconnect", "hello"]);
}

#[test]
fn joining_a_new_vault_uploads_everything_including_other_devices_notes() {
    let old_cloud = MemoryTarget::default();
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    notebook(&a.conn);
    a.connect(&old_cloud);
    a.sync(&old_cloud);
    b.connect(&old_cloud);
    settle(&[&a, &b], &old_cloud);
    // A page only B ever wrote: A's own log never carried it.
    store::save_page(&b.conn, &json!({ "id": "p2", "folderId": "f1", "title": "From B" })).unwrap();
    save_seg(&b.conn, "s9", "p2", "written on b");
    settle(&[&a, &b], &old_cloud);
    assert_eq!(texts(&a.conn, "p2"), ["written on b"]);

    // A moves to a new, empty cloud; C joins it there. B never does.
    let new_cloud = MemoryTarget::default();
    a.connect(&new_cloud);
    let seq: i64 = a.conn.query_row("SELECT upload_seq FROM sync_settings", [], |r| r.get(0)).unwrap();
    assert_eq!(seq, 0, "new vault: numbering starts again");
    let peers: i64 = a.conn.query_row("SELECT COUNT(*) FROM sync_peers", [], |r| r.get(0)).unwrap();
    assert_eq!(peers, 0, "devices of the old vault are forgotten");
    a.sync(&new_cloud);
    assert!(new_cloud.get(&changes_path(&crdt::device_id(&a.conn).unwrap(), 1)).unwrap().is_some());

    let mut c = Device::new("c");
    c.connect(&new_cloud);
    settle(&[&a, &c], &new_cloud);
    assert_eq!(texts(&c.conn, "p1"), ["hello"]);
    assert_eq!(texts(&c.conn, "p2"), ["written on b"], "B's page reached C through A's log");
    assert_eq!(dump(&a.conn), dump(&c.conn));
}

// ------------------------------------------------------------ compaction (S8)

/// Compaction rules for tests: a snapshot after `files` change files, every
/// ack counted, deletion retried every cycle.
fn rules(files: usize) -> CompactRules {
    CompactRules { after_files: files, after_bytes: u64::MAX, stale_ack_ms: i64::MAX, retry_ms: 0 }
}

fn compacting(files: usize) -> SyncOptions {
    SyncOptions { compact: Some(rules(files)), ..Default::default() }
}

/// Upload numbers of `device`'s change files in the cloud.
fn change_files(cloud: &dyn SyncTarget, device: &Device) -> Vec<u64> {
    let me = crdt::device_id(&device.conn).unwrap();
    cloud.list(&format!("devices/{me}/changes/")).unwrap().iter().filter_map(|f| parse_changes_path(&f.path)).map(|(_, s)| s).collect()
}

fn snapshots(cloud: &dyn SyncTarget, device: &Device) -> Vec<u64> {
    let me = crdt::device_id(&device.conn).unwrap();
    cloud.list(&format!("devices/{me}/")).unwrap().iter().filter_map(|f| parse_snapshot_path(&f.path)).map(|(_, s)| s).collect()
}

/// `n` more edits on `device`, each uploaded as its own change file.
fn edits(device: &Device, cloud: &dyn SyncTarget, from: usize, n: usize) {
    for i in from..from + n {
        save_seg(&device.conn, &format!("e{i}"), "p1", &format!("edit {i}"));
        assert!(device.sync(cloud).uploaded.is_some());
    }
}

#[test]
fn a_grown_log_is_compacted_once_everyone_has_applied_it() {
    let cloud = MemoryTarget::default();
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    notebook(&a.conn);
    a.connect(&cloud);
    a.sync(&cloud);
    b.connect(&cloud);
    edits(&a, &cloud, 0, 3);
    assert_eq!(change_files(&cloud, &a), [1, 2, 3, 4]);
    b.sync(&cloud); // applies 1..4 and acks it

    let report = a.sync_with(&cloud, compacting(3));
    assert_eq!(report.snapshot, Some(4));
    assert_eq!(report.compacted, 4);
    assert!(change_files(&cloud, &a).is_empty());
    assert_eq!(snapshots(&cloud, &a), [4]);

    // Later edits go on as change files after the snapshot, and b keeps up.
    edits(&a, &cloud, 3, 1);
    assert_eq!(change_files(&cloud, &a), [5]);
    b.sync(&cloud);
    assert_eq!(dump(&a.conn), dump(&b.conn));

    // Below the threshold again: no new snapshot, nothing deleted.
    let report = a.sync_with(&cloud, compacting(3));
    assert_eq!((report.snapshot, report.compacted), (None, 0));
}

#[test]
fn a_new_device_joins_from_the_snapshot() {
    let cloud = MemoryTarget::default();
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    notebook(&a.conn);
    a.connect(&cloud);
    a.sync(&cloud);
    b.connect(&cloud);
    edits(&a, &cloud, 0, 4);
    b.sync(&cloud);
    a.sync_with(&cloud, compacting(3));
    edits(&a, &cloud, 4, 1); // one file after the snapshot
    assert_eq!(change_files(&cloud, &a), [6]);

    let mut c = Device::new("c");
    c.connect(&cloud);
    let report = c.sync(&cloud);
    let a_id = crdt::device_id(&a.conn).unwrap();
    assert_eq!(report.snapshots_applied, std::slice::from_ref(&a_id));
    assert_eq!(report.applied.iter().map(|(_, s)| *s).collect::<Vec<_>>(), [5, 6], "snapshot (5), then file 6");
    assert_eq!(dump(&c.conn), dump(&a.conn));
}

#[test]
fn a_device_back_after_a_long_time_catches_up_from_the_snapshot() {
    let cloud = MemoryTarget::default();
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    notebook(&a.conn);
    a.connect(&cloud);
    a.sync(&cloud);
    b.connect(&cloud);
    b.sync(&cloud); // applied a's 1, then goes away
    edits(&a, &cloud, 0, 5);

    // While b's ack is recent it holds deletion back at what b applied…
    let report = a.sync_with(&cloud, compacting(3));
    assert_eq!(report.snapshot, Some(6));
    assert_eq!(change_files(&cloud, &a), [2, 3, 4, 5, 6], "only file 1, which b applied, is gone");

    // …once it's stale (a lost device), it doesn't.
    let stale = SyncOptions { compact: Some(CompactRules { stale_ack_ms: -1, ..rules(3) }), ..Default::default() };
    assert_eq!(a.sync_with(&cloud, stale).compacted, 5);
    assert!(change_files(&cloud, &a).is_empty());

    // b returns: the files it needs are gone, the snapshot covers them.
    let report = b.sync(&cloud);
    assert_eq!(report.snapshots_applied.len(), 1);
    assert_eq!(dump(&b.conn), dump(&a.conn));
}

#[test]
fn a_held_back_deletion_is_retried_later_not_every_cycle() {
    let cloud = MemoryTarget::default();
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    notebook(&a.conn);
    a.connect(&cloud);
    a.sync(&cloud);
    b.connect(&cloud);
    b.sync(&cloud); // acks 1
    edits(&a, &cloud, 0, 3);
    let patient = SyncOptions { compact: Some(CompactRules { retry_ms: i64::MAX, ..rules(3) }), ..Default::default() };
    assert_eq!(a.sync_with(&cloud, patient.clone()).compacted, 1, "the snapshot's own cycle deletes what it can");
    b.sync(&cloud); // now acks 4
    assert_eq!(a.sync_with(&cloud, patient).compacted, 0, "not retried before retry_ms");
    assert_eq!(a.sync_with(&cloud, compacting(3)).compacted, 3, "retried once due");
}

/// Stores garbage instead of any snapshot written to it.
struct BreaksSnapshots(MemoryTarget);

impl SyncTarget for BreaksSnapshots {
    fn list(&self, prefix: &str) -> Result<Vec<RemoteFile>, String> {
        self.0.list(prefix)
    }
    fn get(&self, path: &str) -> Result<Option<Vec<u8>>, String> {
        self.0.get(path)
    }
    fn put(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        if parse_snapshot_path(path).is_some() { self.0.put(path, b"FNE1 not really") } else { self.0.put(path, bytes) }
    }
    fn delete(&self, path: &str) -> Result<(), String> {
        self.0.delete(path)
    }
}

#[test]
fn a_snapshot_that_does_not_read_back_deletes_nothing() {
    let cloud = BreaksSnapshots(MemoryTarget::default());
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    notebook(&a.conn);
    a.connect(&cloud);
    a.sync(&cloud);
    b.connect(&cloud);
    edits(&a, &cloud, 0, 3);
    b.sync(&cloud);
    let e = sync_once(&a.conn, &cloud, a.key.as_ref().unwrap(), &compacting(3)).unwrap_err();
    assert!(e.contains("snapshot doesn't read back"), "{e}");
    assert_eq!(change_files(&cloud, &a), [1, 2, 3, 4], "nothing deleted");

    // And a reader treats a broken snapshot like a broken change file.
    let mut c = Device::new("c");
    c.connect(&cloud);
    let report = c.sync(&cloud);
    assert_eq!(report.quarantined.len(), 1, "{report:?}");
    assert!(report.quarantined[0].contains("snapshot-"));
    assert!(texts(&c.conn, "p1").is_empty(), "nothing half-applied; a's files wait");
}

#[test]
fn a_mass_delete_inside_a_snapshot_still_waits_for_confirmation() {
    let cloud = MemoryTarget::default();
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    store::save_folder(&a.conn, &json!({ "id": "f1", "name": "Notes" })).unwrap();
    for i in 0..10 {
        store::save_page(&a.conn, &json!({ "id": format!("p{i}"), "folderId": "f1", "title": format!("Page {i}") })).unwrap();
    }
    a.connect(&cloud);
    b.connect(&cloud);
    settle(&[&a, &b], &cloud);
    for i in 0..8 {
        store::delete_page(&a.conn, &format!("p{i}")).unwrap();
        a.sync(&cloud);
    }
    let stale = SyncOptions { compact: Some(CompactRules { stale_ack_ms: -1, ..rules(3) }), ..Default::default() };
    a.sync_with(&cloud, stale);
    assert!(change_files(&cloud, &a).is_empty());

    let report = b.sync(&cloud);
    let held = report.held_back.expect("held back");
    assert_eq!((held.pages_deleted, held.pages_total), (8, 10));
    assert_eq!(dump(&b.conn)["pages"].as_array().unwrap().len(), 10, "nothing deleted yet");
    b.sync_with(&cloud, SyncOptions { allow_mass_delete: true, ..Default::default() });
    assert_eq!(dump(&b.conn), dump(&a.conn));
}

#[test]
fn three_devices_converge_with_two_of_them_compacting() {
    let cloud_dir = temp_dir("cloud");
    let cloud = LocalFolderTarget::new(&cloud_dir);
    let (mut a, mut b, mut c) = (Device::new("a"), Device::new("b"), Device::new("c"));
    notebook(&a.conn);
    a.connect(&cloud);
    a.sync(&cloud);
    b.connect(&cloud);
    c.connect(&cloud);
    settle(&[&a, &b, &c], &cloud);
    for round in 0..4 {
        save_seg(&a.conn, &format!("a{round}"), "p1", &format!("a {round}"));
        save_seg(&b.conn, &format!("b{round}"), "p1", &format!("b {round}"));
        save_seg(&c.conn, "s1", "p1", &format!("hello from c, round {round}"));
        a.sync_with(&cloud, compacting(2));
        b.sync_with(&cloud, compacting(2));
        c.sync(&cloud);
    }
    for _ in 0..3 {
        a.sync_with(&cloud, compacting(2));
        b.sync_with(&cloud, compacting(2));
        c.sync(&cloud);
    }
    assert!(!snapshots(&cloud, &a).is_empty() && !snapshots(&cloud, &b).is_empty());
    assert_eq!(dump(&a.conn), dump(&b.conn));
    assert_eq!(dump(&a.conn), dump(&c.conn));

    // A fourth device joining now gets the same notes from snapshots + files.
    let mut d = Device::new("d");
    d.connect(&cloud);
    settle(&[&d], &cloud);
    assert_eq!(dump(&d.conn), dump(&a.conn));
    std::fs::remove_dir_all(&cloud_dir).ok();
}

// ------------------------------------------------- device info (S8)

#[test]
fn a_device_that_only_reads_still_shows_up_and_renames_reach_the_others() {
    let cloud = MemoryTarget::default();
    let (mut a, mut b) = (Device::new("a"), Device::new("b"));
    notebook(&a.conn);
    a.connect(&cloud);
    a.sync(&cloud);
    b.connect(&cloud);
    let announce = || SyncOptions { announce: true, ..Default::default() };
    assert_eq!(b.sync_with(&cloud, announce()).uploaded, None, "b has nothing of its own to upload");
    a.sync(&cloud);
    let peer = |d: &Device| -> (Option<String>, Option<i64>) {
        d.conn.query_row("SELECT name, last_seen_at FROM sync_peers", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap()
    };
    let (name, seen) = peer(&a);
    assert_eq!(name.as_deref(), Some("b"), "b announced itself without uploading anything");
    assert!(seen.is_some());

    // Renamed while idle: a sees it on its next announce cycle…
    b.name = "b renamed".into();
    b.sync_with(&cloud, announce());
    a.sync(&cloud);
    assert_eq!(peer(&a).0.as_deref(), Some("b"), "an ordinary cycle doesn't re-read an idle device");
    a.sync_with(&cloud, announce());
    assert_eq!(peer(&a).0.as_deref(), Some("b renamed"));

    // …and right away once the renamed device uploads something.
    b.name = "b again".into();
    save_seg(&b.conn, "s2", "p1", "from b");
    b.sync(&cloud);
    a.sync(&cloud);
    assert_eq!(peer(&a).0.as_deref(), Some("b again"));
}
