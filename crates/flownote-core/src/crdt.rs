//! Automerge documents that mirror the SQLite notebook, for sync
//! (EXECUTION_PLAN.md P1 "CRDT sync": bring-your-own-cloud, one change log
//! per device). SQLite stays the source of truth the UI and search read;
//! these documents exist only so devices can merge each other's edits.
//!
//! Two kinds of document:
//! - `notebook` — `folders`, `pages` and `dictionary` maps;
//! - `page:<page id>` — that page's `segments` and `attachments` maps, plus
//!   its `ink` (one value: the page's ink layer as a data URL).
//!
//! Each record is a map of scalar fields plus a `deleted` flag. A delete only
//! sets `deleted: true` — the record and its last content stay in the
//! document, so nothing deleted on one device is ever unrecoverable, and an
//! edit made concurrently on another device can bring it back (S2).
//!
//! Local writes don't touch these documents directly. V9's triggers queue
//! the document a write touched in `sync_outbox`; [`reconcile`] later
//! compares the document with the current rows and records the difference
//! as one Automerge change. Only fields whose value actually differs are
//! written, so an unchanged field never creates a spurious conflict.

use automerge::transaction::{CommitOptions, Transactable};
use automerge::{ActorId, AutoCommit, ObjId, ObjType, ReadDoc, ScalarValue, Value as AmValue, ROOT};
use rusqlite::types::ToSql;
use rusqlite::{Connection, OptionalExtension};
use serde_json::Value;
use std::collections::BTreeMap;

use crate::store::{in_transaction, now_ms};

pub const NOTEBOOK_DOC: &str = "notebook";
pub(crate) const PAGE_DOC_PREFIX: &str = "page:";

pub fn page_doc_id(page_id: &str) -> String {
    format!("{PAGE_DOC_PREFIX}{page_id}")
}

const NOTEBOOK_COLLECTIONS: &[&str] = &["folders", "pages", "dictionary"];
const PAGE_COLLECTIONS: &[&str] = &["segments", "attachments"];

