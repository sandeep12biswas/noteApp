-- Phase 5 "Full-text search": replaces V1's `blocks_fts` (an FTS5 "external
-- content" table, `content=blocks`/`content_rowid=rowid`) with a
-- self-contained FTS5 table. External-content mode ties the index to
-- `blocks`'s own SQLite rowid and needs every write mirrored through the
-- FTS5 "special command" rows (`INSERT INTO blocks_fts(blocks_fts, rowid,
-- ...) VALUES ('delete', ...)` etc) via triggers — safe to edit V1 → V3 in
-- place here since neither has shipped yet. Simpler for our per-segment,
-- occasional-write volume: `flownote-electron/src/protocol.rs` just
-- DELETEs-then-INSERTs the one row for a segment's block on every
-- `save_segment`/`delete_segment`, keyed by the (UNINDEXED, so not
-- searched, only matched exactly) `block_id` column — no rowid coupling,
-- no triggers.
DROP TABLE blocks_fts;

CREATE VIRTUAL TABLE blocks_fts USING fts5(block_id UNINDEXED, content);
