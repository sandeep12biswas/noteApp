-- Table templates (issue #38): a table layout saved by name to insert again
-- on any page. App-wide, like dictionary_words. `table_json` is the TipTap
-- `table` node (rows, column widths, header text and colours, and — when
-- `includes_contents` — the body cells' text too). Names are unique
-- ignoring case, so "Budget" and "budget" can't both exist.
CREATE TABLE table_templates (
    name              TEXT PRIMARY KEY COLLATE NOCASE,
    table_json        TEXT NOT NULL,
    includes_contents INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);
