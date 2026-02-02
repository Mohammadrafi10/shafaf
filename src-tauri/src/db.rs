use mysql::{Conn, Opts, prelude::*};
use std::sync::Mutex;
use anyhow::Result;

pub struct Database {
    conn: Mutex<Option<Conn>>,
    opts: Opts,
    /// Connection info for display (e.g. "host/database")
    connection_info: String,
}

impl Database {
    pub fn new(opts: Opts) -> Self {
        let connection_info = format!(
            "{}/{}",
            opts.get_ip_or_hostname(),
            opts.get_db_name().unwrap_or("")
        );
        Database {
            conn: Mutex::new(None),
            opts,
            connection_info,
        }
    }

    /// Open the MySQL connection using stored opts.
    pub fn open(&self) -> Result<()> {
        let mut conn_guard = self.conn.lock().unwrap();
        if conn_guard.is_some() {
            return Ok(());
        }
        let conn = Conn::new(self.opts.clone())?;
        *conn_guard = Some(conn);
        Ok(())
    }

    /// Close the database connection.
    pub fn close(&self) -> Result<()> {
        let mut conn_guard = self.conn.lock().unwrap();
        if let Some(conn) = conn_guard.take() {
            drop(conn);
        }
        Ok(())
    }

    /// Check if database is open.
    pub fn is_open(&self) -> bool {
        let conn_guard = self.conn.lock().unwrap();
        conn_guard.is_some()
    }

    /// Execute a SQL query that doesn't return results.
    /// Params: pass values that implement Into<mysql::Params> (e.g. (), (a, b), or vec of Value).
    pub fn execute<P: Into<mysql::Params>>(&self, sql: &str, params: P) -> Result<usize> {
        let mut conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_mut().ok_or_else(|| anyhow::anyhow!("Database is not open. Please open it first."))?;
        let stmt = conn.prep(sql)?;
        conn.exec_drop(&stmt, params)?;
        Ok(conn.affected_rows() as usize)
    }

    /// Execute a SQL query and return results; map each row with f.
    pub fn query<T, P, F>(&self, sql: &str, params: P, mut f: F) -> Result<Vec<T>>
    where
        P: Into<mysql::Params>,
        F: FnMut(&mysql::Row) -> Result<T>,
    {
        let mut conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_mut().ok_or_else(|| anyhow::anyhow!("Database is not open. Please open it first."))?;
        let stmt = conn.prep(sql)?;
        let mut result = conn.exec_iter(&stmt, params)?;
        let mut rows = Vec::new();
        if let Some(rows_iter) = result.iter() {
            for row in rows_iter {
                let row = row?;
                rows.push(f(&row)?);
            }
        }
        Ok(rows)
    }

    /// Get column names from a prepared statement (prep only, no execute).
    pub fn get_columns(&self, sql: &str) -> Result<Vec<String>> {
        let mut conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_mut().ok_or_else(|| anyhow::anyhow!("Database is not open. Please open it first."))?;
        let stmt = conn.prep(sql)?;
        let columns = stmt.columns().iter().map(|c| c.name_str().to_string()).collect();
        Ok(columns)
    }

    /// Get connection for advanced operations (internal use).
    pub fn with_connection<F, R>(&self, f: F) -> Result<R>
    where
        F: FnOnce(&mut Conn) -> Result<R>,
    {
        let mut conn_guard = self.conn.lock().unwrap();
        let conn = conn_guard.as_mut().ok_or_else(|| anyhow::anyhow!("Database is not open. Please open it first."))?;
        f(conn)
    }

    /// Get connection info string (e.g. "127.0.0.1/dbname").
    pub fn get_connection_info(&self) -> &str {
        &self.connection_info
    }

    /// Check if we have an active connection.
    pub fn exists(&self) -> bool {
        self.is_open()
    }
}
