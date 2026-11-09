//! Google Drive as a sync target (sync step S6), through the Drive v3 API.
//!
//! FlowNote asks only for `drive.file` (it sees the files it created, on any
//! of the user's devices) and keeps them in a visible `FlowNote` folder at
//! the top of My Drive, with real subfolders for each sync path.
//!
//! Drive finds files by id, not path, and lets one folder hold several
//! files with the same name. Two devices creating the same folder (or a
//! retried upload) can leave duplicates, so lookups gather every folder of
//! a name, and the oldest file of a name is the one read and replaced.
//! Uploads are resumable sessions: a file appears or changes only once all
//! its bytes are in, so writes are atomic as `SyncTarget` requires.

use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use super::http::{error_of, form, Http, ReadJson};
use super::oauth::TokenSource;
use super::target::check_path;
use super::{RemoteFile, SyncTarget};

pub const DRIVE_API: &str = "https://www.googleapis.com";
pub const ROOT_FOLDER: &str = "FlowNote";
const FOLDER_MIME: &str = "application/vnd.google-apps.folder";

#[derive(Debug, Clone)]
struct Entry {
    id: String,
    name: String,
    folder: bool,
    size: u64,
    created: String,
}

pub struct GoogleDriveTarget {
    http: Http,
    tokens: Arc<TokenSource>,
    api: String,
    /// Folder path under FlowNote (`""` = FlowNote itself) → its ids, oldest first.
    folders: Mutex<HashMap<String, Vec<String>>>,
}

