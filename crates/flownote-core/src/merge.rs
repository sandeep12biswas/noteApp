//! Applying another device's changes (sync step S2): merge them into this
//! device's Automerge documents, settle what the merge alone can't, and
//! write the result back to the SQLite rows the app reads.
//!
//! A bundle is one device's changes to any number of documents from one
//! sync cycle (`crdt` module docs describe the documents). Applying it is one
//! transaction:
//!
//! 1. Local writes not yet recorded are reconciled first, so this device's
//!    own edits and deletes take part in the merge instead of being
//!    overwritten by it.
//! 2. Each document merges the incoming changes.
//! 3. Rules no CRDT applies by itself, so that sync never loses work:
//!    - **an edit beats a delete** — a record deleted on one device while
//!      edited on another comes back, with the edit;
//!    - **conflicting text becomes a copy** — if two devices changed the same
//!      segment's text concurrently, the merge keeps one version and the
//!      other becomes a new "conflict copy" segment below the page's last
//!      one;
//!    - a deleted page that still has live segments, and a deleted folder that
//!      still holds live pages or folders, come back;
//!    - folders moved into each other concurrently (a cycle) are broken by
//!      moving the cycle's lowest id to the top level.
//!
//!    Every rule depends only on the merged document, so each device that
//!    applies the same changes reaches the same result — conflict copies get
//!    an id derived from their content, so two devices create the same copy,
//!    not two.
//! 4. The documents are written back to the rows: notebook first (folders
//!    and pages must exist before their segments), then pages.

use automerge::transaction::{CommitOptions, Transactable};
use automerge::{AutoCommit, ChangeHash, ObjId, ObjType, ReadDoc, ScalarValue, Value as AmValue};
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashSet};

use crate::crdt::{self, Collection, Fields, NOTEBOOK_DOC, PAGE_DOC_PREFIX};
use crate::store::{self, in_transaction, now_ms};

/// Field order per collection — the same order `crdt`'s row readers use, so
/// a document record and a row compare field by field (checked by a test).
const FOLDER_FIELDS: &[&str] = &["name", "parentId", "icon"];
const PAGE_FIELDS: &[&str] = &["folderId", "title", "mode"];
const SEGMENT_FIELDS: &[&str] = &["x", "y", "w", "h", "zIndex", "borderColor", "fillColor", "content"];
const ATTACHMENT_FIELDS: &[&str] = &["segmentId", "fileName", "mimeType", "size", "sha256"];

/// Border colour of a conflict-copy segment (amber), so it stands out.
pub const CONFLICT_BORDER: &str = "#f59e0b";
/// Vertical gap between the page's lowest segment and a new conflict copy.
const CONFLICT_GAP: f64 = 16.0;

#[derive(Debug, Default, PartialEq)]
pub struct ApplyOutcome {
    /// Documents whose content changed.
    pub changed_docs: Vec<String>,
    /// Records brought back because they were edited while being deleted
    /// elsewhere (or still hold live content), as `collection/id`.
    pub restored: Vec<String>,
    /// Ids of conflict-copy segments created.
    pub conflict_copies: Vec<String>,
}

/// One document during an apply: `local` and `remote` are the heads of the
/// two sides being merged (this device before the merge; the incoming
/// changes' own tips).
struct Merged {
    doc: AutoCommit,
    local: Vec<ChangeHash>,
    remote: Vec<ChangeHash>,
}

