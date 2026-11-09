//! In-memory fakes of the Microsoft Graph and Google Drive APIs (just the
//! calls the targets make), plus a token endpoint, for the S6 tests.

use super::fake_http::{serve, Req, Resp};
use super::http::{decode, Http, Retry};
use super::oauth::{Provider, TokenSource, Tokens};
use crate::store::now_ms;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const TOKEN: &str = "fake-access-token";

pub fn fast_http() -> Http {
    Http::new(Retry { attempts: 3, base_delay: Duration::from_millis(5), max_delay: Duration::from_millis(20) }).unwrap()
}

pub fn provider(base: &str, name: &'static str) -> Provider {
    Provider {
        name,
        auth_url: format!("{base}/authorize"),
        token_url: format!("{base}/token"),
        client_id: "test-client".into(),
        client_secret: None,
        scopes: "test".into(),
        redirect_host: "127.0.0.1",
        extra_auth_params: vec![],
    }
}

pub fn token_source(base: &str) -> Arc<TokenSource> {
    Arc::new(TokenSource::new(
        provider(base, "Fake"),
        Tokens { access_token: TOKEN.into(), refresh_token: Some("refresh".into()), expires_at: now_ms() + 3_600_000 },
        Box::new(|_| Ok(())),
    ))
}

/// The token endpoint both fakes serve at `/token`: any code or refresh
/// token gets [`TOKEN`].
fn token_endpoint(req: &Req) -> Resp {
    let form = req.form();
    match form.get("grant_type").map(String::as_str) {
        Some("refresh_token") if form.get("refresh_token").map(String::as_str) == Some("revoked") => {
            Resp::json(400, json!({ "error": "invalid_grant", "error_description": "Token has been expired or revoked." }))
        }
        Some("authorization_code") | Some("refresh_token") => {
            Resp::json(200, json!({ "access_token": TOKEN, "refresh_token": "refresh", "expires_in": 3600 }))
        }
        _ => Resp::json(400, json!({ "error": "unsupported_grant_type" })),
    }
}

fn authorized(req: &Req) -> bool {
    req.header("authorization") == Some(&format!("Bearer {TOKEN}"))
}

// ------------------------------------------------------------------ Graph

#[derive(Default)]
pub struct GraphState {
    pub files: BTreeMap<String, Vec<u8>>,
    sessions: HashMap<String, (String, Vec<u8>)>,
    pub session_chunks: usize,
}

/// A fake Graph API at `<base>/v1.0`; returns `(base, api, state)`.
pub fn graph() -> (String, String, Arc<Mutex<GraphState>>) {
    let state: Arc<Mutex<GraphState>> = Arc::default();
    let s = state.clone();
    let base = serve(move |req, base| graph_handle(&mut s.lock().unwrap(), req, base));
    let api = format!("{base}/v1.0");
    (base, api, state)
}

const PAGE: usize = 2; // small, so paging is exercised