/// Escapes a name for a Drive query string literal.
fn q_literal(name: &str) -> String {
    format!("'{}'", name.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn parent_of(path: &str) -> (&str, &str) {
    path.rsplit_once('/').unwrap_or(("", path))
}

impl GoogleDriveTarget {
    pub fn new(http: Http, tokens: Arc<TokenSource>) -> GoogleDriveTarget {
        Self::with_api(http, tokens, DRIVE_API)
    }

    /// Against another Drive endpoint (tests).
    pub fn with_api(http: Http, tokens: Arc<TokenSource>, api: &str) -> GoogleDriveTarget {
        GoogleDriveTarget { http, tokens, api: api.trim_end_matches('/').to_string(), folders: Mutex::default() }
    }

    /// The signed-in account, for the settings screen.
    pub fn account(&self) -> Result<String, String> {
        let url = format!("{}/drive/v3/about?fields=user(displayName,emailAddress)", self.api);
        let r = self.tokens.send(&self.http, "Google Drive", |c| c.get(&url))?;
        if !r.status().is_success() {
            return Err(error_of("Google Drive", r));
        }
        let about = r.json_value()?;
        let user = &about["user"];
        Ok(user["emailAddress"].as_str().or(user["displayName"].as_str()).unwrap_or("Google account").to_string())
    }

    /// Every file matching `q`, oldest first.
    fn query(&self, q: &str) -> Result<Vec<Entry>, String> {
        let mut out = Vec::new();
        let mut page_token: Option<String> = None;
        loop {
            let mut params = vec![
                ("q", q.to_string()),
                ("fields", "nextPageToken,files(id,name,mimeType,size,createdTime)".to_string()),
                ("pageSize", "1000".to_string()),
                ("spaces", "drive".to_string()),
            ];
            if let Some(t) = &page_token {
                params.push(("pageToken", t.clone()));
            }
            let pairs: Vec<(&str, &str)> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();
            let url = format!("{}/drive/v3/files?{}", self.api, form(&pairs));
            let r = self.tokens.send(&self.http, "Google Drive", |c| c.get(&url))?;
            if !r.status().is_success() {
                return Err(error_of("Google Drive", r));
            }
            let page = r.json_value()?;
            for f in page["files"].as_array().into_iter().flatten() {
                out.push(Entry {
                    id: f["id"].as_str().unwrap_or_default().to_string(),
                    name: f["name"].as_str().unwrap_or_default().to_string(),
                    folder: f["mimeType"] == FOLDER_MIME,
                    size: f["size"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0),
                    created: f["createdTime"].as_str().unwrap_or_default().to_string(),
                });
            }
            match page["nextPageToken"].as_str() {
                Some(t) => page_token = Some(t.to_string()),
                None => break,
            }
        }
        out.sort_by(|a, b| (&a.created, &a.id).cmp(&(&b.created, &b.id)));
        Ok(out)
    }

    /// The entries in any of `parents`, optionally only those named `name`.
    fn in_parents(&self, parents: &[String], name: Option<&str>, folders_only: bool) -> Result<Vec<Entry>, String> {
        let mut out = Vec::new();
        for parent in parents {
            let mut q = format!("{} in parents and trashed = false", q_literal(parent));
            if let Some(name) = name {
                q.push_str(&format!(" and name = {}", q_literal(name)));
            }
            if folders_only {
                q.push_str(&format!(" and mimeType = '{FOLDER_MIME}'"));
            }
            out.extend(self.query(&q)?);
        }
        out.sort_by(|a, b| (&a.created, &a.id).cmp(&(&b.created, &b.id)));
        Ok(out)
    }

    fn create_folder(&self, parent: &str, name: &str) -> Result<(), String> {
        let url = format!("{}/drive/v3/files?fields=id", self.api);
        let body = json!({ "name": name, "mimeType": FOLDER_MIME, "parents": [parent] }).to_string();
        let r = self.tokens.send(&self.http, "Google Drive", |c| c.post(&url).header("Content-Type", "application/json").body(body.clone()))?;
        if !r.status().is_success() {
            return Err(error_of("Google Drive", r));
        }
        Ok(())
    }

    /// The ids of folder `dir` (`""` = FlowNote), oldest first; created
    /// (with its parents) when `create` and missing. Empty if missing.
    fn folder_ids(&self, dir: &str, create: bool) -> Result<Vec<String>, String> {
        if let Some(ids) = self.folders.lock().unwrap_or_else(|p| p.into_inner()).get(dir) {
            return Ok(ids.clone());
        }
        let (parents, name) = if dir.is_empty() {
            (vec!["root".to_string()], ROOT_FOLDER)
        } else {
            let (parent_dir, name) = parent_of(dir);
            (self.folder_ids(parent_dir, create)?, name)
        };
        if parents.is_empty() {
            return Ok(vec![]);
        }
        let mut found = self.in_parents(&parents, Some(name), true)?;
        if found.is_empty() && create {
            self.create_folder(&parents[0], name)?;
            // Look again rather than trusting our own: another device may
            // have created one at the same moment, and both then use all.
            found = self.in_parents(&parents, Some(name), true)?;
        }
        let ids: Vec<String> = found.into_iter().map(|e| e.id).collect();
        if !ids.is_empty() {
            self.folders.lock().unwrap_or_else(|p| p.into_inner()).insert(dir.to_string(), ids.clone());
        }
        Ok(ids)
    }

    /// Every file stored at `path` (several only after a race), oldest first.
    fn files_at(&self, path: &str) -> Result<Vec<Entry>, String> {
        let (dir, name) = parent_of(path);
        let parents = self.folder_ids(dir, false)?;
        Ok(self.in_parents(&parents, Some(name), false)?.into_iter().filter(|e| !e.folder).collect())
    }

    fn walk(&self, ids: &[String], dir: &str, out: &mut BTreeMap<String, u64>) -> Result<(), String> {
        let mut subfolders: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for e in self.in_parents(ids, None, false)? {
            let path = if dir.is_empty() { e.name.clone() } else { format!("{dir}/{}", e.name) };
            if e.folder {
                subfolders.entry(path).or_default().push(e.id);
            } else {
                out.entry(path).or_insert(e.size); // oldest of a name wins
            }
        }
        for (path, ids) in subfolders {
            self.walk(&ids, &path, out)?;
        }
        Ok(())
    }

    /// Uploads `bytes` to a resumable session started by `start`.
    fn upload(&self, start: impl Fn(&reqwest::blocking::Client) -> reqwest::blocking::RequestBuilder, bytes: &[u8]) -> Result<(), String> {
        let r = self.tokens.send(&self.http, "Google Drive", start)?;
        if !r.status().is_success() {
            return Err(error_of("Google Drive", r));
        }
        let session = r.headers().get("location").and_then(|v| v.to_str().ok()).ok_or("Google Drive didn't start the upload")?.to_string();
        let body = bytes.to_vec();
        let r = self.http.send("Google Drive", |c| c.put(&session).body(body.clone()))?;
        if !r.status().is_success() {
            return Err(error_of("Google Drive", r));
        }
        Ok(())
    }
}

impl SyncTarget for GoogleDriveTarget {
    fn list(&self, prefix: &str) -> Result<Vec<RemoteFile>, String> {
        let dir = prefix.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
        if !dir.is_empty() {
            check_path(dir)?;
        }
        let ids = self.folder_ids(dir, false)?;
        let mut found = BTreeMap::new();
        self.walk(&ids, dir, &mut found)?;
        Ok(found.into_iter().filter(|(p, _)| p.starts_with(prefix)).map(|(path, size)| RemoteFile { path, size }).collect())
    }

    fn get(&self, path: &str) -> Result<Option<Vec<u8>>, String> {
        check_path(path)?;
        let Some(file) = self.files_at(path)?.into_iter().next() else { return Ok(None) };
        let url = format!("{}/drive/v3/files/{}?alt=media", self.api, file.id);
        let r = self.tokens.send(&self.http, "Google Drive", |c| c.get(&url))?;
        match r.status().as_u16() {
            404 => Ok(None),
            s if (200..300).contains(&s) => r.bytes().map(|b| Some(b.to_vec())).map_err(|e| format!("Google Drive download failed: {e}")),
            _ => Err(error_of("Google Drive", r)),
        }
    }

    fn put(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        check_path(path)?;
        if let Some(file) = self.files_at(path)?.into_iter().next() {
            let url = format!("{}/upload/drive/v3/files/{}?uploadType=resumable", self.api, file.id);
            return self.upload(|c| c.patch(&url).header("Content-Type", "application/json").body("{}"), bytes);
        }
        let (dir, name) = parent_of(path);
        let parents = self.folder_ids(dir, true)?;
        let parent = parents.first().ok_or("Google Drive didn't create the folder")?;
        let url = format!("{}/upload/drive/v3/files?uploadType=resumable", self.api);
        let metadata: Value = json!({ "name": name, "parents": [parent] });
        let body = metadata.to_string();
        self.upload(|c| c.post(&url).header("Content-Type", "application/json").body(body.clone()), bytes)
    }

    fn delete(&self, path: &str) -> Result<(), String> {
        check_path(path)?;
        for file in self.files_at(path)? {
            let url = format!("{}/drive/v3/files/{}", self.api, file.id);
            let r = self.tokens.send(&self.http, "Google Drive", |c| c.delete(&url))?;
            if !(r.status().is_success() || r.status().as_u16() == 404) {
                return Err(error_of("Google Drive", r));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "gdrive_tests.rs"]
mod tests;
