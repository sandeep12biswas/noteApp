//! OneDrive as a sync target (sync step S6), through Microsoft Graph.
//!
//! FlowNote only asks for its own app folder (`Files.ReadWrite.AppFolder`),
//! which OneDrive shows as `Apps/FlowNote`; every sync path is a path under
//! it (`/me/drive/special/approot:/<path>:`). Graph creates missing parent
//! folders on upload, and a file only appears once its upload completes, so
//! uploads are atomic as `SyncTarget` requires.

use serde_json::{json, Value};
use std::sync::Arc;

use super::http::{encode_path, error_of, Http, ReadJson};
use super::oauth::TokenSource;
use super::target::check_path;
use super::{RemoteFile, SyncTarget};

pub const GRAPH_API: &str = "https://graph.microsoft.com/v1.0";
/// Graph's limit for a single-request upload; bigger files use an upload session.
const SIMPLE_UPLOAD_LIMIT: usize = 4 * 1024 * 1024;
/// Upload-session chunks must be multiples of 320 KiB.
const CHUNK: usize = 32 * 320 * 1024;

pub struct OneDriveTarget {
    http: Http,
    tokens: Arc<TokenSource>,
    api: String,
    simple_limit: usize,
    chunk: usize,
}

impl OneDriveTarget {
    pub fn new(http: Http, tokens: Arc<TokenSource>) -> OneDriveTarget {
        Self::with_api(http, tokens, GRAPH_API)
    }

    /// Against another Graph endpoint (tests).
    pub fn with_api(http: Http, tokens: Arc<TokenSource>, api: &str) -> OneDriveTarget {
        OneDriveTarget { http, tokens, api: api.trim_end_matches('/').to_string(), simple_limit: SIMPLE_UPLOAD_LIMIT, chunk: CHUNK }
    }

    #[cfg(test)]
    fn with_upload_sizes(mut self, simple_limit: usize, chunk: usize) -> Self {
        self.simple_limit = simple_limit;
        self.chunk = chunk;
        self
    }

    fn root(&self) -> String {
        format!("{}/me/drive/special/approot", self.api)
    }

    fn item(&self, path: &str) -> String {
        format!("{}:/{}:", self.root(), encode_path(path))
    }

    /// The signed-in account, for the settings screen: e-mail or user name.
    pub fn account(&self) -> Result<String, String> {
        let url = format!("{}/me?$select=displayName,mail,userPrincipalName", self.api);
        let r = self.tokens.send(&self.http, "OneDrive", |c| c.get(&url))?;
        if !r.status().is_success() {
            return Err(error_of("OneDrive", r));
        }
        let me: Value = r.json_value()?;
        Ok(me["mail"].as_str().or(me["userPrincipalName"].as_str()).or(me["displayName"].as_str()).unwrap_or("OneDrive account").to_string())
    }

    /// Files under `dir` (`""` = the app folder), at any depth.
    fn walk(&self, dir: &str, out: &mut Vec<RemoteFile>) -> Result<(), String> {
        let folder = if dir.is_empty() { self.root() } else { self.item(dir) };
        let mut next = Some(format!("{folder}/children?$select=name,size,folder,file&$top=500"));
        while let Some(url) = next.take() {
            let r = self.tokens.send(&self.http, "OneDrive", |c| c.get(&url))?;
            if r.status().as_u16() == 404 {
                return Ok(()); // no such folder: nothing in it
            }
            if !r.status().is_success() {
                return Err(error_of("OneDrive", r));
            }
            let page: Value = r.json_value()?;
            for child in page["value"].as_array().into_iter().flatten() {
                let Some(name) = child["name"].as_str() else { continue };
                let path = if dir.is_empty() { name.to_string() } else { format!("{dir}/{name}") };
                if child.get("folder").is_some_and(|f| !f.is_null()) {
                    self.walk(&path, out)?;
                } else if child.get("file").is_some_and(|f| !f.is_null()) {
                    out.push(RemoteFile { path, size: child["size"].as_u64().unwrap_or(0) });
                }
            }
            next = page["@odata.nextLink"].as_str().map(str::to_string);
        }
        Ok(())
    }

    fn upload_in_session(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        let url = format!("{}/createUploadSession", self.item(path));
        let body = json!({ "item": { "@microsoft.graph.conflictBehavior": "replace" } }).to_string();
        let r = self.tokens.send(&self.http, "OneDrive", |c| c.post(&url).header("Content-Type", "application/json").body(body.clone()))?;
        if !r.status().is_success() {
            return Err(error_of("OneDrive", r));
        }
        let session: Value = r.json_value()?;
        let upload_url = session["uploadUrl"].as_str().ok_or("OneDrive didn't return an upload URL")?.to_string();
        let total = bytes.len();
        let mut start = 0;
        while start < total {
            let end = (start + self.chunk).min(total);
            let chunk = bytes[start..end].to_vec();
            // The upload URL carries its own authorization; Graph rejects a
            // bearer token on it.
            let r = self.http.send("OneDrive", |c| {
                c.put(&upload_url).header("Content-Range", format!("bytes {start}-{}/{total}", end - 1)).body(chunk.clone())
            })?;
            let status = r.status().as_u16();
            if !(200..300).contains(&status) {
                let message = error_of("OneDrive", r);
                let _ = self.http.send("OneDrive", |c| c.delete(&upload_url));
                return Err(message);
            }
            start = end;
        }
        Ok(())
    }
}

impl SyncTarget for OneDriveTarget {
    fn list(&self, prefix: &str) -> Result<Vec<RemoteFile>, String> {
        let dir = prefix.rsplit_once('/').map(|(d, _)| d).unwrap_or("");
        if !dir.is_empty() {
            check_path(dir)?;
        }
        let mut out = Vec::new();
        self.walk(dir, &mut out)?;
        out.retain(|f| f.path.starts_with(prefix));
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    fn get(&self, path: &str) -> Result<Option<Vec<u8>>, String> {
        check_path(path)?;
        let url = format!("{}/content", self.item(path));
        let r = self.tokens.send(&self.http, "OneDrive", |c| c.get(&url))?;
        match r.status().as_u16() {
            404 => Ok(None),
            s if (200..300).contains(&s) => r.bytes().map(|b| Some(b.to_vec())).map_err(|e| format!("OneDrive download failed: {e}")),
            _ => Err(error_of("OneDrive", r)),
        }
    }

    fn put(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        check_path(path)?;
        if bytes.len() > self.simple_limit {
            return self.upload_in_session(path, bytes);
        }
        let url = format!("{}/content", self.item(path));
        let body = bytes.to_vec();
        let r = self.tokens.send(&self.http, "OneDrive", |c| c.put(&url).header("Content-Type", "application/octet-stream").body(body.clone()))?;
        if !r.status().is_success() {
            return Err(error_of("OneDrive", r));
        }
        Ok(())
    }

    fn delete(&self, path: &str) -> Result<(), String> {
        check_path(path)?;
        let url = self.item(path);
        let r = self.tokens.send(&self.http, "OneDrive", |c| c.delete(&url))?;
        match r.status().as_u16() {
            404 => Ok(()),
            s if (200..300).contains(&s) => Ok(()),
            _ => Err(error_of("OneDrive", r)),
        }
    }
}

#[cfg(test)]
#[path = "onedrive_tests.rs"]
mod tests;
