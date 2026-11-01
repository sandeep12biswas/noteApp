-- CRDT sync foundations (EXECUTION_PLAN.md Phase 5 "CRDT sync"; plan:
-- bring-your-own-cloud sync to OneDrive / Google Drive, end-to-end
-- encrypted). Only tables here — nothing writes to them until the sync
-- engine lands; SQLite stays the source of truth the UI and search read.

-- This device's sync configuration: a single row (id = 1), created on first
-- use. `device_id` names this device's own folder in the cloud
-- (devices/<device_id>/…) — every device writes only its own files there,
-- which is what lets plain cloud drives work without locking.
--
-- `target` is 'none' | 'onedrive' | 'gdrive' (and later others). Like
-- ai_providers.api_key, the OAuth tokens and the passphrase-derived vault
-- key are stored here in plain text and are never returned to the renderer
-- — only whether they're set.
CREATE TABLE sync_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL DEFAULT '',
  target TEXT NOT NULL DEFAULT 'none',
  account_label TEXT,
  oauth_tokens TEXT,
  vault_key TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  last_sync_at INTEGER,
  last_error TEXT
);

-- One Automerge document per notebook ('notebook') and per page
-- ('page:<page id>'), saved in Automerge's binary format. `synced_heads` is
-- the JSON array of change hashes already uploaded, so the next push only
-- sends what's new.
CREATE TABLE crdt_docs (
  doc_id TEXT PRIMARY KEY,
  bytes BLOB NOT NULL,
  synced_heads TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER
);

-- Documents whose rows changed since their Automerge doc was last brought up
-- to date (V9's triggers fill it, in the same transaction as the write, so a
-- crash can't lose track of one). What still needs uploading is the doc's
-- changes after crdt_docs.synced_heads.
CREATE TABLE sync_outbox (
  doc_id TEXT PRIMARY KEY,
  queued_at INTEGER NOT NULL
);

-- Attachment bytes sync as content-addressed blobs (blobs/<sha256>), so each
-- row records its file's hash. NULL for attachments saved before this
-- migration; the sync engine hashes those on first upload.
ALTER TABLE attachments ADD COLUMN sha256 TEXT;
