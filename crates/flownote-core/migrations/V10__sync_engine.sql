-- Sync engine state (sync step S4; flownote_core::sync).

-- `upload_seq` numbers this device's change files in the cloud
-- (devices/<device_id>/changes/<seq>.bundle.enc). `vault_id` is the id in
-- the cloud's vault.json this device was set up with: if the cloud folder
-- is deleted and a new vault created, syncing stops instead of mixing
-- two vaults. `last_backup_at`: the local database is copied to
-- backups/ before the first sync and then daily.
ALTER TABLE sync_settings ADD COLUMN vault_id TEXT;
ALTER TABLE sync_settings ADD COLUMN upload_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_settings ADD COLUMN last_backup_at INTEGER;

-- Every other device seen in the cloud, and the last of its change files
-- this device has applied.
CREATE TABLE sync_peers (
  device_id TEXT PRIMARY KEY,
  name TEXT,
  applied_seq INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER
);

-- Cloud files that couldn't be read (damaged, not decryptable, or not a
-- FlowNote file). Never treated as empty: the device's later change files
-- wait behind it, and the entry clears once the file reads correctly.
CREATE TABLE sync_quarantine (
  path TEXT PRIMARY KEY,
  error TEXT NOT NULL,
  at INTEGER NOT NULL
);