fn graph_handle(st: &mut GraphState, req: &Req, base: &str) -> Resp {
    let path = req.path().to_string();
    if path == "/token" {
        return token_endpoint(req);
    }
    if let Some(item) = path.strip_prefix("/download/") {
        // Pre-authenticated download URL.
        return match st.files.get(&decode(item)) {
            Some(bytes) => Resp::bytes(bytes.clone()),
            None => Resp::status(404),
        };
    }
    if let Some(id) = path.strip_prefix("/upload/") {
        if req.header("authorization").is_some() {
            return Resp::json(401, json!({ "error": { "message": "no bearer token on upload URLs" } }));
        }
        let Some((target, data)) = st.sessions.get_mut(id) else { return Resp::status(404) };
        let range = req.header("content-range").unwrap_or_default().to_string();
        let (span, total) = range.trim_start_matches("bytes ").split_once('/').unwrap();
        let start: usize = span.split_once('-').unwrap().0.parse().unwrap();
        let total: usize = total.parse().unwrap();
        assert_eq!(start, data.len(), "chunks arrive in order");
        data.extend_from_slice(&req.body);
        st.session_chunks += 1;
        if data.len() == total {
            let (target, data) = (target.clone(), data.clone());
            st.sessions.remove(id);
            st.files.insert(target, data);
            return Resp::json(201, json!({}));
        }
        return Resp::json(202, json!({}));
    }
    if !authorized(req) {
        return Resp::json(401, json!({ "error": { "message": "InvalidAuthenticationToken" } }));
    }
    if path == "/v1.0/me" {
        return Resp::json(200, json!({ "displayName": "Test User", "mail": "test@example.com" }));
    }
    let Some(rest) = path.strip_prefix("/v1.0/me/drive/special/approot") else { return Resp::status(404) };
    let (item, action) = if let Some(action) = rest.strip_prefix('/') {
        (String::new(), action.to_string())
    } else if let Some(inner) = rest.strip_prefix(":/") {
        match inner.rsplit_once(':') {
            Some((item, tail)) => (decode(item), tail.trim_start_matches('/').to_string()),
            None => return Resp::status(400),
        }
    } else {
        return Resp::status(400);
    };
    match (req.method.as_str(), action.as_str()) {
        ("GET", "children") => {
            let prefix = if item.is_empty() { String::new() } else { format!("{item}/") };
            if !item.is_empty() && !st.files.keys().any(|k| k.starts_with(&prefix)) {
                return Resp::json(404, json!({ "error": { "code": "itemNotFound" } }));
            }
            let mut children: BTreeMap<String, Value> = BTreeMap::new();
            for (k, v) in &st.files {
                let Some(rem) = k.strip_prefix(&prefix) else { continue };
                match rem.split_once('/') {
                    Some((folder, _)) => children.insert(folder.into(), json!({ "name": folder, "folder": { "childCount": 1 } })),
                    None => children.insert(rem.into(), json!({ "name": rem, "size": v.len(), "file": {} })),
                };
            }
            let skip: usize = req.query("skip").and_then(|s| s.parse().ok()).unwrap_or(0);
            let page: Vec<Value> = children.into_values().skip(skip).take(PAGE + 1).collect();
            let mut body = json!({ "value": page.iter().take(PAGE).cloned().collect::<Vec<_>>() });
            if page.len() > PAGE {
                body["@odata.nextLink"] = json!(format!("{base}{path}?$top=500&skip={}", skip + PAGE));
            }
            Resp::json(200, body)
        }
        ("GET", "content") => match st.files.contains_key(&item) {
            true => Resp::status(302).header("Location", &format!("{base}/download/{}", super::http::encode_path(&item))),
            false => Resp::json(404, json!({ "error": { "code": "itemNotFound" } })),
        },
        ("PUT", "content") => {
            st.files.insert(item, req.body.clone());
            Resp::json(201, json!({}))
        }
        ("POST", "createUploadSession") => {
            let id = uuid::Uuid::new_v4().simple().to_string();
            st.sessions.insert(id.clone(), (item, Vec::new()));
            Resp::json(200, json!({ "uploadUrl": format!("{base}/upload/{id}") }))
        }
        ("DELETE", "") => {
            let prefix = format!("{item}/");
            let before = st.files.len();
            st.files.retain(|k, _| k != &item && !k.starts_with(&prefix));
            if st.files.len() == before { Resp::status(404) } else { Resp::status(204) }
        }
        _ => Resp::status(405),
    }
}

// ------------------------------------------------------------ Google Drive

#[derive(Clone, Debug)]
pub struct DriveFile {
    pub id: String,
    pub name: String,
    pub parent: String,
    pub folder: bool,
    pub data: Vec<u8>,
    pub created: u64,
}

#[derive(Default)]
pub struct DriveState {
    pub files: BTreeMap<String, DriveFile>,
    uploads: HashMap<String, (Option<String>, Value)>,
    counter: u64,
}

impl DriveState {
    pub fn add(&mut self, name: &str, parent: &str, folder: bool, data: Vec<u8>) -> String {
        self.counter += 1;
        let id = format!("id{:04}", self.counter);
        self.files.insert(id.clone(), DriveFile { id: id.clone(), name: name.into(), parent: parent.into(), folder, data, created: self.counter });
        id
    }

    fn path_of<'a>(&'a self, mut f: &'a DriveFile) -> String {
        let mut parts = vec![f.name.clone()];
        while let Some(p) = self.files.get(&f.parent) {
            parts.push(p.name.clone());
            f = p;
        }
        parts.reverse();
        parts.join("/")
    }

    /// Every non-folder file's path from the drive root, e.g. `FlowNote/vault.json`.
    pub fn paths(&self) -> Vec<String> {
        let mut out: Vec<String> = self.files.values().filter(|f| !f.folder).map(|f| self.path_of(f)).collect();
        out.sort();
        out
    }
}

/// A fake Drive v3 API at `<base>`; returns `(base, state)`.
pub fn drive() -> (String, Arc<Mutex<DriveState>>) {
    let state: Arc<Mutex<DriveState>> = Arc::default();
    let s = state.clone();
    let base = serve(move |req, base| drive_handle(&mut s.lock().unwrap(), req, base));
    (base, state)
}

fn meta(f: &DriveFile) -> Value {
    json!({
        "id": f.id, "name": f.name, "size": f.data.len().to_string(),
        "mimeType": if f.folder { "application/vnd.google-apps.folder" } else { "application/octet-stream" },
        "createdTime": format!("2026-01-01T00:00:{:02}.{:03}Z", f.created / 1000 % 60, f.created % 1000),
    })
}

