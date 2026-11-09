use super::*;
use crate::store;
use std::path::PathBuf;

const FAST_KDF: KdfParams = KdfParams { memory_kib: 256, iterations: 1, parallelism: 1 };
const PASS: &str = "correct horse battery";

fn fast() -> Timing {
    Timing {
        poll: Duration::from_millis(20),
        after_edit: Duration::from_millis(50),
        interval: Duration::from_secs(3600),
        retry: Duration::from_secs(3600),
    }
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("flownote-svc-{}-{}-{name}", std::process::id(), uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// One running app: its own database file, sync service and event log.
struct App {
    dir: PathBuf,
    pool: Pool<SqliteConnectionManager>,
    events: Arc<Mutex<Vec<Value>>>,
    sync: Option<SyncService>,
}

impl App {
    fn new(name: &str) -> App {
        Self::with_timing(name, fast())
    }

    fn with_timing(name: &str, timing: Timing) -> App {
        let dir = temp_dir(name);
        let pool = crate::db::open(dir.join("flownote.sqlite3").to_str().unwrap()).unwrap();
        let events: Arc<Mutex<Vec<Value>>> = Arc::default();
        let log = events.clone();
        let sync = SyncService::start_with(pool.clone(), Arc::new(move |e| log.lock().unwrap().push(e)), timing, FAST_KDF).unwrap();
        App { dir, pool, events, sync: Some(sync) }
    }

    fn sync(&self) -> &SyncService {
        self.sync.as_ref().unwrap()
    }

    fn conn(&self) -> r2d2::PooledConnection<SqliteConnectionManager> {
        self.pool.get().unwrap()
    }

    fn join(&self, folder: &Path) {
        self.sync().configure(&json!({ "target": "folder", "folderPath": folder.to_str().unwrap() })).unwrap();
        self.sync().connect(PASS).unwrap();
    }

    fn events_of(&self, kind: &str) -> Vec<Value> {
        self.events.lock().unwrap().iter().filter(|e| e["type"] == kind).cloned().collect()
    }

    /// Waits up to 10 s for `check` to hold.
    fn wait_for(&self, what: &str, check: impl Fn(&App) -> bool) {
        let start = Instant::now();
        while !check(self) {
            assert!(start.elapsed() < Duration::from_secs(10), "timed out waiting for {what}; events: {:#?}", self.events.lock().unwrap());
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    fn wait_idle(&self) {
        self.wait_for("an idle sync status", |a| {
            let s = a.sync().status().unwrap();
            s["state"] == "idle" && s["lastSyncAt"].is_i64()
        });
    }
}

impl Drop for App {
    fn drop(&mut self) {
        self.sync.take(); // stop the worker before the files go
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn write_note(conn: &Connection, page: &str, seg: &str, text: &str) {
    store::save_folder(conn, &json!({ "id": "f1", "name": "Notes" })).unwrap();
    store::save_page(conn, &json!({ "id": page, "folderId": "f1", "title": "Ideas" })).unwrap();
    let content = json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }] });
    store::save_segment(conn, &json!({ "id": seg, "pageId": page, "x": 0, "y": 0, "w": 200, "h": 40, "content": content })).unwrap();
}

fn texts(conn: &Connection, page: &str) -> Vec<String> {
    let mut t: Vec<String> =
        store::list_segments(conn, page).unwrap().iter().map(|s| store::flatten_tiptap_text(&s["content"])).collect();
    t.sort();
    t
}

#[test]
fn status_follows_setup_without_exposing_the_key() {
    let cloud = temp_dir("cloud");
    let app = App::new("a");
    let s = app.sync().status().unwrap();
    assert_eq!(s["state"], "off");
    assert_eq!(s["target"], "none");
    assert!(!s["deviceName"].as_str().unwrap().is_empty(), "a default device name is filled in");

    let s = app.sync().configure(&json!({ "target": "folder", "folderPath": cloud.to_str().unwrap(), "deviceName": "Laptop" })).unwrap();
    assert_eq!(s["state"], "needsPassphrase");
    assert_eq!(s["folderPath"], cloud.to_str().unwrap());
    assert_eq!(s["deviceName"], "Laptop");

    app.sync().connect(PASS).unwrap();
    app.wait_idle();
    let s = app.sync().status().unwrap();
    assert_eq!(s["connected"], true);
    assert!(cloud.join("vault.json").exists());
    let text = s.to_string();
    let key: String = app.conn().query_row("SELECT vault_key FROM sync_settings", [], |r| r.get(0)).unwrap();
    assert!(!text.contains(&key), "status leaks the vault key: {text}");
    assert!(app.events_of("status").iter().any(|e| e["status"]["state"] == "syncing"));
    std::fs::remove_dir_all(&cloud).ok();
}

#[test]
fn bad_settings_are_refused() {
    let app = App::new("a");
    assert!(app.sync().configure(&json!({ "target": "folder", "folderPath": "relative/path" })).unwrap_err().contains("full path"));
    assert!(app.sync().configure(&json!({ "target": "folder", "folderPath": "/no/such/flownote/dir" })).unwrap_err().contains("no folder"));
    assert!(app.sync().configure(&json!({ "target": "onedrive" })).unwrap_err().contains("isn't available"));
    assert!(app.sync().configure(&json!({ "deviceName": "  " })).unwrap_err().contains("empty"));
    assert!(app.sync().connect(PASS).unwrap_err().contains("Choose where to sync"));
}

#[test]
fn an_edit_reaches_the_other_device_by_itself() {
    let cloud = temp_dir("cloud");
    let (a, b) = (App::new("a"), App::new("b"));
    write_note(&a.conn(), "p1", "s1", "hello");
    a.join(&cloud);
    a.wait_idle();
    b.join(&cloud);
    b.wait_for("A's note on B", |b| texts(&b.conn(), "p1") == ["hello"]);
    // The rows are committed a moment before the cycle ends and reports them.
    b.wait_for("the docsChanged event", |b| !b.events_of("docsChanged").is_empty());
    let changed = b.events_of("docsChanged");
    assert!(changed.iter().any(|e| e["folders"] == true), "{changed:?}");
    assert!(changed.iter().any(|e| e["pageIds"].as_array().unwrap().contains(&json!("p1"))), "{changed:?}");

    // A uploads its next edit without "Sync now": the worker finds it in the
    // outbox. (B's interval is an hour here, so B is nudged by hand; the
    // interval itself is the next test.)
    let seq = |a: &App| a.conn().query_row("SELECT upload_seq FROM sync_settings", [], |r| r.get::<_, i64>(0)).unwrap();
    let before = seq(&a);
    write_note(&a.conn(), "p1", "s2", "second");
    a.wait_for("A to upload its edit", |a| seq(a) > before);
    b.sync().sync_now().unwrap();
    b.wait_for("the edit on B", |b| texts(&b.conn(), "p1") == ["hello", "second"]);
    std::fs::remove_dir_all(&cloud).ok();
}

#[test]
fn the_interval_picks_up_other_devices_changes() {
    let cloud = temp_dir("cloud");
    let a = App::new("a");
    let b = App::with_timing("b", Timing { interval: Duration::from_millis(100), ..fast() });
    a.join(&cloud);
    a.wait_idle();
    b.join(&cloud);
    b.wait_idle();
    write_note(&a.conn(), "p1", "s1", "from a");
    b.wait_for("A's note on B without Sync now", |b| texts(&b.conn(), "p1") == ["from a"]);
    std::fs::remove_dir_all(&cloud).ok();
}

#[test]
fn a_wrong_passphrase_says_so_and_leaves_sync_off() {
    let cloud = temp_dir("cloud");
    let (a, b) = (App::new("a"), App::new("b"));
    a.join(&cloud);
    a.wait_idle();
    b.sync().configure(&json!({ "target": "folder", "folderPath": cloud.to_str().unwrap() })).unwrap();
    let e = b.sync().connect("not it").unwrap_err();
    assert!(e.starts_with("Wrong passphrase"), "{e}");
    assert_eq!(b.sync().status().unwrap()["state"], "needsPassphrase");
    std::fs::remove_dir_all(&cloud).ok();
}

#[test]
fn a_missing_folder_is_reported_and_retried_later() {
    let cloud = temp_dir("cloud");
    let app = App::new("a");
    app.join(&cloud);
    app.wait_idle();
    std::fs::remove_dir_all(&cloud).unwrap();
    app.sync().sync_now().unwrap();
    app.wait_for("an error status", |a| a.sync().status().unwrap()["state"] == "error");
    let s = app.sync().status().unwrap();
    assert!(s["lastError"].as_str().unwrap().contains("isn't there"), "{s}");

    std::fs::create_dir_all(&cloud).unwrap();
    // The vault.json is gone with the folder, so the engine refuses to mix in
    // a new one — reported, not "fixed" by starting over.
    app.sync().sync_now().unwrap();
    app.wait_for("the vault error", |a| a.sync().status().unwrap()["lastError"].as_str().is_some_and(|e| e.contains("vault.json")));
    std::fs::remove_dir_all(&cloud).ok();
}

#[test]
fn disconnect_keeps_the_notes_and_reconnecting_carries_on() {
    let cloud = temp_dir("cloud");
    let app = App::new("a");
    write_note(&app.conn(), "p1", "s1", "kept");
    app.join(&cloud);
    app.wait_idle();
    let s = app.sync().disconnect().unwrap();
    assert_eq!(s["state"], "off");
    assert_eq!(s["connected"], false);
    assert_eq!(texts(&app.conn(), "p1"), ["kept"]);
    let key: Option<String> = app.conn().query_row("SELECT vault_key FROM sync_settings", [], |r| r.get(0)).unwrap();
    assert!(key.is_none(), "the key is forgotten");

    app.join(&cloud);
    app.wait_idle();
    assert_eq!(app.sync().status().unwrap()["lastError"], Value::Null);
    std::fs::remove_dir_all(&cloud).ok();
}

#[test]
fn a_mass_delete_is_held_until_confirmed() {
    let cloud = temp_dir("cloud");
    let (a, b) = (App::new("a"), App::new("b"));
    {
        let conn = a.conn();
        store::save_folder(&conn, &json!({ "id": "f1", "name": "Notes" })).unwrap();
        for i in 0..6 {
            store::save_page(&conn, &json!({ "id": format!("p{i}"), "folderId": "f1", "title": format!("Page {i}") })).unwrap();
        }
    }
    a.join(&cloud);
    a.wait_idle();
    b.join(&cloud);
    b.wait_for("B to have the pages", |b| store::list_pages(&b.conn(), "f1").unwrap().len() == 6);

    store::delete_folder(&a.conn(), "f1").unwrap();
    a.sync().sync_now().unwrap();
    a.wait_for("A to upload the delete", |a| a.conn().query_row("SELECT COUNT(*) FROM sync_outbox", [], |r| r.get::<_, i64>(0)).unwrap() == 0);
    a.wait_idle();
    b.sync().sync_now().unwrap();
    b.wait_for("the held-back delete", |b| b.sync().status().unwrap()["state"] == "heldBack");
    let held = b.sync().status().unwrap()["heldBack"].clone();
    assert_eq!(held["pagesDeleted"], 6, "{held}");
    assert_eq!(store::list_pages(&b.conn(), "f1").unwrap().len(), 6, "nothing deleted yet");

    b.sync().confirm_mass_delete().unwrap();
    b.wait_for("the delete applied", |b| store::list_pages(&b.conn(), "f1").unwrap().is_empty());
    b.wait_idle();
    assert_eq!(b.sync().status().unwrap()["heldBack"], Value::Null);
    std::fs::remove_dir_all(&cloud).ok();
}

#[test]
fn stopping_the_service_ends_its_worker() {
    let app = App::new("a");
    let started = Instant::now();
    drop(app);
    assert!(started.elapsed() < Duration::from_secs(2));
}