/// Applies another device's bundle of `(doc_id, Automerge changes)` — any
/// format `AutoCommit::load_incremental` reads (a full save or the output of
/// `save_after`).
pub fn apply_bundle(conn: &Connection, bundle: &[(String, Vec<u8>)]) -> Result<ApplyOutcome, String> {
    in_transaction(conn, || {
        crdt::reconcile_dirty(conn)?;
        let actor = crdt::device_actor(conn)?;
        let mut outcome = ApplyOutcome::default();

        let mut merged: BTreeMap<String, Merged> = BTreeMap::new();
        for (doc_id, bytes) in bundle {
            if doc_id != NOTEBOOK_DOC && !doc_id.starts_with(PAGE_DOC_PREFIX) {
                return Err(format!("unknown sync document `{doc_id}`"));
            }
            let mut doc = match crdt::load_doc(conn, doc_id)? {
                Some(doc) => doc,
                None => crdt::genesis(doc_id)?,
            };
            doc.set_actor(actor.clone());
            let local = doc.get_heads();
            doc.load_incremental(bytes).map_err(crdt::err)?;
            let after = doc.get_heads();
            let remote: Vec<ChangeHash> = after.iter().filter(|h| !local.contains(h)).copied().collect();
            if remote.is_empty() {
                continue; // nothing new
            }
            outcome.changed_docs.push(doc_id.clone());
            merged.insert(doc_id.clone(), Merged { doc, local, remote });
        }
        if merged.is_empty() {
            return Ok(outcome);
        }

        // Pages first: whether a page still has live segments decides
        // whether the notebook keeps it deleted.
        let incoming_pages: Vec<String> = merged
            .keys()
            .filter_map(|id| id.strip_prefix(PAGE_DOC_PREFIX))
            .map(str::to_string)
            .collect();
        for (doc_id, m) in merged.iter_mut().filter(|(id, _)| id.starts_with(PAGE_DOC_PREFIX)) {
            resolve_page(doc_id, m, &mut outcome)?;
        }
        let pages_with_live_segments: BTreeSet<String> = incoming_pages
            .iter()
            .filter(|page_id| {
                let doc = &merged[&crdt::page_doc_id(page_id)].doc;
                crdt::live_records(doc, "segments").map(|r| !r.is_empty()).unwrap_or(false)
            })
            .cloned()
            .collect();

        if !merged.contains_key(NOTEBOOK_DOC) {
            // Only page documents arrived; the notebook still gets the
            // page/folder rules, with nothing remote to compare against.
            let mut doc = match crdt::load_doc(conn, NOTEBOOK_DOC)? {
                Some(doc) => doc,
                None => crdt::genesis(NOTEBOOK_DOC)?,
            };
            doc.set_actor(actor.clone());
            let local = doc.get_heads();
            merged.insert(NOTEBOOK_DOC.to_string(), Merged { doc, local, remote: vec![] });
        }
        resolve_notebook(merged.get_mut(NOTEBOOK_DOC).unwrap(), &pages_with_live_segments, &mut outcome)?;

        for (doc_id, m) in merged.iter_mut() {
            m.doc.commit_with(CommitOptions::default().with_time(now_ms()));
            crdt::store_doc(conn, doc_id, &mut m.doc)?;
        }

        // Write back: notebook, then every page document that arrived or
        // whose page row has just been created.
        let new_pages = materialize_notebook(conn, &merged[NOTEBOOK_DOC].doc)?;
        let mut pages: BTreeSet<String> = incoming_pages.into_iter().collect();
        pages.extend(new_pages);
        let mut written = vec![NOTEBOOK_DOC.to_string()];
        for page_id in pages {
            let doc_id = crdt::page_doc_id(&page_id);
            let doc = match merged.get(&doc_id) {
                Some(m) => Some(m.doc.clone()),
                None => crdt::load_doc(conn, &doc_id)?,
            };
            if let Some(doc) = doc {
                materialize_page(conn, &page_id, &doc)?;
            }
            written.push(doc_id);
        }
        // The rows were just written from these documents, so the triggers'
        // queue entries for them have nothing left to record.
        for doc_id in written {
            conn.execute("DELETE FROM sync_outbox WHERE doc_id = ?1", [&doc_id]).map_err(crdt::err)?;
        }
        Ok(outcome)
    })
}

// ---------------------------------------------------------------- rules

/// Whether `op` (a value of `record.key`) is part of the history ending at
/// `heads`.
fn seen_at(doc: &AutoCommit, record: &ObjId, key: &str, op: &ObjId, heads: &[ChangeHash]) -> bool {
    doc.get_all_at(record, key, heads).map(|values| values.iter().any(|(_, id)| id == op)).unwrap_or(false)
}