/// Just the query forms the target sends: `'<id>' in parents and trashed =
/// false`, optionally with `and name = '<n>'` and/or a mimeType test.
fn matches(q: &str, f: &DriveFile) -> bool {
    let field = |key: &str| q.split(" and ").find_map(|c| c.trim().strip_prefix(key).map(|v| v.trim().trim_matches('\'').replace("\\'", "'")));
    let parent = q.split(" and ").find_map(|c| c.trim().strip_suffix(" in parents").map(|v| v.trim_matches('\'').to_string()));
    parent.is_some_and(|p| p == f.parent)
        && field("name = ").is_none_or(|n| n == f.name)
        && field("mimeType = ").is_none_or(|m| (m == "application/vnd.google-apps.folder") == f.folder)
}

fn drive_handle(st: &mut DriveState, req: &Req, base: &str) -> Resp {
    let path = req.path().to_string();
    if path == "/token" {
        return token_endpoint(req);
    }
    if let Some(id) = path.strip_prefix("/upload-session/") {
        // Resumable upload's second step: the bytes. The session URL is the authorization.
        let Some((existing, metadata)) = st.uploads.remove(id) else { return Resp::status(404) };
        let file = match existing {
            Some(fid) => {
                let f = st.files.get_mut(&fid).unwrap();
                f.data = req.body.clone();
                f.clone()
            }
            None => {
                let parent = metadata["parents"][0].as_str().unwrap_or("root").to_string();
                let fid = st.add(metadata["name"].as_str().unwrap(), &parent, false, req.body.clone());
                st.files[&fid].clone()
            }
        };
        return Resp::json(200, meta(&file));
    }
    if !authorized(req) {
        return Resp::json(401, json!({ "error": { "message": "Invalid Credentials" } }));
    }
    match (req.method.as_str(), path.as_str()) {
        ("GET", "/drive/v3/about") => Resp::json(200, json!({ "user": { "displayName": "Test User", "emailAddress": "test@gmail.com" } })),
        ("GET", "/drive/v3/files") => {
            let q = req.query("q").unwrap_or_default();
            let mut found: Vec<&DriveFile> = st.files.values().filter(|f| matches(&q, f)).collect();
            found.sort_by_key(|f| f.created);
            let skip: usize = req.query("pageToken").and_then(|t| t.parse().ok()).unwrap_or(0);
            let page: Vec<Value> = found.iter().skip(skip).take(PAGE).map(|f| meta(f)).collect();
            let mut body = json!({ "files": page });
            if found.len() > skip + PAGE {
                body["nextPageToken"] = json!((skip + PAGE).to_string());
            }
            Resp::json(200, body)
        }
        ("POST", "/drive/v3/files") => {
            let m = req.json();
            assert_eq!(m["mimeType"], "application/vnd.google-apps.folder", "only folders are created without content");
            let parent = m["parents"][0].as_str().unwrap_or("root").to_string();
            let id = st.add(m["name"].as_str().unwrap(), &parent, true, vec![]);
            Resp::json(200, meta(&st.files[&id]))
        }
        ("POST", "/upload/drive/v3/files") => {
            assert_eq!(req.query("uploadType").as_deref(), Some("resumable"));
            let id = uuid::Uuid::new_v4().simple().to_string();
            st.uploads.insert(id.clone(), (None, req.json()));
            Resp::json(200, json!({})).header("Location", &format!("{base}/upload-session/{id}"))
        }
        _ => {
            if let Some(fid) = path.strip_prefix("/upload/drive/v3/files/") {
                if req.method != "PATCH" || !st.files.contains_key(fid) {
                    return Resp::status(404);
                }
                let id = uuid::Uuid::new_v4().simple().to_string();
                st.uploads.insert(id.clone(), (Some(fid.to_string()), json!({})));
                return Resp::json(200, json!({})).header("Location", &format!("{base}/upload-session/{id}"));
            }
            let Some(fid) = path.strip_prefix("/drive/v3/files/") else { return Resp::status(404) };
            match req.method.as_str() {
                "GET" if req.query("alt").as_deref() == Some("media") => match st.files.get(fid) {
                    Some(f) => Resp::bytes(f.data.clone()),
                    None => Resp::status(404),
                },
                "DELETE" => match st.files.remove(fid) {
                    Some(_) => {
                        // Deleting a folder deletes what's in it.
                        let mut gone = vec![fid.to_string()];
                        while let Some(p) = gone.pop() {
                            let kids: Vec<String> = st.files.values().filter(|f| f.parent == p).map(|f| f.id.clone()).collect();
                            for k in kids {
                                st.files.remove(&k);
                                gone.push(k);
                            }
                        }
                        Resp::status(204)
                    }
                    None => Resp::status(404),
                },
                _ => Resp::status(405),
            }
        }
    }
}
