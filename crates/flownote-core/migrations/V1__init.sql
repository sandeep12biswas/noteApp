-- Initial schema — DESIGN.md §7.2.
-- WAL mode and foreign keys are enabled by the connection setup in db.rs,
-- not here, since PRAGMAs are per-connection rather than persisted schema.

CREATE TABLE pages (
  id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL,
  title TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'canvas',
  created_at INTEGER, updated_at INTEGER
);

CREATE TABLE segments (
  id TEXT PRIMARY KEY, page_id TEXT NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL,
  w REAL NOT NULL DEFAULT 280, h REAL NOT NULL DEFAULT 40,
  z_index INTEGER DEFAULT 0,
  border_color TEXT, fill_color TEXT,
  ink_layer TEXT,
  created_at INTEGER, updated_at INTEGER,
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);
CREATE INDEX idx_segments_page_pos ON segments(page_id, x, y);

CREATE TABLE blocks (
  id TEXT PRIMARY KEY, segment_id TEXT NOT NULL,
  position INTEGER NOT NULL, type TEXT NOT NULL,
  content TEXT NOT NULL, attrs TEXT DEFAULT '{}',
  FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE blocks_fts USING fts5(
  block_id UNINDEXED, content, content=blocks, content_rowid=rowid
);

-- Plugin system tables (DESIGN.md §7.2, added v1.4)
CREATE TABLE plugins (
  id           TEXT PRIMARY KEY,     -- e.g. com.sandeep.spreadsheet
  name         TEXT NOT NULL,
  version      TEXT NOT NULL,
  manifest_json TEXT NOT NULL,       -- full flownote-plugin.json stored as JSON
  enabled      INTEGER NOT NULL DEFAULT 1,
  installed_at INTEGER NOT NULL
);

CREATE TABLE plugin_storage (
  plugin_id TEXT NOT NULL,
  key       TEXT NOT NULL,
  value     TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key),
  FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
);
