-- Sync compaction (sync step S8; flownote_core::sync `compact`).
--
-- A device compacts only its own log: it writes devices/<id>/snapshot.enc
-- (the full state of its documents as of upload number `snapshot_seq`),
-- then deletes its own change files up to the lowest number every recently
-- active device has applied. `compacted_at` is when it last tried to
-- delete, so a deletion blocked by a lagging device is retried daily, not
-- every cycle.
ALTER TABLE sync_settings ADD COLUMN snapshot_seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_settings ADD COLUMN compacted_at INTEGER;
