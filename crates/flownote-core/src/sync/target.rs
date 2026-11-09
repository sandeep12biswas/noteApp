//! Where synced files are stored. The engine only needs four operations on
//! a folder of files, so any cloud drive (S6: OneDrive, Google Drive), a
//! local folder another program syncs (Dropbox, Syncthing), or memory
//! (tests) can serve as the target.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq)]
pub struct RemoteFile {
    /// Relative to the sync folder, `/`-separated, e.g. `blobs/ab12….enc`.
    pub path: String,
    pub size: u64,
}

pub trait SyncTarget: Send + Sync {
    /// Every file under `prefix` (`""` for all), at any depth. Uploads still
    /// in progress are never listed.
    fn list(&self, prefix: &str) -> Result<Vec<RemoteFile>, String>;
    /// The file's bytes, or `None` if there is no such file.
    fn get(&self, path: &str) -> Result<Option<Vec<u8>>, String>;
    /// Creates or replaces a file. Must be atomic: anyone reading sees the
    /// old file or all of the new one, never part of it.
    fn put(&self, path: &str, bytes: &[u8]) -> Result<(), String>;
    fn delete(&self, path: &str) -> Result<(), String>;
}

/// Rejects paths that could leave the sync folder.
pub(crate) fn check_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path.starts_with('/') || path.contains('\\') || path.split('/').any(|p| p.is_empty() || p == "." || p == "..") {
        return Err(format!("invalid sync path `{path}`"));
    }
    Ok(())
}

/// A folder on this computer. Writes go to a temporary file next to the
/// target and are renamed into place, so a crash or a desktop sync client
/// never sees half a file.
pub struct LocalFolderTarget {
    root: PathBuf,
}

const TMP_MARKER: &str = ".flownote-tmp-";

impl LocalFolderTarget {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        LocalFolderTarget { root: root.into() }
    }

    fn walk(dir: &Path, rel: &str, out: &mut Vec<RemoteFile>) -> std::io::Result<()> {
        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e),
        };
        for entry in entries {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            let kind = entry.file_type()?;
            if kind.is_dir() {
                Self::walk(&entry.path(), &path, out)?;
            } else if kind.is_file() && !name.contains(TMP_MARKER) {
                out.push(RemoteFile { path, size: entry.metadata()?.len() });
            }
        }
        Ok(())
    }
}

impl SyncTarget for LocalFolderTarget {
    fn list(&self, prefix: &str) -> Result<Vec<RemoteFile>, String> {
        let mut out = Vec::new();
        Self::walk(&self.root, "", &mut out).map_err(|e| e.to_string())?;
        out.retain(|f| f.path.starts_with(prefix));
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    fn get(&self, path: &str) -> Result<Option<Vec<u8>>, String> {
        check_path(path)?;
        match std::fs::read(self.root.join(path)) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("{path}: {e}")),
        }
    }

    fn put(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        check_path(path)?;
        let dest = self.root.join(path);
        let dir = dest.parent().ok_or("no parent directory")?;
        std::fs::create_dir_all(dir).map_err(|e| format!("{path}: {e}"))?;
        let file_name = dest.file_name().unwrap_or_default().to_string_lossy().into_owned();
        let tmp = dir.join(format!("{file_name}{TMP_MARKER}{}", uuid::Uuid::new_v4()));
        let write = || -> std::io::Result<()> {
            use std::io::Write;
            let mut file = std::fs::File::create(&tmp)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            std::fs::rename(&tmp, &dest)
        };
        write().map_err(|e| {
            let _ = std::fs::remove_file(&tmp);
            format!("{path}: {e}")
        })
    }

    fn delete(&self, path: &str) -> Result<(), String> {
        check_path(path)?;
        match std::fs::remove_file(self.root.join(path)) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("{path}: {e}")),
        }
    }
}

/// Files in memory — for tests.
#[derive(Default)]
pub struct MemoryTarget {
    files: Mutex<BTreeMap<String, Vec<u8>>>,
}

impl SyncTarget for MemoryTarget {
    fn list(&self, prefix: &str) -> Result<Vec<RemoteFile>, String> {
        let files = self.files.lock().unwrap();
        Ok(files
            .iter()
            .filter(|(path, _)| path.starts_with(prefix))
            .map(|(path, bytes)| RemoteFile { path: path.clone(), size: bytes.len() as u64 })
            .collect())
    }

    fn get(&self, path: &str) -> Result<Option<Vec<u8>>, String> {
        check_path(path)?;
        Ok(self.files.lock().unwrap().get(path).cloned())
    }

    fn put(&self, path: &str, bytes: &[u8]) -> Result<(), String> {
        check_path(path)?;
        self.files.lock().unwrap().insert(path.to_string(), bytes.to_vec());
        Ok(())
    }

    fn delete(&self, path: &str) -> Result<(), String> {
        check_path(path)?;
        self.files.lock().unwrap().remove(path);
        Ok(())
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// The behaviour every target must have; also run against the cloud targets.
    pub(crate) fn exercise(target: &dyn SyncTarget) {
        assert_eq!(target.get("a/b.bin").unwrap(), None);
        target.put("a/b.bin", b"one").unwrap();
        target.put("a/c/d.bin", b"two").unwrap();
        target.put("e.bin", b"three").unwrap();
        target.put("a/b.bin", b"replaced").unwrap();
        assert_eq!(target.get("a/b.bin").unwrap().unwrap(), b"replaced");
        let paths: Vec<String> = target.list("a/").unwrap().into_iter().map(|f| f.path).collect();
        assert_eq!(paths, ["a/b.bin", "a/c/d.bin"]);
        assert_eq!(target.list("").unwrap().len(), 3);
        target.delete("a/b.bin").unwrap();
        target.delete("a/b.bin").unwrap(); // already gone is fine
        assert_eq!(target.get("a/b.bin").unwrap(), None);
        for bad in ["", "/etc/passwd", "../x", "a/../../x", "a//b", "a\\b"] {
            assert!(target.put(bad, b"x").is_err(), "{bad}");
            assert!(target.get(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn memory_target_behaves_like_a_folder() {
        exercise(&MemoryTarget::default());
    }

    #[test]
    fn local_folder_target_behaves_like_a_folder_and_hides_partial_writes() {
        let root = std::env::temp_dir().join(format!("flownote-target-{}-{}", std::process::id(), crate::store::now_ms()));
        let target = LocalFolderTarget::new(&root);
        assert!(target.list("").unwrap().is_empty(), "a missing folder is just empty");
        exercise(&target);
        // A leftover temporary file from an interrupted write isn't a file.
        std::fs::write(root.join(format!("x.bin{TMP_MARKER}123")), b"partial").unwrap();
        assert!(target.list("").unwrap().iter().all(|f| !f.path.contains("x.bin")));
        std::fs::remove_dir_all(&root).ok();
    }
}
