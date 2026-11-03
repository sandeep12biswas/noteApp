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
}
