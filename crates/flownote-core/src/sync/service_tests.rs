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
        Self::with_config(name, Config { timing, kdf: FAST_KDF, cloud: Cloud::from_env(), compact: CompactRules::default() })
    }

    fn with_cloud(name: &str, cloud: Cloud) -> App {
        Self::with_config(name, Config { timing: fast(), kdf: FAST_KDF, cloud, compact: CompactRules::default() })
    }

    fn with_config(name: &str, config: Config) -> App {
        let dir = temp_dir(name);
        let pool = crate::db::open(dir.join("flownote.sqlite3").to_str().unwrap()).unwrap();
        let events: Arc<Mutex<Vec<Value>>> = Arc::default();
        let log = events.clone();
        let sync = SyncService::start_with(pool.clone(), Arc::new(move |e| log.lock().unwrap().push(e)), config).unwrap();
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
    // A full path on every OS ("/no/such/…" isn't one on Windows: no drive letter).
    let missing = std::env::temp_dir().join("no").join("such").join("flownote-dir");
    assert!(app.sync().configure(&json!({ "target": "folder", "folderPath": missing.to_str().unwrap() })).unwrap_err().contains("no folder"));
    assert!(app.sync().configure(&json!({ "target": "dropbox" })).unwrap_err().contains("isn't available"));
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

// ------------------------------------------------------------- cloud (S6)

use crate::sync::fake_clouds::{self, DriveState, GraphState};

/// Where a fake cloud keeps its files, to look at in assertions.
enum FakeCloud {
    Graph(Arc<Mutex<GraphState>>),
    Drive(Arc<Mutex<DriveState>>),
}

impl FakeCloud {
    fn paths(&self) -> Vec<String> {
        match self {
            FakeCloud::Graph(s) => s.lock().unwrap().files.keys().cloned().collect(),
            FakeCloud::Drive(s) => s.lock().unwrap().paths().into_iter().map(|p| p.trim_start_matches("FlowNote/").to_string()).collect(),
        }
    }
}

fn no_cloud() -> Cloud {
    Cloud { onedrive: None, google: None, ..Cloud::from_env() }
}

fn fake_cloud(target: &str) -> (Cloud, FakeCloud) {
    let mut cloud = Cloud {
        retry: crate::sync::http::Retry { attempts: 3, base_delay: Duration::from_millis(5), max_delay: Duration::from_millis(20) },
        sign_in_timeout: Duration::from_secs(10),
        ..no_cloud()
    };
    if target == TARGET_ONEDRIVE {
        let (base, api, state) = fake_clouds::graph();
        cloud.onedrive = Some(fake_clouds::provider(&base, "OneDrive"));
        cloud.graph_api = api;
        (cloud, FakeCloud::Graph(state))
    } else {
        let (base, state) = fake_clouds::drive();
        cloud.google = Some(fake_clouds::provider(&base, "Google Drive"));
        cloud.drive_api = base;
        (cloud, FakeCloud::Drive(state))
    }
}

/// Stands in for the system browser: the user signs in and the provider
/// redirects back with a code.
fn browser(url: &str) -> Result<(), String> {
    let params: std::collections::HashMap<String, String> =
        crate::sync::http::parse_query(url.split_once('?').unwrap().1).into_iter().collect();
    let back = format!("{}?code=granted&state={}", params["redirect_uri"], params["state"]);
    std::thread::spawn(move || reqwest::blocking::get(back).unwrap());
    Ok(())
}

fn cloud_round_trip(target: &str, account: &str) {
    let (cloud, fake) = fake_cloud(target);
    let (a, b) = (App::with_cloud("a", cloud.clone()), App::with_cloud("b", cloud));
    write_note(&a.conn(), "p1", "s1", "through the cloud");

    let s = a.sync().sign_in(target, &browser).unwrap();
    assert_eq!((s["state"].as_str(), s["target"].as_str(), s["accountLabel"].as_str()), (Some("needsPassphrase"), Some(target), Some(account)));
    assert_eq!(s["signingIn"], false);
    let url = a.events_of("signIn")[0]["url"].as_str().unwrap().to_string();
    assert!(url.contains("code_challenge="), "{url}");
    let stored: String = a.conn().query_row("SELECT oauth_tokens FROM sync_settings", [], |r| r.get(0)).unwrap();
    assert!(!s.to_string().contains(fake_clouds::TOKEN) && stored.contains(fake_clouds::TOKEN), "tokens stored, never shown");

    a.sync().connect(PASS).unwrap();
    a.wait_idle();
    b.sync().sign_in(target, &browser).unwrap();
    b.sync().connect(PASS).unwrap();
    b.wait_for("A's note on B through the cloud", |b| texts(&b.conn(), "p1") == ["through the cloud"]);

    let paths = fake.paths();
    assert!(paths.contains(&"vault.json".to_string()), "{paths:?}");
    assert!(paths.iter().any(|p| p.starts_with("devices/") && p.ends_with(".bundle.enc")), "{paths:?}");
}

#[test]
fn two_devices_sync_through_onedrive() {
    cloud_round_trip(TARGET_ONEDRIVE, "test@example.com");
}

#[test]
fn two_devices_sync_through_google_drive() {
    cloud_round_trip(TARGET_GDRIVE, "test@gmail.com");
}

#[test]
fn a_revoked_sign_in_asks_for_a_new_one_and_signing_in_again_carries_on() {
    for target in [TARGET_ONEDRIVE, TARGET_GDRIVE] {
        let (cloud, _fake) = fake_cloud(target);
        let app = App::with_cloud("a", cloud);
        app.sync().sign_in(target, &browser).unwrap();
        app.sync().connect(PASS).unwrap();
        app.wait_idle();

        // The provider revoked the sign-in: the token has expired and the
        // refresh token no longer works.
        let dead = Tokens { access_token: "expired".into(), refresh_token: Some("revoked".into()), expires_at: 0 };
        app.conn().execute("UPDATE sync_settings SET oauth_tokens = ?1", [dead.to_json()]).unwrap();
        app.sync().sync_now().unwrap();
        app.wait_for("needsSignIn", |a| a.sync().status().unwrap()["state"] == "needsSignIn");
        let s = app.sync().status().unwrap();
        assert!(s["lastError"].as_str().unwrap().contains(SIGN_IN_AGAIN), "{s}");
        assert!(app.sync().connect(PASS).unwrap_err().contains("Sign in first"));

        // Same account again: no passphrase needed, syncing resumes.
        let s = app.sync().sign_in(target, &browser).unwrap();
        assert_ne!(s["state"], "needsPassphrase", "{s}");
        app.wait_idle();
        assert_eq!(app.sync().status().unwrap()["connected"], true);
    }
}

#[test]
fn a_sign_in_can_be_cancelled() {
    let (cloud, _fake) = fake_cloud(TARGET_ONEDRIVE);
    let app = App::with_cloud("a", cloud);
    std::thread::scope(|scope| {
        let waiting = scope.spawn(|| app.sync().sign_in(TARGET_ONEDRIVE, &|_| Ok(()))); // the user never finishes
        app.wait_for("the sign-in to start", |a| a.sync().status().unwrap()["signingIn"] == true && a.events_of("signIn").len() == 1);
        app.sync().cancel_sign_in().unwrap();
        assert!(waiting.join().unwrap().unwrap_err().contains("cancelled"));
    });
    let s = app.sync().status().unwrap();
    assert_eq!((s["state"].as_str(), s["signingIn"].as_bool()), (Some("off"), Some(false)));
}

#[test]
fn a_build_without_app_registrations_says_how_to_add_them() {
    let app = App::with_cloud("a", no_cloud());
    let e = app.sync().sign_in(TARGET_ONEDRIVE, &browser).unwrap_err();
    assert!(e.contains("FLOWNOTE_ONEDRIVE_CLIENT_ID") && e.contains("docs/sync-cloud-setup.md"), "{e}");
    assert!(app.sync().configure(&json!({ "target": "gdrive" })).unwrap_err().contains("FLOWNOTE_GOOGLE_CLIENT_ID"));
}

#[test]
fn the_passphrase_step_knows_whether_it_creates_or_joins_the_vault() {
    let cloud = temp_dir("cloud");
    let (a, b) = (App::new("a"), App::new("b"));
    assert_eq!(a.sync().status().unwrap()["vaultExists"], Value::Null, "nothing chosen yet");
    let s = a.sync().configure(&json!({ "target": "folder", "folderPath": cloud.to_str().unwrap() })).unwrap();
    assert_eq!(s["vaultExists"], false, "first device: creates it");
    a.sync().connect(PASS).unwrap();
    a.wait_idle();
    assert_eq!(a.sync().status().unwrap()["vaultExists"], Value::Null, "not looked up once connected");
    let s = b.sync().configure(&json!({ "target": "folder", "folderPath": cloud.to_str().unwrap() })).unwrap();
    assert_eq!(s["vaultExists"], true, "second device: joins it");
    std::fs::remove_dir_all(&cloud).ok();
}

#[test]
fn a_device_that_joins_without_notes_shows_up_and_its_rename_follows() {
    let cloud = temp_dir("cloud");
    let (a, b) = (App::new("a"), App::new("b"));
    write_note(&a.conn(), "p1", "s1", "hello");
    a.sync().configure(&json!({ "deviceName": "Laptop" })).unwrap();
    a.join(&cloud);
    a.wait_idle();
    b.sync().configure(&json!({ "deviceName": "Phone" })).unwrap();
    b.join(&cloud); // nothing of its own to upload
    b.wait_for("B to have A's note", |b| texts(&b.conn(), "p1") == ["hello"]);
    b.wait_idle();

    let peer_names = |app: &App| -> Vec<String> {
        app.sync().status().unwrap()["peers"].as_array().unwrap().iter().filter_map(|p| p["name"].as_str().map(str::to_string)).collect()
    };
    a.sync().sync_now().unwrap();
    a.wait_for("A to list B", |a| peer_names(a) == ["Phone"]);
    assert!(a.sync().status().unwrap()["peers"][0]["lastSeenAt"].is_i64());

    b.sync().configure(&json!({ "deviceName": "Work phone" })).unwrap();
    write_note(&b.conn(), "p1", "s2", "from the phone"); // uploads by itself, with the new name
    // Let B's upload finish before A looks. A used to call sync_now() on
    // every 20 ms poll while waiting — ~1,000 syncs in 10 s on CI, keeping
    // the shared folder busy so B's upload never got in (failed on every
    // Windows run, sometimes on Linux).
    b.wait_for("B to upload its edit", |b| b.conn().query_row("SELECT COUNT(*) FROM sync_outbox", [], |r| r.get::<_, i64>(0)).unwrap() == 0);
    a.sync().sync_now().unwrap();
    a.wait_for("the rename on A", |a| peer_names(a) == ["Work phone"]);
    std::fs::remove_dir_all(&cloud).ok();
}
