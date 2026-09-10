//! SQLite connection pool setup — DESIGN.md §6.3: rusqlite + r2d2, WAL mode.

use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;

pub type Pool = r2d2::Pool<SqliteConnectionManager>;

/// Opens (creating if needed) the SQLite database at `path`, enables WAL
/// mode and foreign keys on every pooled connection, runs pending
/// migrations once up front, and returns a ready-to-use connection pool.
pub fn open(path: &str) -> Result<Pool, Box<dyn std::error::Error>> {
    let manager = SqliteConnectionManager::file(path).with_init(|conn| {
        conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
    });
    let pool = r2d2::Pool::new(manager)?;

    let mut conn = pool.get()?;
    crate::migrations::run(&mut conn)?;

    Ok(pool)
}

/// Same as [`open`], but entirely in memory — for tests and the Rust
/// backend's own unit tests that need a real schema without touching disk.
pub fn open_in_memory() -> Result<Connection, rusqlite::Error> {
    let mut conn = Connection::open_in_memory()?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    crate::migrations::run(&mut conn)?;
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_in_memory_is_ready_to_query() {
        let conn = open_in_memory().unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM pages", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn foreign_keys_are_enforced() {
        let conn = open_in_memory().unwrap();
        let err = conn
            .execute(
                "INSERT INTO segments (id, page_id, x, y) VALUES ('s1', 'missing-page', 0, 0)",
                [],
            )
            .unwrap_err();
        assert!(err.to_string().contains("FOREIGN KEY"));
    }
}
