-- Personal spell-check dictionary — "Add to Dictionary" persistence. Global
-- across all pages/folders (there's no natural per-page/per-plugin owner
-- for a dictionary word, unlike plugin_storage's (plugin_id, key) shape),
-- so a flat table keyed only by the lower-cased word itself.
-- `INSERT OR IGNORE` at write time makes repeated adds of the same word
-- idempotent without an app-side existence check first.
CREATE TABLE dictionary_words (
    word     TEXT PRIMARY KEY,
    added_at INTEGER NOT NULL DEFAULT (unixepoch())
);