/// Whether `record` is flagged deleted while one of its fields was changed
/// concurrently with that delete — the delete known only to one side of the
/// merge, the edit only to the other.
fn edited_while_deleted(doc: &AutoCommit, record: &ObjId, m: &Merged) -> Result<bool, String> {
    if m.remote.is_empty() {
        return Ok(false);
    }
    let Some((AmValue::Scalar(flag), delete_op)) = doc.get(record, "deleted").map_err(crdt::err)? else {
        return Ok(false);
    };
    if flag.as_ref() != &ScalarValue::Boolean(true) {
        return Ok(false);
    }
    let deleted_locally = seen_at(doc, record, "deleted", &delete_op, &m.local);
    if deleted_locally == seen_at(doc, record, "deleted", &delete_op, &m.remote) {
        return Ok(false);
    }
    for key in doc.keys(record).filter(|k| k != "deleted") {
        let Some((_, op)) = doc.get(record, &key).map_err(crdt::err)? else { continue };
        let edited_locally = seen_at(doc, record, &key, &op, &m.local);
        let edited_remotely = seen_at(doc, record, &key, &op, &m.remote);
        if edited_locally != edited_remotely && edited_locally != deleted_locally {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Every record of `collection`: id → (record object, deleted?).
fn records(doc: &AutoCommit, collection: &str) -> Result<Vec<(String, ObjId, bool)>, String> {
    let coll = crdt::collection_obj(doc, collection)?;
    let mut out = Vec::new();
    for id in doc.keys(&coll) {
        if let Some(record) = crdt::record_obj(doc, &coll, &id)? {
            let deleted = crdt::scalar_at(doc, &record, "deleted")? == Some(true.into());
            out.push((id, record, deleted));
        }
    }
    Ok(out)
}

fn restore(doc: &mut AutoCommit, record: &ObjId, label: String, outcome: &mut ApplyOutcome) -> Result<(), String> {
    doc.put(record, "deleted", false).map_err(crdt::err)?;
    if !outcome.restored.contains(&label) {
        outcome.restored.push(label);
    }
    Ok(())
}

fn restore_edited(m: &mut Merged, collection: &str, outcome: &mut ApplyOutcome) -> Result<(), String> {
    for (id, record, deleted) in records(&m.doc, collection)? {
        if deleted && edited_while_deleted(&m.doc, &record, m)? {
            restore(&mut m.doc, &record, format!("{collection}/{id}"), outcome)?;
        }
    }
    Ok(())
}

fn resolve_page(doc_id: &str, m: &mut Merged, outcome: &mut ApplyOutcome) -> Result<(), String> {
    restore_edited(m, "segments", outcome)?;
    restore_edited(m, "attachments", outcome)?;
    make_conflict_copies(doc_id, &mut m.doc, outcome)
}

/// A conflict copy of a segment: the losing text with a note above it,
/// placed under the page's lowest segment.
fn make_conflict_copies(doc_id: &str, doc: &mut AutoCommit, outcome: &mut ApplyOutcome) -> Result<(), String> {
    let segments = crdt::collection_obj(doc, "segments")?;
    let live: Vec<(String, ObjId)> =
        records(doc, "segments")?.into_iter().filter(|(_, _, deleted)| !deleted).map(|(id, r, _)| (id, r)).collect();
    let mut bottom = live
        .iter()
        .map(|(_, r)| {
            let y = crdt::scalar_at(doc, r, "y").ok().flatten().and_then(|v| v.to_f64()).unwrap_or(0.0);
            let h = crdt::scalar_at(doc, r, "h").ok().flatten().and_then(|v| v.to_f64()).unwrap_or(0.0);
            y + h
        })
        .fold(0.0, f64::max);

    for (id, record) in live {
        let values = doc.get_all(&record, "content").map_err(crdt::err)?;
        let texts: BTreeSet<String> =
            values.iter().filter_map(|(v, _)| v.to_str().map(str::to_string)).collect();
        if texts.len() < 2 {
            continue;
        }
        let winner = crdt::scalar_at(doc, &record, "content")?.and_then(|v| v.to_str().map(str::to_string)).unwrap_or_default();
        let fields = record_fields(doc, &record, SEGMENT_FIELDS)?;
        for loser in texts.iter().filter(|t| **t != winner) {
            let copy_id = format!("segment-conflict-{}", &store::sha256_hex(format!("{doc_id}\0{id}\0{loser}").as_bytes())[..32]);
            if crdt::record_obj(doc, &segments, &copy_id)?.is_some() {
                continue; // another device already made this copy
            }
            let copy = doc.put_object(&segments, copy_id.as_str(), ObjType::Map).map_err(crdt::err)?;
            for (key, value) in &fields {
                let value = match *key {
                    "y" => ScalarValue::F64(bottom + CONFLICT_GAP),
                    "borderColor" => CONFLICT_BORDER.into(),
                    "content" => conflict_content(loser).into(),
                    _ => value.clone(),
                };
                doc.put(&copy, *key, value).map_err(crdt::err)?;
            }
            doc.put(&copy, "deleted", false).map_err(crdt::err)?;
            let h = fields.iter().find(|(k, _)| *k == "h").and_then(|(_, v)| v.to_f64()).unwrap_or(0.0);
            bottom += CONFLICT_GAP + h;
            outcome.conflict_copies.push(copy_id);
        }
        // Settle the conflict on the winner, so it's resolved everywhere.
        doc.put(&record, "content", winner).map_err(crdt::err)?;
    }
    Ok(())
}

/// The losing TipTap document with a note paragraph in front of it.
fn conflict_content(loser: &str) -> String {
    let note = serde_json::json!({
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Conflicting edit from another device — both versions were kept." }],
    });
    let mut doc = parse_tiptap(loser);
    if let Some(content) = doc.get_mut("content").and_then(Value::as_array_mut) {
        content.insert(0, note);
    }
    doc.to_string()
}

/// A segment's stored content as a TipTap document. Text that isn't one (a
/// damaged or foreign record) is kept as a paragraph rather than dropped.
fn parse_tiptap(text: &str) -> Value {
    match serde_json::from_str::<Value>(text) {
        Ok(doc) if doc.get("type").and_then(Value::as_str) == Some("doc") => doc,
        _ => {
            let paragraph = if text.is_empty() {
                serde_json::json!({ "type": "paragraph" })
            } else {
                serde_json::json!({ "type": "paragraph", "content": [{ "type": "text", "text": text }] })
            };
            serde_json::json!({ "type": "doc", "content": [paragraph] })
        }
    }
}

fn str_field(doc: &AutoCommit, record: &ObjId, key: &str) -> Result<Option<String>, String> {
    Ok(crdt::scalar_at(doc, record, key)?.and_then(|v| v.to_str().map(str::to_string)))
}

fn resolve_notebook(m: &mut Merged, pages_with_live_segments: &BTreeSet<String>, outcome: &mut ApplyOutcome) -> Result<(), String> {
    restore_edited(m, "folders", outcome)?;
    restore_edited(m, "pages", outcome)?;
    let doc = &mut m.doc;

    // A page whose own document still has live segments isn't deleted.
    for (id, record, deleted) in records(doc, "pages")? {
        if deleted && pages_with_live_segments.contains(&id) {
            restore(doc, &record, format!("pages/{id}"), outcome)?;
        }
    }

    // Folders that live pages or folders sit in come back — repeated, since
    // restoring a folder can make its own parent needed.
    loop {
        let folders = records(doc, "folders")?;
        let dead: BTreeMap<String, ObjId> =
            folders.iter().filter(|(_, _, d)| *d).map(|(id, r, _)| (id.clone(), r.clone())).collect();
        let mut needed = BTreeSet::new();
        for (_, record, deleted) in &folders {
            if !deleted {
                needed.extend(str_field(doc, record, "parentId")?.filter(|p| dead.contains_key(p)));
            }
        }
        for (_, record, deleted) in records(doc, "pages")? {
            if !deleted {
                needed.extend(str_field(doc, &record, "folderId")?.filter(|f| dead.contains_key(f)));
            }
        }
        if needed.is_empty() {
            break;
        }
        for id in needed {
            restore(doc, &dead[&id], format!("folders/{id}"), outcome)?;
        }
    }

    // Break parent cycles, and parents that no longer exist at all.
    loop {
        let live: BTreeMap<String, (ObjId, Option<String>)> = records(doc, "folders")?
            .into_iter()
            .filter(|(_, _, d)| !d)
            .map(|(id, r, _)| {
                let parent = str_field(doc, &r, "parentId")?;
                Ok((id, (r, parent)))
            })
            .collect::<Result<_, String>>()?;
        let mut fix = None;
        for start in live.keys() {
            let mut path = vec![start.clone()];
            let mut current = start.clone();
            while let Some(parent) = live.get(&current).and_then(|(_, p)| p.clone()) {
                if !live.contains_key(&parent) {
                    fix = Some(current.clone()); // dangling parent
                    break;
                }
                if let Some(pos) = path.iter().position(|p| *p == parent) {
                    fix = path[pos..].iter().min().cloned(); // cycle
                    break;
                }
                path.push(parent.clone());
                current = parent;
            }
            if fix.is_some() {
                break;
            }
        }
        let Some(id) = fix else { break };
        doc.put(&live[&id].0, "parentId", ScalarValue::Null).map_err(crdt::err)?;
    }
    Ok(())
}

// ------------------------------------------------------------ write back

fn record_fields(doc: &AutoCommit, record: &ObjId, keys: &[&'static str]) -> Result<Fields, String> {
    keys.iter()
        .map(|key| Ok((*key, crdt::scalar_at(doc, record, key)?.unwrap_or(ScalarValue::Null))))
        .collect()
}

/// A collection as rows would hold it: live records with their fields, and
/// the ids of deleted ones.
fn doc_collection(doc: &AutoCommit, collection: &str, keys: &[&'static str]) -> Result<(Collection, BTreeSet<String>), String> {
    let mut live = Collection::new();
    let mut dead = BTreeSet::new();
    for (id, record, deleted) in records(doc, collection)? {
        if deleted {
            dead.insert(id);
        } else {
            live.insert(id, record_fields(doc, &record, keys)?);
        }
    }
    Ok((live, dead))
}

fn text(fields: &Fields, key: &str) -> Option<String> {
    fields.iter().find(|(k, _)| *k == key).and_then(|(_, v)| v.to_str().map(str::to_string))
}

fn row_collection(state: &[(&'static str, Collection)], name: &str) -> Collection {
    state.iter().find(|(n, _)| *n == name).map(|(_, c)| c.clone()).unwrap_or_default()
}

fn row_exists(conn: &Connection, table: &str, id: &str) -> Result<bool, String> {
    conn.query_row(&format!("SELECT 1 FROM {table} WHERE id = ?1"), [id], |_| Ok(()))
        .optional()
        .map(|r| r.is_some())
        .map_err(crdt::err)
}

/// Writes the notebook document's folders, pages and dictionary to the
/// rows. Returns the pages whose rows were created.
fn materialize_notebook(conn: &Connection, doc: &AutoCommit) -> Result<Vec<String>, String> {
    let rows = crdt::notebook_state(conn)?;
    let now = now_ms();

    let (folders, dead_folders) = doc_collection(doc, "folders", FOLDER_FIELDS)?;
    let folder_rows = row_collection(&rows, "folders");
    // Parents before children (a folder row's parent must exist).
    let mut present: HashSet<String> = folder_rows.keys().cloned().collect();
    let mut pending: Vec<(&String, &Fields)> = folders.iter().collect();
    while !pending.is_empty() {
        let (ready, waiting): (Vec<_>, Vec<_>) = pending
            .into_iter()
            .partition(|(_, fields)| text(fields, "parentId").is_none_or(|p| present.contains(&p)));
        if ready.is_empty() {
            // resolve_notebook clears dangling parents, so this is a bug.
            return Err(format!("sync: folders with missing parents: {:?}", waiting.iter().map(|(id, _)| id).collect::<Vec<_>>()));
        }
        for (id, fields) in ready {
            if folder_rows.get(id) != Some(fields) {
                conn.execute(
                    "INSERT INTO folders (id, name, parent_id, icon, expanded, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)
                     ON CONFLICT(id) DO UPDATE SET
                       name = excluded.name, parent_id = excluded.parent_id, icon = excluded.icon,
                       updated_at = excluded.updated_at",
                    rusqlite::params![id, text(fields, "name"), text(fields, "parentId"), text(fields, "icon"), now],
                )
                .map_err(crdt::err)?;
            }
            present.insert(id.clone());
        }
        pending = waiting;
    }

    let (pages, dead_pages) = doc_collection(doc, "pages", PAGE_FIELDS)?;
    let page_rows = row_collection(&rows, "pages");
    let mut new_pages = Vec::new();
    for (id, fields) in &pages {
        if page_rows.get(id) == Some(fields) {
            continue;
        }
        if !page_rows.contains_key(id) {
            new_pages.push(id.clone());
        }
        conn.execute(
            "INSERT INTO pages (id, notebook_id, folder_id, title, mode, created_at, updated_at)
             VALUES (?1, 'nb-1', ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(id) DO UPDATE SET
               folder_id = excluded.folder_id, title = excluded.title, mode = excluded.mode,
               updated_at = excluded.updated_at",
            rusqlite::params![id, text(fields, "folderId"), text(fields, "title"), text(fields, "mode"), now],
        )
        .map_err(crdt::err)?;
    }
    for id in dead_pages.iter().filter(|id| page_rows.contains_key(*id)) {
        store::delete_page(conn, id)?;
    }
    for id in &dead_folders {
        if row_exists(conn, "folders", id)? {
            store::delete_folder(conn, id)?;
        }
    }

    let (words, dead_words) = doc_collection(doc, "dictionary", &[])?;
    for word in words.keys() {
        conn.execute("INSERT OR IGNORE INTO dictionary_words (word) VALUES (?1)", [word]).map_err(crdt::err)?;
    }
    for word in &dead_words {
        conn.execute("DELETE FROM dictionary_words WHERE word = ?1", [word]).map_err(crdt::err)?;
    }
    Ok(new_pages)
}

/// Writes a page document's segments, attachments and ink to the rows. A
/// page with no row (deleted) has nothing to write.
fn materialize_page(conn: &Connection, page_id: &str, doc: &AutoCommit) -> Result<(), String> {
    let (rows, ink_row) = crdt::page_state(conn, page_id)?;
    let Some(ink_row) = ink_row else { return Ok(()) };

    let (segments, dead_segments) = doc_collection(doc, "segments", SEGMENT_FIELDS)?;
    let segment_rows = row_collection(&rows, "segments");
    for (id, fields) in &segments {
        if segment_rows.get(id) == Some(fields) {
            continue;
        }
        let mut segment = serde_json::Map::new();
        segment.insert("id".into(), Value::from(id.as_str()));
        segment.insert("pageId".into(), Value::from(page_id));
        for (key, value) in fields {
            let value = match *key {
                "content" => parse_tiptap(value.to_str().unwrap_or_default()),
                _ => crdt::scalar_to_json(value),
            };
            segment.insert((*key).into(), value);
        }
        store::save_segment(conn, &Value::Object(segment))?;
    }
    for id in dead_segments.iter().filter(|id| segment_rows.contains_key(*id)) {
        store::delete_segment(conn, id)?;
    }

    // Attachment rows; the file itself is fetched separately (S4).
    let (attachments, dead_attachments) = doc_collection(doc, "attachments", ATTACHMENT_FIELDS)?;
    let attachment_rows = row_collection(&rows, "attachments");
    for (id, fields) in &attachments {
        let Some(segment_id) = text(fields, "segmentId") else { continue };
        if attachment_rows.get(id) == Some(fields) || !row_exists(conn, "segments", &segment_id)? {
            continue;
        }
        let file_name = text(fields, "fileName").unwrap_or_default();
        let size = fields.iter().find(|(k, _)| *k == "size").and_then(|(_, v)| v.to_i64()).unwrap_or(0);
        conn.execute(
            "INSERT INTO attachments (id, segment_id, file_name, mime_type, size, relative_path, created_at, sha256)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
               segment_id = excluded.segment_id, file_name = excluded.file_name, mime_type = excluded.mime_type,
               size = excluded.size, sha256 = excluded.sha256",
            rusqlite::params![
                id,
                segment_id,
                file_name,
                text(fields, "mimeType"),
                size,
                format!("{id}-{}", store::sanitize_file_name(&file_name)),
                now_ms(),
                text(fields, "sha256"),
            ],
        )
        .map_err(crdt::err)?;
    }
    for id in dead_attachments.iter().filter(|id| attachment_rows.contains_key(*id)) {
        store::delete_attachment(conn, id)?;
    }

    let ink = crdt::scalar_at(doc, &automerge::ROOT, "ink")?.and_then(|v| v.to_str().map(str::to_string));
    if ink != ink_row {
        conn.execute("UPDATE pages SET ink_layer = ?1 WHERE id = ?2", rusqlite::params![ink, page_id]).map_err(crdt::err)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use serde_json::json;

    fn device() -> Connection {
        db::open_in_memory().unwrap()
    }

    /// Everything this device would upload: each document in full.
    fn bundle(conn: &Connection) -> Vec<(String, Vec<u8>)> {
        crdt::reconcile_dirty(conn).unwrap();
        conn.prepare("SELECT doc_id, bytes FROM crdt_docs ORDER BY doc_id")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    /// Sends `from`'s documents to `to`, then checks the write-back was
    /// exact: reconciling `to` again finds nothing to record.
    fn send(from: &Connection, to: &Connection) -> ApplyOutcome {
        let outcome = apply_bundle(to, &bundle(from)).unwrap();
        let docs: Vec<String> =
            to.prepare("SELECT doc_id FROM crdt_docs").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
        for doc_id in docs {
            assert!(!crdt::reconcile(to, &doc_id).unwrap(), "{doc_id}: rows differ from the merged document");
        }
        outcome
    }

    fn sync(a: &Connection, b: &Connection) {
        send(a, b);
        send(b, a);
    }

    /// Every synced row, for comparing two devices.
    fn dump(conn: &Connection) -> Value {
        let query = |sql: &str| -> Vec<Value> {
            let mut stmt = conn.prepare(sql).unwrap();
            let n = stmt.column_count();
            stmt.query_map([], |row| {
                Ok(Value::Array(
                    (0..n)
                        .map(|i| match row.get_ref(i).unwrap() {
                            rusqlite::types::ValueRef::Null => Value::Null,
                            rusqlite::types::ValueRef::Integer(v) => json!(v),
                            rusqlite::types::ValueRef::Real(v) => json!(v),
                            rusqlite::types::ValueRef::Text(v) => json!(String::from_utf8_lossy(v)),
                            rusqlite::types::ValueRef::Blob(_) => json!("<blob>"),
                        })
                        .collect(),
                ))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect()
        };
        json!({
            "folders": query("SELECT id, name, parent_id, icon FROM folders ORDER BY id"),
            "pages": query("SELECT id, folder_id, title, mode, ink_layer FROM pages ORDER BY id"),
            "segments": query("SELECT id, page_id, x, y, w, h, z_index, border_color, fill_color, content FROM segments ORDER BY id"),
            "attachments": query("SELECT id, segment_id, file_name, mime_type, size, sha256 FROM attachments ORDER BY id"),
            "dictionary": query("SELECT word FROM dictionary_words ORDER BY word"),
        })
    }

    fn doc_text(text: &str) -> Value {
        json!({ "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }] })
    }

    fn save_seg(conn: &Connection, id: &str, page_id: &str, x: f64, text: &str) {
        store::save_segment(conn, &json!({ "id": id, "pageId": page_id, "x": x, "y": 10, "w": 200, "h": 40, "content": doc_text(text) })).unwrap();
    }

    fn segment(conn: &Connection, id: &str) -> Option<Value> {
        let page_id: Option<String> =
            conn.query_row("SELECT page_id FROM segments WHERE id = ?1", [id], |r| r.get(0)).optional().unwrap();
        page_id.and_then(|p| store::list_segments(conn, &p).unwrap().into_iter().find(|s| s["id"] == id))
    }

    fn texts_on_page(conn: &Connection, page_id: &str) -> Vec<String> {
        let mut texts: Vec<String> =
            store::list_segments(conn, page_id).unwrap().iter().map(|s| store::flatten_tiptap_text(&s["content"])).collect();
        texts.sort();
        texts
    }

    /// Device A with a folder, page and segment, synced to a fresh device B.
    fn pair() -> (Connection, Connection) {
        let (a, b) = (device(), device());
        store::save_folder(&a, &json!({ "id": "f1", "name": "Notes" })).unwrap();
        store::save_page(&a, &json!({ "id": "p1", "folderId": "f1", "title": "Ideas" })).unwrap();
        save_seg(&a, "s1", "p1", 10.0, "hello");
        sync(&a, &b);
        (a, b)
    }

    #[test]
    fn row_readers_and_field_lists_agree() {
        let conn = device();
        store::save_folder(&conn, &json!({ "id": "f1", "name": "Notes" })).unwrap();
        store::save_page(&conn, &json!({ "id": "p1", "folderId": "f1", "title": "T" })).unwrap();
        save_seg(&conn, "s1", "p1", 0.0, "x");
        conn.execute(
            "INSERT INTO attachments (id, segment_id, file_name, mime_type, size, relative_path, created_at) VALUES ('a1','s1','f','m',1,'p',0)",
            [],
        )
        .unwrap();
        let keys = |c: &Collection| c.values().next().unwrap().iter().map(|(k, _)| *k).collect::<Vec<_>>();
        let nb = crdt::notebook_state(&conn).unwrap();
        assert_eq!(keys(&row_collection(&nb, "folders")), FOLDER_FIELDS);
        assert_eq!(keys(&row_collection(&nb, "pages")), PAGE_FIELDS);
        let (page, _) = crdt::page_state(&conn, "p1").unwrap();
        assert_eq!(keys(&row_collection(&page, "segments")), SEGMENT_FIELDS);
        assert_eq!(keys(&row_collection(&page, "attachments")), ATTACHMENT_FIELDS);
    }

    #[test]
    fn a_new_device_receives_everything() {
        let (a, b) = (device(), device());
        store::save_folder(&a, &json!({ "id": "f1", "name": "Notes", "icon": "📒" })).unwrap();
        store::save_folder(&a, &json!({ "id": "f2", "name": "Sub", "parentId": "f1" })).unwrap();
        store::save_page(&a, &json!({ "id": "p1", "folderId": "f2", "title": "Ideas" })).unwrap();
        store::set_page_mode(&a, &json!({ "pageId": "p1", "mode": "linear" })).unwrap();
        save_seg(&a, "s1", "p1", 10.0, "hello");
        a.execute(
            "INSERT INTO attachments (id, segment_id, file_name, mime_type, size, relative_path, created_at, sha256)
             VALUES ('a1', 's1', 'pic.png', 'image/png', 3, 'a1-pic.png', 0, 'abc')",
            [],
        )
        .unwrap();
        store::save_ink_layer(&a, &json!({ "pageId": "p1", "dataUrl": "data:ink" })).unwrap();
        store::add_dictionary_word(&a, "flownote").unwrap();

        let outcome = send(&a, &b);
        assert_eq!(outcome.changed_docs, ["notebook", "page:p1"]);
        assert_eq!(dump(&a), dump(&b));
        // Search works on the received text too.
        let hits = store::search(&b, &json!({ "query": "hello", "notebookId": "nb-1" })).unwrap();
        assert_eq!(hits.len(), 1);
    }

    #[test]
    fn applying_the_same_bundle_twice_changes_nothing() {
        let (a, b) = pair();
        let again = send(&a, &b);
        assert_eq!(again, ApplyOutcome::default());
        assert_eq!(dump(&a), dump(&b));
    }

    #[test]
    fn concurrent_edits_to_different_fields_both_survive() {
        let (a, b) = pair();
        save_seg(&a, "s1", "p1", 99.0, "hello"); // A moves it
        save_seg(&b, "s1", "p1", 10.0, "hello world"); // B edits the text
        sync(&a, &b);
        for conn in [&a, &b] {
            let s1 = segment(conn, "s1").unwrap();
            assert_eq!(s1["x"], json!(99.0));
            assert_eq!(store::flatten_tiptap_text(&s1["content"]), "hello world");
        }
        assert_eq!(dump(&a), dump(&b));
    }

    #[test]
    fn concurrent_text_edits_keep_both_versions() {
        let (a, b) = pair();
        save_seg(&a, "s1", "p1", 10.0, "version A");
        save_seg(&b, "s1", "p1", 10.0, "version B");
        let to_b = send(&a, &b);
        assert_eq!(to_b.conflict_copies.len(), 1);
        send(&b, &a);
        assert_eq!(dump(&a), dump(&b), "both devices end up identical");

        let texts = texts_on_page(&a, "p1");
        assert_eq!(texts.len(), 2, "{texts:?}");
        assert!(texts.iter().any(|t| t == "version A" || t == "version B"));
        assert!(texts.iter().any(|t| t.starts_with("Conflicting edit") && (t.ends_with("version A") || t.ends_with("version B"))));
        let copy = segment(&a, &to_b.conflict_copies[0]).unwrap();
        assert_eq!(copy["borderColor"], CONFLICT_BORDER);
        assert_eq!(copy["y"], json!(10.0 + 40.0 + CONFLICT_GAP), "placed under the lowest segment");
    }

    #[test]
    fn both_devices_detecting_the_same_conflict_make_one_copy() {
        let (a, b) = pair();
        save_seg(&a, "s1", "p1", 10.0, "version A");
        save_seg(&b, "s1", "p1", 10.0, "version B");
        // Each device receives the other's edit before hearing back.
        let bundle_a = bundle(&a);
        let bundle_b = bundle(&b);
        apply_bundle(&b, &bundle_a).unwrap();
        apply_bundle(&a, &bundle_b).unwrap();
        sync(&a, &b);
        assert_eq!(dump(&a), dump(&b));
        assert_eq!(texts_on_page(&a, "p1").len(), 2);
    }

    #[test]
    fn an_edit_beats_a_concurrent_delete_in_either_direction() {
        // A deletes, B edits.
        let (a, b) = pair();
        store::delete_segment(&a, "s1").unwrap();
        save_seg(&b, "s1", "p1", 10.0, "edited");
        sync(&a, &b);
        for conn in [&a, &b] {
            assert_eq!(store::flatten_tiptap_text(&segment(conn, "s1").expect("segment restored")["content"]), "edited");
        }
        assert_eq!(dump(&a), dump(&b));

        // A edits, B deletes — B's delete reaches A first this time.
        let (a, b) = pair();
        save_seg(&a, "s1", "p1", 10.0, "edited");
        store::delete_segment(&b, "s1").unwrap();
        sync(&b, &a);
        for conn in [&a, &b] {
            assert!(segment(conn, "s1").is_some());
        }
        assert_eq!(dump(&a), dump(&b));
    }

    #[test]
    fn a_plain_delete_reaches_the_other_device() {
        let (a, b) = pair();
        store::delete_segment(&a, "s1").unwrap();
        sync(&a, &b);
        assert!(segment(&b, "s1").is_none());

        store::delete_folder(&b, "f1").unwrap();
        sync(&b, &a);
        assert_eq!(dump(&a)["folders"], json!([]));
        assert_eq!(dump(&a), dump(&b));
    }

    #[test]
    fn a_page_deleted_on_one_device_and_edited_on_another_comes_back() {
        let (a, b) = pair();
        store::delete_page(&a, "p1").unwrap();
        save_seg(&b, "s1", "p1", 10.0, "still writing");
        sync(&a, &b);
        for conn in [&a, &b] {
            assert_eq!(texts_on_page(conn, "p1"), ["still writing"]);
        }
        assert_eq!(dump(&a), dump(&b));
    }

    #[test]
    fn a_folder_deleted_while_a_page_was_added_to_it_comes_back() {
        let (a, b) = pair();
        store::delete_folder(&a, "f1").unwrap();
        store::save_page(&b, &json!({ "id": "p2", "folderId": "f1", "title": "New" })).unwrap();
        save_seg(&b, "s2", "p2", 0.0, "new page");
        sync(&a, &b);
        for conn in [&a, &b] {
            let pages = store::list_pages(conn, "f1").unwrap();
            assert!(pages.iter().any(|p| p["id"] == "p2"), "{pages:?}");
        }
        assert_eq!(dump(&a), dump(&b));
    }

    #[test]
    fn folders_moved_into_each_other_do_not_form_a_cycle() {
        let (a, b) = pair();
        store::save_folder(&a, &json!({ "id": "f2", "name": "Two" })).unwrap();
        sync(&a, &b);
        store::save_folder(&a, &json!({ "id": "f1", "name": "Notes", "parentId": "f2" })).unwrap();
        store::save_folder(&b, &json!({ "id": "f2", "name": "Two", "parentId": "f1" })).unwrap();
        sync(&a, &b);
        sync(&a, &b);
        assert_eq!(dump(&a), dump(&b));
        let parents: Vec<Value> = dump(&a)["folders"].as_array().unwrap().iter().map(|f| f[2].clone()).collect();
        assert!(parents.contains(&Value::Null), "one of them is at the top level: {parents:?}");
    }

    #[test]
    fn an_offline_device_catches_up_on_many_changes() {
        let (a, b) = pair();
        for i in 0..20 {
            save_seg(&a, &format!("n{i}"), "p1", i as f64, &format!("note {i}"));
        }
        store::save_page(&a, &json!({ "id": "p2", "folderId": "f1", "title": "Second" })).unwrap();
        crdt::reconcile_dirty(&a).unwrap();
        save_seg(&a, "s1", "p1", 10.0, "hello, later");
        store::delete_segment(&a, "n3").unwrap();
        send(&a, &b);
        assert_eq!(dump(&a), dump(&b));
        assert_eq!(texts_on_page(&b, "p1").len(), 20);
    }

    #[test]
    fn unsynced_local_edits_are_kept_when_a_bundle_arrives() {
        let (a, b) = pair();
        // B types something and the bundle from A arrives before B's own
        // sync cycle reconciled it.
        save_seg(&b, "s2", "p1", 300.0, "typed on B");
        store::save_folder(&a, &json!({ "id": "f9", "name": "From A" })).unwrap();
        send(&a, &b);
        assert!(segment(&b, "s2").is_some());
        send(&b, &a);
        assert!(segment(&a, "s2").is_some());
        assert_eq!(dump(&a), dump(&b));
    }

    #[test]
    fn a_page_document_without_its_notebook_entry_is_not_wiped() {
        let (a, b) = (device(), device());
        store::save_folder(&a, &json!({ "id": "f1", "name": "Notes" })).unwrap();
        store::save_page(&a, &json!({ "id": "p1", "folderId": "f1", "title": "Ideas" })).unwrap();
        save_seg(&a, "s1", "p1", 0.0, "keep me");
        let page_only: Vec<_> = bundle(&a).into_iter().filter(|(id, _)| id == "page:p1").collect();
        apply_bundle(&b, &page_only).unwrap();
        crdt::reconcile(&b, "page:p1").unwrap();
        // Later the notebook arrives and the page appears with its text.
        send(&a, &b);
        assert_eq!(texts_on_page(&b, "p1"), ["keep me"]);
    }
}
