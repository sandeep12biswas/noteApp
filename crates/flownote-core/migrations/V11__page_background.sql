-- Editor background colour for one page (light mode only), as `#rrggbb`.
-- NULL = use the app-wide default, a per-device preference kept by the
-- frontend. Synced with the page like `mode` (crdt.rs / merge.rs); the V9
-- `sync_pages_update` trigger already queues the notebook document on any
-- page update.
ALTER TABLE pages ADD COLUMN background TEXT;
