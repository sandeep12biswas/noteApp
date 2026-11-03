-- File attachments (EXECUTION_PLAN.md "Features" — file attachment support).
-- A segment can hold zero or more attachments, referenced by id from an
-- `attachmentBlock` node inside that segment's TipTap `content` JSON
-- (packages/frontend/src/canvas/attachmentBlockNode.tsx) — this table only
-- carries metadata plus where the actual bytes live on disk;
-- `relative_path` is relative to `<db file's parent>/attachments/` (derived
-- at runtime via `rusqlite::Connection::path()`, not stored as an absolute,
-- machine-specific path here).
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  segment_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  relative_path TEXT NOT NULL,
  created_at INTEGER,
  FOREIGN KEY (segment_id) REFERENCES segments(id) ON DELETE CASCADE
);
