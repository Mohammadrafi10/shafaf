//! Remote MySQL license server: hardcoded config, DB/table setup, and license check.

use chrono::{DateTime, TimeZone, Utc};
use crate::license::{decrypt_expiry_datetime, encrypt_expiry_datetime};
use mysql::prelude::*;
use mysql::{Conn, Opts, OptsBuilder};
use serde::{Deserialize, Serialize};

/// Hardcoded remote MySQL config for license checks only.
const LICENSE_MYSQL_HOST: &str = "76.13.42.156";
const LICENSE_MYSQL_PORT: u16 = 3306;
const LICENSE_MYSQL_USER: &str = "usershafaf";
/// Replace with real password before building. Do not commit real password to public repos.
const LICENSE_MYSQL_PASSWORD: &str = "123";
const LICENSE_DB_NAME: &str = "shafaf_license";
const LICENSES_TABLE: &str = "licenses";

/// Result of license check against remote server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseCheckResult {
    pub valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

fn get_license_server_opts(with_db: bool) -> Opts {
    let opts = OptsBuilder::new()
        .ip_or_hostname(Some(LICENSE_MYSQL_HOST.to_string()))
        .tcp_port(LICENSE_MYSQL_PORT)
        .user(Some(LICENSE_MYSQL_USER.to_string()))
        .pass(Some(LICENSE_MYSQL_PASSWORD.to_string()));
    let opts = if with_db {
        opts.db_name(Some(LICENSE_DB_NAME.to_string()))
    } else {
        opts.db_name(None::<String>)
    };
    Opts::from(opts)
}

/// Ensure database and licenses table exist. Call with a connection that has no default DB.
fn ensure_db_and_table(conn: &mut Conn) -> Result<(), String> {
    let safe_db = LICENSE_DB_NAME.replace('`', "``");
    conn.query_drop(format!("CREATE DATABASE IF NOT EXISTS `{}`", safe_db))
        .map_err(|e| format!("Failed to create license DB: {}", e))?;
    conn.query_drop(format!("USE `{}`", safe_db))
        .map_err(|e| format!("Failed to use license DB: {}", e))?;

    let create_sql = format!(
        r#"CREATE TABLE IF NOT EXISTS `{}` (
            id INT PRIMARY KEY AUTO_INCREMENT,
            license_key VARCHAR(255) NOT NULL UNIQUE,
            expires_at_encrypted TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )"#,
        LICENSES_TABLE
    );
    conn.query_drop(create_sql).map_err(|e| format!("Failed to create licenses table: {}", e))?;
    Ok(())
}

/// Returns true if the given expiry ISO string is in the past (license expired).
pub fn is_expiry_past(expiry_iso: &str) -> Result<bool, String> {
    let expiry_dt: DateTime<Utc> = if let Ok(dt) = DateTime::parse_from_rfc3339(expiry_iso) {
        dt.with_timezone(&Utc)
    } else if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(expiry_iso, "%Y-%m-%d %H:%M:%S") {
        Utc.from_utc_datetime(&naive)
    } else if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(expiry_iso, "%Y-%m-%dT%H:%M:%S") {
        Utc.from_utc_datetime(&naive)
    } else {
        return Err(format!("Unsupported expiry format: {}", expiry_iso));
    };
    Ok(Utc::now() > expiry_dt)
}

/// Fetch the expiry datetime (decrypted) from the server for the given license key. Returns None if key not found.
pub fn fetch_expiry_iso_from_server(license_key: &str) -> Result<Option<String>, String> {
    if license_key.trim().is_empty() {
        return Ok(None);
    }

    let opts_no_db = get_license_server_opts(false);
    let mut conn = Conn::new(opts_no_db).map_err(|e| format!("License server connection failed: {}", e))?;
    ensure_db_and_table(&mut conn)?;

    let sql = format!(
        "SELECT expires_at_encrypted FROM `{}` WHERE license_key = ?",
        LICENSES_TABLE
    );
    let stmt = conn
        .prep(sql)
        .map_err(|e| format!("License query prepare failed: {}", e))?;
    let rows: Vec<String> = conn
        .exec_iter(&stmt, (license_key.trim(),))
        .map_err(|e| format!("License query failed: {}", e))?
        .filter_map(|result| result.ok())
        .filter_map(|row| row.get::<String, usize>(0))
        .collect();

    let expires_at_encrypted = match rows.into_iter().next() {
        Some(s) => s,
        None => return Ok(None),
    };

    let expiry_str = decrypt_expiry_datetime(&expires_at_encrypted)
        .map_err(|e| format!("Failed to decrypt expiry: {}", e))?;
    Ok(Some(expiry_str))
}