/// One record's synced fields.
pub(crate) type Fields = Vec<(&'static str, ScalarValue)>;
/// What one collection should contain: record id → fields.
pub(crate) type Collection = BTreeMap<String, Fields>;

pub(crate) fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// The first change of every document, byte-for-byte identical on every
/// device (fixed actor, fixed time): it creates the top-level collection
/// maps. If each device created its own `segments` map instead, two devices
/// would hold two different maps under the same key, and merging them would
/// hide one device's records behind the other's.
pub(crate) fn genesis(doc_id: &str) -> Result<AutoCommit, String> {
    let mut doc = AutoCommit::new().with_actor(ActorId::from([0u8; 16]));
    let collections = if doc_id == NOTEBOOK_DOC { NOTEBOOK_COLLECTIONS } else { PAGE_COLLECTIONS };
    for name in collections {
        doc.put_object(ROOT, *name, ObjType::Map).map_err(err)?;
    }
    if doc_id != NOTEBOOK_DOC {
        doc.put(ROOT, "ink", ScalarValue::Null).map_err(err)?;
    }
    doc.commit_with(CommitOptions::default().with_time(0));
    Ok(doc)
}

/// This device's id, created on first use. It names the device's folder in
/// the cloud and is its Automerge actor, so it must differ on every device —
/// a database restored onto a second device needs a new one (S4).
pub fn device_id(conn: &Connection) -> Result<String, String> {
    let existing: Option<String> = conn
        .query_row("SELECT device_id FROM sync_settings WHERE id = 1", [], |row| row.get(0))
        .optional()
        .map_err(err)?;
    if let Some(id) = existing {
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute("INSERT INTO sync_settings (id, device_id) VALUES (1, ?1)", [&id]).map_err(err)?;
    Ok(id)
}

pub(crate) fn device_actor(conn: &Connection) -> Result<ActorId, String> {
    let id = uuid::Uuid::parse_str(&device_id(conn)?).map_err(err)?;
    Ok(ActorId::from(*id.as_bytes()))
}

pub fn load_doc(conn: &Connection, doc_id: &str) -> Result<Option<AutoCommit>, String> {
    let bytes: Option<Vec<u8>> = conn
        .query_row("SELECT bytes FROM crdt_docs WHERE doc_id = ?1", [doc_id], |row| row.get(0))
        .optional()
        .map_err(err)?;
    bytes.map(|b| AutoCommit::load(&b).map_err(err)).transpose()
}

pub(crate) fn store_doc(conn: &Connection, doc_id: &str, doc: &mut AutoCommit) -> Result<(), String> {
    conn.execute(
        "INSERT INTO crdt_docs (doc_id, bytes, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(doc_id) DO UPDATE SET bytes = excluded.bytes, updated_at = excluded.updated_at",
        rusqlite::params![doc_id, doc.save(), now_ms()],
    )
    .map_err(err)?;
    Ok(())
}

pub(crate) fn opt_str(value: Option<String>) -> ScalarValue {
    value.map(ScalarValue::from).unwrap_or(ScalarValue::Null)
}

fn collect(
    conn: &Connection,
    sql: &str,
    params: &[&dyn ToSql],
    row_fields: impl Fn(&rusqlite::Row) -> rusqlite::Result<(String, Fields)>,
) -> Result<Collection, String> {
    let mut stmt = conn.prepare(sql).map_err(err)?;
    let rows = stmt.query_map(params, |row| row_fields(row)).map_err(err)?;
    rows.collect::<Result<_, _>>().map_err(err)
}

pub(crate) fn notebook_state(conn: &Connection) -> Result<Vec<(&'static str, Collection)>, String> {
    let folders = collect(conn, "SELECT id, name, parent_id, icon FROM folders", &[], |row| {
        Ok((
            row.get(0)?,
            vec![
                ("name", ScalarValue::from(row.get::<_, String>(1)?)),
                ("parentId", opt_str(row.get(2)?)),
                ("icon", opt_str(row.get(3)?)),
            ],
        ))
    })?;
    let pages = collect(conn, "SELECT id, folder_id, title, mode FROM pages", &[], |row| {
        Ok((
            row.get(0)?,
            vec![
                ("folderId", opt_str(row.get(1)?)),
                ("title", ScalarValue::from(row.get::<_, String>(2)?)),
                ("mode", ScalarValue::from(row.get::<_, String>(3)?)),
            ],
        ))
    })?;
    let dictionary = collect(conn, "SELECT word FROM dictionary_words", &[], |row| Ok((row.get(0)?, vec![])))?;
    Ok(vec![("folders", folders), ("pages", pages), ("dictionary", dictionary)])
}

/// The page's collections, and its ink — `None` when the page itself no
/// longer exists (deleted), in which case the document's ink is left alone.
#[allow(clippy::type_complexity)]
pub(crate) fn page_state(conn: &Connection, page_id: &str) -> Result<(Vec<(&'static str, Collection)>, Option<Option<String>>), String> {
    let segments = collect(
        conn,
        "SELECT id, x, y, w, h, z_index, border_color, fill_color, content FROM segments WHERE page_id = ?1",
        &[&page_id],
        |row| {
            Ok((
                row.get(0)?,
                vec![
                    ("x", ScalarValue::F64(row.get(1)?)),
                    ("y", ScalarValue::F64(row.get(2)?)),
                    ("w", ScalarValue::F64(row.get(3)?)),
                    ("h", ScalarValue::F64(row.get(4)?)),
                    ("zIndex", ScalarValue::Int(row.get(5)?)),
                    ("borderColor", opt_str(row.get(6)?)),
                    ("fillColor", opt_str(row.get(7)?)),
                    ("content", ScalarValue::from(row.get::<_, String>(8)?)),
                ],
            ))
        },
    )?;
    let attachments = collect(
        conn,
        "SELECT a.id, a.segment_id, a.file_name, a.mime_type, a.size, a.sha256
         FROM attachments a JOIN segments s ON a.segment_id = s.id WHERE s.page_id = ?1",
        &[&page_id],
        |row| {
            Ok((
                row.get(0)?,
                vec![
                    ("segmentId", ScalarValue::from(row.get::<_, String>(1)?)),
                    ("fileName", ScalarValue::from(row.get::<_, String>(2)?)),
                    ("mimeType", ScalarValue::from(row.get::<_, String>(3)?)),
                    ("size", ScalarValue::Int(row.get(4)?)),
                    ("sha256", opt_str(row.get(5)?)),
                ],
            ))
        },
    )?;
    let ink: Option<Option<String>> = conn
        .query_row("SELECT ink_layer FROM pages WHERE id = ?1", [page_id], |row| row.get(0))
        .optional()
        .map_err(err)?;
    Ok((vec![("segments", segments), ("attachments", attachments)], ink))
}

pub(crate) fn collection_obj(doc: &AutoCommit, name: &str) -> Result<ObjId, String> {
    match doc.get(ROOT, name).map_err(err)? {
        Some((AmValue::Object(ObjType::Map), id)) => Ok(id),
        _ => Err(format!("document has no `{name}` map")),
    }
}

pub(crate) fn record_obj(doc: &AutoCommit, collection: &ObjId, id: &str) -> Result<Option<ObjId>, String> {
    match doc.get(collection, id).map_err(err)? {
        Some((AmValue::Object(ObjType::Map), record)) => Ok(Some(record)),
        _ => Ok(None),
    }
}

pub(crate) fn scalar_at(doc: &AutoCommit, obj: &ObjId, key: &str) -> Result<Option<ScalarValue>, String> {
    match doc.get(obj, key).map_err(err)? {
        Some((AmValue::Scalar(value), _)) => Ok(Some(value.into_owned())),
        _ => Ok(None),
    }
}

pub(crate) fn put_if_changed(doc: &mut AutoCommit, obj: &ObjId, key: &str, value: ScalarValue) -> Result<(), String> {
    if scalar_at(doc, obj, key)?.as_ref() != Some(&value) {
        doc.put(obj, key, value).map_err(err)?;
    }
    Ok(())
}

/// Brings one collection map in line with `desired`: new records are added,
/// changed fields rewritten, and records no longer in `desired` flagged
/// `deleted` (never removed).
fn reconcile_collection(doc: &mut AutoCommit, name: &str, desired: &Collection) -> Result<(), String> {
    let collection = collection_obj(doc, name)?;
    for (id, fields) in desired {
        let record = match record_obj(doc, &collection, id)? {
            Some(record) => record,
            None => doc.put_object(&collection, id.as_str(), ObjType::Map).map_err(err)?,
        };
        for (key, value) in fields {
            put_if_changed(doc, &record, key, value.clone())?;
        }
        put_if_changed(doc, &record, "deleted", false.into())?;
    }
    let existing: Vec<String> = doc.keys(&collection).collect();
    for id in existing.iter().filter(|id| !desired.contains_key(*id)) {
        if let Some(record) = record_obj(doc, &collection, id)? {
            put_if_changed(doc, &record, "deleted", true.into())?;
        }
    }
    Ok(())
}

/// Records the difference between `doc_id`'s document and the current rows
/// as one Automerge change by this device, saves the document, and takes it
/// off `sync_outbox`. Returns whether there was any difference.
pub fn reconcile(conn: &Connection, doc_id: &str) -> Result<bool, String> {
    in_transaction(conn, || {
        let mut doc = match load_doc(conn, doc_id)? {
            Some(doc) => doc,
            None => genesis(doc_id)?,
        };
        doc.set_actor(device_actor(conn)?);

        if doc_id == NOTEBOOK_DOC {
            for (name, desired) in notebook_state(conn)? {
                reconcile_collection(&mut doc, name, &desired)?;
            }
        } else if let Some(page_id) = doc_id.strip_prefix(PAGE_DOC_PREFIX) {
            let (collections, ink) = page_state(conn, page_id)?;
            // No page row means its segments are gone too — but that only
            // means they were deleted if the notebook says the page was.
            // Otherwise (the page hasn't been written back from a merge yet)
            // flagging them would delete another device's notes.
            if ink.is_some() || page_deleted_in_notebook(conn, page_id)? {
                for (name, desired) in collections {
                    reconcile_collection(&mut doc, name, &desired)?;
                }
            }
            if let Some(ink) = ink {
                put_if_changed(&mut doc, &ROOT, "ink", opt_str(ink))?;
            }
        } else {
            return Err(format!("unknown sync document `{doc_id}`"));
        }

        // A brand-new document with nothing in it isn't saved at all (e.g. a
        // page created and deleted again before it was reconciled).
        let changed = doc.commit_with(CommitOptions::default().with_time(now_ms())).is_some();
        if changed {
            store_doc(conn, doc_id, &mut doc)?;
        }
        conn.execute("DELETE FROM sync_outbox WHERE doc_id = ?1", [doc_id]).map_err(err)?;
        Ok(changed)
    })
}

/// Whether the notebook document has `page_id`'s record flagged `deleted`.
fn page_deleted_in_notebook(conn: &Connection, page_id: &str) -> Result<bool, String> {
    let Some(notebook) = load_doc(conn, NOTEBOOK_DOC)? else { return Ok(false) };
    let pages = collection_obj(&notebook, "pages")?;
    let Some(record) = record_obj(&notebook, &pages, page_id)? else { return Ok(false) };
    Ok(scalar_at(&notebook, &record, "deleted")? == Some(true.into()))
}

/// Reconciles every queued document; returns the ids of those that changed.
/// The notebook goes first, so a deleted page is flagged there before its
/// page document's reconcile asks whether it was deleted.
pub fn reconcile_dirty(conn: &Connection) -> Result<Vec<String>, String> {
    let queued: Vec<String> = conn
        .prepare("SELECT doc_id FROM sync_outbox ORDER BY doc_id != 'notebook', queued_at, doc_id")
        .map_err(err)?
        .query_map([], |row| row.get(0))
        .map_err(err)?
        .collect::<Result<_, _>>()
        .map_err(err)?;
    let mut changed = Vec::new();
    for doc_id in queued {
        if reconcile(conn, &doc_id)? {
            changed.push(doc_id);
        }
    }
    Ok(changed)
}

/// First-time setup: builds the documents for everything already in the
/// database (the notebook and every page), then reconciles them.
pub fn bootstrap(conn: &Connection) -> Result<Vec<String>, String> {
    let now = now_ms();
    conn.execute(
        "INSERT OR IGNORE INTO sync_outbox (doc_id, queued_at)
         SELECT ?1, ?2 UNION ALL SELECT 'page:' || id, ?2 FROM pages",
        rusqlite::params![NOTEBOOK_DOC, now],
    )
    .map_err(err)?;
    reconcile_dirty(conn)
}

pub(crate) fn scalar_to_json(value: &ScalarValue) -> Value {
    match value {
        ScalarValue::Str(s) => Value::from(s.as_str()),
        ScalarValue::F64(f) => Value::from(*f),
        ScalarValue::Int(i) => Value::from(*i),
        ScalarValue::Uint(u) => Value::from(*u),
        ScalarValue::Boolean(b) => Value::from(*b),
        _ => Value::Null,
    }
}

/// The records of one collection that aren't flagged `deleted`, as JSON
/// objects keyed by record id (without the `deleted` field).
pub fn live_records(doc: &AutoCommit, collection: &str) -> Result<BTreeMap<String, Value>, String> {
    let collection = collection_obj(doc, collection)?;
    let mut out = BTreeMap::new();
    for id in doc.keys(&collection) {
        let Some(record) = record_obj(doc, &collection, &id)? else { continue };
        if scalar_at(doc, &record, "deleted")? == Some(true.into()) {
            continue;
        }
        let mut fields = serde_json::Map::new();
        for key in doc.keys(&record).filter(|k| k != "deleted") {
            if let Some(value) = scalar_at(doc, &record, &key)? {
                fields.insert(key, scalar_to_json(&value));
            }
        }
        out.insert(id, Value::Object(fields));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::store;
    use serde_json::json;

    fn seed(conn: &Connection) {
        store::save_folder(conn, &json!({ "id": "f1", "name": "Notes", "icon": "📒" })).unwrap();
        store::save_folder(conn, &json!({ "id": "f2", "name": "Work", "parentId": "f1" })).unwrap();
        store::save_page(conn, &json!({ "id": "p1", "folderId": "f1", "title": "Ideas" })).unwrap();
        store::save_page(conn, &json!({ "id": "p2", "folderId": "f2", "title": "Plan" })).unwrap();
        save_seg(conn, "s1", "p1", "hello");
        save_seg(conn, "s2", "p2", "world");
        store::add_dictionary_word(conn, "FlowNote").unwrap();
    }

    fn save_seg(conn: &Connection, id: &str, page_id: &str, text: &str) {
        store::save_segment(
            conn,
            &json!({ "id": id, "pageId": page_id, "x": 10, "y": 20.5, "w": 300, "h": 40, "zIndex": 2,
                     "borderColor": "#f00", "fillColor": null,
                     "content": { "type": "doc", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": text }] }] } }),
        )
        .unwrap();
    }

    fn outbox(conn: &Connection) -> Vec<String> {
        conn.prepare("SELECT doc_id FROM sync_outbox ORDER BY doc_id")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    fn doc(conn: &Connection, doc_id: &str) -> AutoCommit {
        load_doc(conn, doc_id).unwrap().unwrap_or_else(|| panic!("no document {doc_id}"))
    }

    #[test]
    fn writes_queue_the_documents_they_touch() {
        let conn = db::open_in_memory().unwrap();
        seed(&conn);
        assert_eq!(outbox(&conn), ["notebook", "page:p1", "page:p2"]);

        reconcile_dirty(&conn).unwrap();
        assert!(outbox(&conn).is_empty());

        // A cascade counts: deleting f1 removes f2, both pages and their
        // segments — every one of their documents is queued.
        store::delete_folder(&conn, "f1").unwrap();
        assert_eq!(outbox(&conn), ["notebook", "page:p1", "page:p2"]);
    }

    #[test]
    fn bootstrap_mirrors_every_row() {
        let conn = db::open_in_memory().unwrap();
        seed(&conn);
        conn.execute(
            "INSERT INTO attachments (id, segment_id, file_name, mime_type, size, relative_path, created_at, sha256)
             VALUES ('a1', 's1', 'pic.png', 'image/png', 42, 'a1-pic.png', 0, 'abc')",
            [],
        )
        .unwrap();
        store::save_ink_layer(&conn, &json!({ "pageId": "p1", "dataUrl": "data:image/png;base64,AA" })).unwrap();
        conn.execute("DELETE FROM sync_outbox", []).unwrap(); // bootstrap must not rely on the triggers

        let changed = bootstrap(&conn).unwrap();
        assert_eq!(changed, ["notebook", "page:p1", "page:p2"]);

        let notebook = doc(&conn, NOTEBOOK_DOC);
        assert_eq!(
            live_records(&notebook, "folders").unwrap()["f2"],
            json!({ "name": "Work", "parentId": "f1", "icon": null })
        );
        assert_eq!(
            live_records(&notebook, "pages").unwrap()["p1"],
            json!({ "folderId": "f1", "title": "Ideas", "mode": "canvas" })
        );
        assert!(live_records(&notebook, "dictionary").unwrap().contains_key("flownote"));

        let page = doc(&conn, "page:p1");
        let s1 = &live_records(&page, "segments").unwrap()["s1"];
        assert_eq!(s1["x"], json!(10.0));
        assert_eq!(s1["y"], json!(20.5));
        assert_eq!(s1["zIndex"], json!(2));
        assert_eq!(s1["borderColor"], json!("#f00"));
        assert_eq!(s1["fillColor"], Value::Null);
        // The content round-trips to exactly what list_segments returns.
        let content: Value = serde_json::from_str(s1["content"].as_str().unwrap()).unwrap();
        assert_eq!(content, store::list_segments(&conn, "p1").unwrap()[0]["content"]);
        assert_eq!(
            live_records(&page, "attachments").unwrap()["a1"],
            json!({ "segmentId": "s1", "fileName": "pic.png", "mimeType": "image/png", "size": 42, "sha256": "abc" })
        );
        assert_eq!(scalar_at(&page, &ROOT, "ink").unwrap(), Some("data:image/png;base64,AA".into()));
    }

    #[test]
    fn reconciling_unchanged_rows_records_nothing() {
        let conn = db::open_in_memory().unwrap();
        seed(&conn);
        bootstrap(&conn).unwrap();
        let heads = doc(&conn, "page:p1").get_heads();

        // Re-saving identical values queues the page but changes nothing.
        save_seg(&conn, "s1", "p1", "hello");
        assert!(!reconcile(&conn, "page:p1").unwrap());
        assert_eq!(doc(&conn, "page:p1").get_heads(), heads);

        // A real edit is one new change, touching only that field.
        save_seg(&conn, "s1", "p1", "hello again");
        assert!(reconcile(&conn, "page:p1").unwrap());
        let mut page = doc(&conn, "page:p1");
        let new_changes = page.get_changes(&heads);
        assert_eq!(new_changes.len(), 1);
        assert_eq!(new_changes[0].len(), 1, "only `content` should be rewritten");
    }

    #[test]
    fn deletes_are_flags_and_keep_the_last_content() {
        let conn = db::open_in_memory().unwrap();
        seed(&conn);
        bootstrap(&conn).unwrap();

        store::delete_segment(&conn, "s1").unwrap();
        reconcile_dirty(&conn).unwrap();

        let page = doc(&conn, "page:p1");
        assert!(live_records(&page, "segments").unwrap().is_empty());
        let segments = collection_obj(&page, "segments").unwrap();
        let s1 = record_obj(&page, &segments, "s1").unwrap().expect("record kept");
        assert_eq!(scalar_at(&page, &s1, "deleted").unwrap(), Some(true.into()));
        let content = scalar_at(&page, &s1, "content").unwrap().unwrap();
        assert!(content.to_str().unwrap().contains("hello"));
    }

    #[test]
    fn local_changes_are_made_by_this_device() {
        let conn = db::open_in_memory().unwrap();
        seed(&conn);
        bootstrap(&conn).unwrap();
        let device = device_id(&conn).unwrap();
        assert_eq!(device_id(&conn).unwrap(), device, "the device id is stable");

        let mut page = doc(&conn, "page:p1");
        let heads = page.get_heads();
        let change = page.get_change_by_hash(&heads[0]).unwrap();
        assert_eq!(change.actor_id(), &ActorId::from(*uuid::Uuid::parse_str(&device).unwrap().as_bytes()));
    }

    #[test]
    fn two_devices_documents_merge_without_hiding_each_others_records() {
        // Each device starts its page document on its own; because the
        // genesis change is identical, both share one `segments` map and
        // merging keeps both devices' segments.
        let a = db::open_in_memory().unwrap();
        let b = db::open_in_memory().unwrap();
        for (conn, seg) in [(&a, "sa"), (&b, "sb")] {
            store::save_folder(conn, &json!({ "id": "f1", "name": "Notes" })).unwrap();
            store::save_page(conn, &json!({ "id": "p1", "folderId": "f1", "title": "Shared" })).unwrap();
            save_seg(conn, seg, "p1", seg);
            bootstrap(conn).unwrap();
        }
        assert_ne!(device_id(&a).unwrap(), device_id(&b).unwrap());

        let mut doc_a = doc(&a, "page:p1");
        let mut doc_b = doc(&b, "page:p1");
        doc_a.merge(&mut doc_b).unwrap();
        let ids: Vec<String> = live_records(&doc_a, "segments").unwrap().into_keys().collect();
        assert_eq!(ids, ["sa", "sb"]);
    }
}
