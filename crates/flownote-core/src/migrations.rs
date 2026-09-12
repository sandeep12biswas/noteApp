//! Minimal embedded SQL migration runner.
//!
//! DESIGN.md §7.2 calls for `refinery` migrations, but refinery 0.9's
//! `rusqlite` feature pins a `rusqlite`/`libsqlite3-sys` chain (~0.23-0.39)
//! that conflicts with the current bundled `rusqlite` 0.40 this crate needs
//! (see crates/flownote-core/Cargo.toml history). Rather than pull in an
//! old SQLite bundle to satisfy refinery, this module gives the same
//! guarantee — versioned, idempotent, embedded SQL migrations applied in
//! order and tracked in a table — without the extra dependency. Revisit if
//! refinery ships a release compatible with rusqlite 0.40+.

use rusqlite::Connection;

/// One embedded migration: a monotonically increasing version, a human name
/// (for the applied-migrations log), and its SQL body.
struct Migration {
    version: i64,
    name: &'static str,
    sql: &'static str,
}

/// Add new migrations here, in ascending version order. Never edit or
/// reorder an existing entry once it has shipped — add a new one instead.
const MIGRATIONS: &[Migration] = &[
    Migration { version: 1, name: "init", sql: include_str!("../migrations/V1__init.sql") },
    Migration {
        version: 2,
        name: "folders_and_segment_content",
        sql: include_str!("../migrations/V2__folders_and_segment_content.sql"),
    },
    Migration {
        version: 3,
        name: "blocks_fts_sync",
        sql: include_str!("../migrations/V3__blocks_fts_sync.sql"),
    },
    Migration {
        version: 4,
        name: "page_ink_layer",
        sql: include_str!("../migrations/V4__page_ink_layer.sql"),
    },
    Migration {
        version: 5,
        name: "dictionary_words",
        sql: include_str!("../migrations/V5__dictionary_words.sql"),
    },
];

/// Applies every migration in `MIGRATIONS` newer than the connection's
/// current schema version, each inside its own transaction. Safe to call on
/// every startup — a fully migrated database is a no-op.
pub fn run(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
            applied_at INTEGER NOT NULL DEFAULT (unixepoch())
        )",
    )?;

    let current: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM _migrations",
        [],
        |row| row.get(0),
    )?;

    for migration in MIGRATIONS.iter().filter(|m| m.version > current) {
        let tx = conn.transaction()?;
        tx.execute_batch(migration.sql)?;
        tx.execute(
            "INSERT INTO _migrations (version, name) VALUES (?1, ?2)",
            (migration.version, migration.name),
        )?;
        tx.commit()?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn applies_all_migrations_and_creates_schema() {
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn).unwrap();

        let expected_tables = [
            "pages",
            "segments",
            "blocks",
            "blocks_fts",
            "plugins",
            "plugin_storage",
            "folders",
            "dictionary_words",
        ];
        for table in expected_tables {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table','view') AND name = ?1",
                    [table],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "expected table `{table}` to exist after migrating");
        }

        let applied: i64 = conn
            .query_row("SELECT MAX(version) FROM _migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(applied, 5);
    }

    #[test]
    fn is_idempotent_on_an_already_migrated_connection() {
        let mut conn = Connection::open_in_memory().unwrap();
        run(&mut conn).unwrap();
        // Re-running against an already-migrated connection must not error
        // (no CREATE TABLE re-execution, no duplicate _migrations rows).
        run(&mut conn).unwrap();

        let applied_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM _migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(applied_count, MIGRATIONS.len() as i64);
    }
}