/// Check license against remote MySQL: returns valid, expired, or invalid.
pub fn check_license_against_server(license_key: &str) -> Result<LicenseCheckResult, String> {
    if license_key.trim().is_empty() {
        return Ok(LicenseCheckResult {
            valid: false,
            reason: Some("invalid".to_string()),
        });
    }

    let expiry_str = match fetch_expiry_iso_from_server(license_key)? {
        Some(s) => s,
        None => {
            return Ok(LicenseCheckResult {
                valid: false,
                reason: Some("invalid".to_string()),
            });
        }
    };

    // Parse expiry (ISO 8601 or "YYYY-MM-DD HH:MM:SS")
    let expiry_dt: DateTime<Utc> = if let Ok(dt) = DateTime::parse_from_rfc3339(&expiry_str) {
        dt.with_timezone(&Utc)
    } else if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(&expiry_str, "%Y-%m-%d %H:%M:%S") {
        Utc.from_utc_datetime(&naive)
    } else if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(&expiry_str, "%Y-%m-%dT%H:%M:%S") {
        Utc.from_utc_datetime(&naive)
    } else {
        return Err(format!("Unsupported expiry format: {}", expiry_str));
    };

    let now = Utc::now();
    if now > expiry_dt {
        return Ok(LicenseCheckResult {
            valid: false,
            reason: Some("expired".to_string()),
        });
    }

    Ok(LicenseCheckResult {
        valid: true,
        reason: None,
    })
}

/// Encrypt an expiry datetime string for storing in the license server (e.g. for admin scripts).
/// Use format like "2025-12-31T23:59:59" or "2025-12-31 23:59:59".
pub fn encrypt_expiry_for_storage(datetime_str: &str) -> Result<String, String> {
    encrypt_expiry_datetime(datetime_str)
}

/// Insert a license into the remote DB only when the key does not exist (e.g. first-time Activate).
/// If the key already exists, do nothing and return None. New keys get 7 days expiry. Returns Some(expiry_iso) when inserted.
pub fn insert_license_on_server(license_key: &str) -> Result<Option<String>, String> {
    if license_key.trim().is_empty() {
        return Err("License key is empty".to_string());
    }

    let opts_no_db = get_license_server_opts(false);
    let mut conn = Conn::new(opts_no_db).map_err(|e| format!("License server connection failed: {}", e))?;
    ensure_db_and_table(&mut conn)?;

    let check_sql = format!(
        "SELECT 1 FROM `{}` WHERE license_key = ? LIMIT 1",
        LICENSES_TABLE
    );
    let check_stmt = conn.prep(check_sql).map_err(|e| format!("Failed to prepare check: {}", e))?;
    let key_exists = conn
        .exec_iter(&check_stmt, (license_key.trim(),))
        .map_err(|e| format!("Failed to check license: {}", e))?
        .filter_map(|r| r.ok())
        .next()
        .is_some();

    if key_exists {
        return Ok(None);
    }

    let expiry = Utc::now() + chrono::Duration::days(7);
    let expiry_str = expiry.format("%Y-%m-%dT%H:%M:%S").to_string();
    let expires_at_encrypted = encrypt_expiry_datetime(&expiry_str)
        .map_err(|e| format!("Failed to encrypt expiry: {}", e))?;

    let insert_sql = format!(
        "INSERT INTO `{}` (license_key, expires_at_encrypted) VALUES (?, ?)",
        LICENSES_TABLE
    );
    let insert_stmt = conn.prep(insert_sql).map_err(|e| format!("Failed to prepare insert: {}", e))?;
    conn.exec_drop(&insert_stmt, (license_key.trim(), &expires_at_encrypted))
        .map_err(|e| format!("Failed to insert license: {}", e))?;
    Ok(Some(expiry_str))
}
