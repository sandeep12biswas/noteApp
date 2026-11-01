-- Sync S1: mark which Automerge document a write touched. Every insert,
-- update or delete on a synced table queues its document in sync_outbox, in
-- the same transaction as the write itself — including rows removed by an
-- ON DELETE CASCADE (deleting a folder queues every page under it). The sync
-- engine later rebuilds each queued document's changes from the current
-- rows (flownote_core::crdt::reconcile), so a burst of keystrokes becomes one
-- Automerge change, not one per keystroke.
--
-- Documents: 'notebook' (folders, pages, dictionary words) and
-- 'page:<page id>' (that page's segments, attachments and ink).
-- `expanded` is stored on folders but isn't synced (it's per-device view
-- state); queuing the notebook for it is harmless — reconcile finds nothing
-- to change.

CREATE TRIGGER sync_folders_insert AFTER INSERT ON folders BEGIN
  INSERT INTO sync_outbox (doc_id, queued_at) VALUES ('notebook', strftime('%s', 'now') * 1000)
    ON CONFLICT (doc_id) DO NOTHING;
END;
CREATE TRIGGER sync_folders_update AFTER UPDATE ON folders BEGIN
  INSERT INTO sync_outbox (doc_id, queued_at) VALUES ('notebook', strftime('%s', 'now') * 1000)
    ON CONFLICT (doc_id) DO NOTHING;
END;
CREATE TRIGGER sync_folders_delete AFTER DELETE ON folders BEGIN
  INSERT INTO sync_outbox (doc_id, queued_at) VALUES ('notebook', strftime('%s', 'now') * 1000)
    ON CONFLICT (doc_id) DO NOTHING;
END;

-- A page's title/folder/mode live in the notebook document, its ink in its
-- own page document — queue both.
CREATE TRIGGER sync_pages_insert AFTER INSERT ON pages BEGIN
  INSERT INTO sync_outbox (doc_id, queued_at) VALUES
    ('notebook', strftime('%s', 'now') * 1000),
    ('page:' || NEW.id, strftime('%s', 'now') * 1000)
    ON CONFLICT (doc_id) DO NOTHING;
END;
CREATE TRIGGER sync_pages_update AFTER UPDATE ON pages BEGIN
  INSERT INTO sync_outbox (doc_id, queued_at) VALUES
    ('notebook', strftime('%s', 'now') * 1000),
    ('page:' || NEW.id, strftime('%s', 'now') * 1000)
    ON CONFLICT (doc_id) DO NOTHING;
END;
CREATE TRIGGER sync_pages_delete AFTER DELETE ON pages BEGIN
  INSERT INTO sync_outbox (doc_id, queued_at) VALUES
    ('notebook', strftime('%s', 'now') * 1000),
    ('page:' || OLD.id, strftime('%s', 'now') * 1000)
    ON CONFLICT (doc_id) DO NOTHING;
END;

CREATE TRIGGER sync_segments_insert AFTER INSERT ON segments BEGIN
  INSERT INTO sync_outbox (doc_id, queued_at) VALUES ('page:' || NEW.page_id, strftime('%s', 'now') * 1000)
    ON CONFLICT (doc_id) DO NOTHING;
END;
CREATE TRIGGER sync_segments_update AFTER UPDATE ON segments BEGIN
  INSERT INTO sync_outbox (doc_id, queued_at) VALUES
    ('page:' || NEW.page_id, strftime('%s', 'now') * 1000),
    ('page:' || OLD.page_id, strftime('%s', 'now') * 1000)
    ON CONFLICT (doc_id) DO NOTHING;
END;
CREATE TRIGGER sync_segments_delete AFTER DELETE ON segments BEGIN
  INSERT INTO sync_outbox (doc_id, queued_at) VALUES ('page:' || OLD.page_id, strftime('%s', 'now') * 1000)
    ON CONFLICT (doc_id) DO NOTHING;
END;

-- Attachments belong to a segment; find its page. When the segment itself
-- is being deleted (cascade), its row is already gone and the segment's own
-- delete trigger has queued the page.
CREATE TRIGGER sync_attachments_insert AFTER INSERT ON attachments BEGIN
  INSERT INTO sync_outbox (doc_id, queued_at)
    SELECT 'page:' || page_id, strftime('%s', 'now') * 1000 FROM segments WHERE id = NEW.segment_id
    ON CONFLICT (doc_id) DO NOTHING;
END;
CREATE TRIGGER sync_attachments_update AFTER UPDATE ON attachments BEGIN
  INSERT INTO sync_outbox (doc_id, queued_at)
    SELECT 'page:' || page_id, strftime('%s', 'now') * 1000 FROM segments WHERE id IN (NEW.segment_id, OLD.segment_id)
    ON CONFLICT (doc_id) DO NOTHING;
END;
CREATE TRIGGER sync_attachments_delete AFTER DELETE ON attachments BEGIN
  INSERT INTO sync_outbox (doc_id, queued_at)
    SELECT 'page:' || page_id, strftime('%s', 'now') * 1000 FROM segments WHERE id = OLD.segment_id
    ON CONFLICT (doc_id) DO NOTHING;
END;

CREATE TRIGGER sync_dictionary_insert AFTER INSERT ON dictionary_words BEGIN
  INSERT INTO sync_outbox (doc_id, queued_at) VALUES ('notebook', strftime('%s', 'now') * 1000)
    ON CONFLICT (doc_id) DO NOTHING;
END;
CREATE TRIGGER sync_dictionary_delete AFTER DELETE ON dictionary_words BEGIN
  INSERT INTO sync_outbox (doc_id, queued_at) VALUES ('notebook', strftime('%s', 'now') * 1000)
    ON CONFLICT (doc_id) DO NOTHING;
END;
