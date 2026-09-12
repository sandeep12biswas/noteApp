-- Ink layer persistence — DESIGN.md §5.5, EXECUTION_PLAN.md Phase 2's
-- "Ink canvas layer" follow-up. `InkLayer.tsx`'s drawing is per-*page* (one
-- HTML5 Canvas overlay stacked above the whole `CanvasRoot`, keyed by
-- `pageId`), not per-segment — but V1's schema already had an `ink_layer`
-- column, added on `segments` by mistake and never read or written by any
-- Rust code since (grep finds no other reference). That stray column is
-- left in place rather than dropped (SQLite's `DROP COLUMN` support varies
-- by version, and it's harmless dead weight); this migration adds the
-- column where the feature actually needs it.
ALTER TABLE pages ADD COLUMN ink_layer TEXT;
