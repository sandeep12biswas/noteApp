-- Folders + segment content — DESIGN.md §2.1/§2.2 (folder/file panels) and
-- §7.1 (Segment.content). V1 shipped `pages`/`segments` without a folder
-- hierarchy (the frontend's folder/file panels were still client-state-only
-- per EXECUTION_PLAN.md Phase 2) and without a place to persist a segment's
-- rich-text body. This migration adds both, deliberately minimal:
--   - `folders`: mirrors packages/frontend/src/store/notebookStore.ts's
--     `Folder` shape one-for-one.
--   - `pages.folder_id`: a file "belongs to" a folder the same way it did
--     client-side (`FileEntry.folderId`). Nullable so existing v1 rows
--     migrate cleanly.
--   - `segments.content`: the segment's TipTap JSON document, serialised.
--     Decomposing this into per-node `blocks` rows (already in the v1
--     schema) for block-level FTS is Phase 5's "Full-text search" task, not
--     this one — a single JSON blob is the simplest thing that lets segment
--     content round-trip through IPCAdapter today.

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT,
  icon TEXT,
  expanded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER, updated_at INTEGER,
  FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
);

ALTER TABLE pages ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE;

ALTER TABLE segments ADD COLUMN content TEXT NOT NULL
  DEFAULT '{"type":"doc","content":[{"type":"paragraph"}]}';
