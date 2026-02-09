mod db;
mod license;
mod license_server;
mod server;

use db::Database;
use mysql::prelude::*;
use mysql::{Opts, OptsBuilder, Value};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{self, BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

/// Default .env content used when file does not exist (MySQL + app config).
const DEFAULT_ENV_CONTENT: &str = r#"# MySQL Database Configuration
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=
MYSQL_PASSWORD=
MYSQL_DATABASE=tauri_app

# Application Configuration
APP_NAME=Finance App
APP_VERSION=0.1.0
LOG_LEVEL=INFO
DEV_MODE=true
"#;

/// Returns the directory where we store .env (same layout as app data, using env vars only).
fn get_config_dir() -> PathBuf {
    if cfg!(target_os = "android") {
        PathBuf::from(".")
    } else if cfg!(windows) {
        std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("finance-app")
    } else if cfg!(target_os = "macos") {
        std::env::var("HOME")
            .map(|home| PathBuf::from(home).join("Library").join("Application Support").join("tauri-app"))
            .unwrap_or_else(|_| PathBuf::from("."))
    } else {
        std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                std::env::var("HOME")
                    .map(|home| PathBuf::from(home).join(".local").join("share"))
                    .unwrap_or_else(|_| PathBuf::from("."))
            })
            .join("finance-app")
    }
}

/// Ensure .env exists: if not, create it with default content in config dir, then load from there.
/// Also loads from current directory first (for dev) if .env exists there.
fn load_env() {
    // 1) Try current directory first (development: project root)
    if std::path::Path::new(".env").exists() {
        let _ = dotenv::dotenv();
        return;
    }
    // 2) Use config directory and create .env if missing
    let config_dir = get_config_dir();
    let _ = fs::create_dir_all(&config_dir);
    let env_path = config_dir.join(".env");
    if !env_path.exists() {
        let _ = fs::write(&env_path, DEFAULT_ENV_CONTENT);
    }
    if env_path.exists() {
        let _ = dotenv::from_path(&env_path);
    } else {
        let _ = dotenv::dotenv();
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExecuteResult {
    pub rows_affected: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedResponse<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
    pub total_pages: i64,
}
/// Build MySQL connection opts from environment (MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE).
fn get_mysql_opts() -> Result<Opts, String> {
    let host = std::env::var("MYSQL_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port: u16 = std::env::var("MYSQL_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3306);
    let user = std::env::var("MYSQL_USER").ok();
    let pass = std::env::var("MYSQL_PASSWORD").ok();
    let db_name = std::env::var("MYSQL_DATABASE").ok();
    let opts = OptsBuilder::new()
        .ip_or_hostname(Some(host))
        .tcp_port(port)
        .user(user)
        .pass(pass)
        .db_name(db_name);
    Ok(Opts::from(opts))
}

/// Path to the .env file used by the app (config directory).
fn get_env_path() -> PathBuf {
    get_config_dir().join(".env")
}

/// Response for get_env_config: current MySQL settings and whether .env file exists in config dir.
#[derive(Debug, Serialize, Deserialize)]
pub struct EnvConfig {
    pub has_env_file: bool,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
}

/// Get current database env config (for the configuration page). Reads from env vars already loaded.
#[tauri::command]
fn get_env_config() -> Result<EnvConfig, String> {
    let env_path = get_env_path();
    let has_env_file = env_path.exists();
    let host = std::env::var("MYSQL_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port: u16 = std::env::var("MYSQL_PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3306);
    let user = std::env::var("MYSQL_USER").unwrap_or_default();
    let password = std::env::var("MYSQL_PASSWORD").unwrap_or_default();
    let database = std::env::var("MYSQL_DATABASE").unwrap_or_else(|_| "tauri_app".to_string());
    Ok(EnvConfig {
        has_env_file,
        host,
        port,
        user,
        password,
        database,
    })
}

/// Save database configuration to .env and reload env vars so next connection uses new values.
#[tauri::command]
fn save_env_config(host: String, port: u16, user: String, password: String, database: String) -> Result<(), String> {
    let config_dir = get_config_dir();
    fs::create_dir_all(&config_dir).map_err(|e| format!("Failed to create config dir: {}", e))?;
    let env_path = config_dir.join(".env");

    let content = if env_path.exists() {
        fs::read_to_string(&env_path).unwrap_or_else(|_| DEFAULT_ENV_CONTENT.to_string())
    } else {
        DEFAULT_ENV_CONTENT.to_string()
    };

    let mut lines: Vec<String> = content.lines().map(String::from).collect();
    let keys = ["MYSQL_HOST", "MYSQL_PORT", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DATABASE"];
    let values: Vec<String> = vec![host, port.to_string(), user, password, database];
    let mut replaced = vec![false; keys.len()];

    for line in lines.iter_mut() {
        for (j, key) in keys.iter().enumerate() {
            if line.starts_with(&format!("{}=", key)) {
                *line = format!("{}={}", key, values[j]);
                replaced[j] = true;
                break;
            }
        }
    }
    for (j, key) in keys.iter().enumerate() {
        if !replaced[j] {
            lines.push(format!("{}={}", key, values[j]));
        }
    }

    fs::write(&env_path, lines.join("\n")).map_err(|e| format!("Failed to write .env: {}", e))?;
    dotenv::from_path(&env_path).ok();
    std::env::set_var("MYSQL_HOST", &values[0]);
    std::env::set_var("MYSQL_PORT", &values[1]);
    std::env::set_var("MYSQL_USER", &values[2]);
    std::env::set_var("MYSQL_PASSWORD", &values[3]);
    std::env::set_var("MYSQL_DATABASE", &values[4]);
    Ok(())
}

/// Get app data directory for backups (same layout as before, for backup files).
fn get_app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = if cfg!(target_os = "android") {
        app.path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get Android app data directory: {}", e))?
    } else if cfg!(windows) {
        std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("finance-app")
    } else if cfg!(target_os = "macos") {
        std::env::var("HOME")
            .map(|home| PathBuf::from(home).join("Library").join("Application Support").join("tauri-app"))
            .unwrap_or_else(|_| PathBuf::from("."))
    } else {
        std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                std::env::var("HOME")
                    .map(|home| PathBuf::from(home).join(".local").join("share"))
                    .unwrap_or_else(|_| PathBuf::from("."))
            })
            .join("finance-app")
    };
    std::fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data directory: {}", e))?;
    Ok(data_dir)
}

/// Get the current database path / connection info
#[tauri::command]
fn get_database_path(app: AppHandle) -> Result<String, String> {
    let db_state = app.state::<Mutex<Option<Database>>>();
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    if let Some(db) = db_guard.as_ref() {
        Ok(format!("Connected to {}", db.get_connection_info()))
    } else {
        Ok("No database connected".to_string())
    }
}

/// Backup database - run mysqldump to a temp file and return its path for frontend to save.
#[tauri::command]
fn backup_database(app: AppHandle) -> Result<String, String> {
    let opts = get_mysql_opts()?;
    let host = opts.get_ip_or_hostname().to_string();
    let port = opts.get_tcp_port();
    let user = opts.get_user().unwrap_or("").to_string();
    let pass = opts.get_pass().unwrap_or("").to_string();
    let db_name = opts.get_db_name().ok_or("MYSQL_DATABASE not set")?;
    let data_dir = get_app_data_dir(&app)?;
    let date_str = chrono::Local::now().format("%Y-%m-%d_%H%M%S").to_string();
    let backup_path = data_dir.join(format!("db-backup-{}.sql", date_str));

    let mut cmd = Command::new("mysqldump");
    cmd.arg("-h").arg(host)
        .arg("-P").arg(port.to_string())
        .arg("-u").arg(user)
        .arg("--single-transaction")
        .arg("--quick")
        .arg("--lock-tables=false")
        .arg(db_name);
    if !pass.is_empty() {
        cmd.arg(format!("-p{}", pass));
    }
    let out = fs::File::create(&backup_path).map_err(|e| format!("Failed to create backup file: {}", e))?;
    cmd.stdout(out);
    let status = cmd.status().map_err(|e| format!("Failed to run mysqldump: {}", e))?;
    if !status.success() {
        let _ = fs::remove_file(&backup_path);
        return Err("mysqldump failed".to_string());
    }
    Ok(backup_path.to_string_lossy().to_string())
}

/// Copy backup to user-selected path (dump already at backup_path from backup_database, or run mysqldump to dest_path).
#[tauri::command]
fn save_backup_to_path(app: AppHandle, dest_path: String) -> Result<String, String> {
    let opts = get_mysql_opts()?;
    let host = opts.get_ip_or_hostname().to_string();
    let port = opts.get_tcp_port();
    let user = opts.get_user().unwrap_or("").to_string();
    let pass = opts.get_pass().unwrap_or("").to_string();
    let db_name = opts.get_db_name().ok_or("MYSQL_DATABASE not set")?;

    let mut cmd = Command::new("mysqldump");
    cmd.arg("-h").arg(host)
        .arg("-P").arg(port.to_string())
        .arg("-u").arg(user)
        .arg("--single-transaction")
        .arg("--quick")
        .arg("--lock-tables=false")
        .arg(db_name);
    if !pass.is_empty() {
        cmd.arg(format!("-p{}", pass));
    }
    let out = fs::File::create(&dest_path).map_err(|e| format!("Failed to create file: {}", e))?;
    cmd.stdout(out);
    cmd.status().map_err(|e| format!("Failed to run mysqldump: {}", e))?;
    Ok(dest_path)
}

/// Get the folder path where automatic daily backups are stored.
#[tauri::command]
fn get_backups_dir(app: AppHandle) -> Result<String, String> {
    let data_dir = get_app_data_dir(&app)?;
    let backups_dir = data_dir.join("backups");
    Ok(backups_dir.to_string_lossy().to_string())
}

/// Create a daily backup. If custom_dir is set, use that folder; otherwise use app data backups subfolder.
#[tauri::command]
fn create_daily_backup(app: AppHandle, custom_dir: Option<String>) -> Result<String, String> {
    let opts = get_mysql_opts()?;
    let host = opts.get_ip_or_hostname().to_string();
    let port = opts.get_tcp_port();
    let user = opts.get_user().unwrap_or("").to_string();
    let pass = opts.get_pass().unwrap_or("").to_string();
    let db_name = opts.get_db_name().ok_or("MYSQL_DATABASE not set")?;
    let data_dir = get_app_data_dir(&app)?;
    let backups_dir = match custom_dir.as_deref().map(str::trim) {
        Some(d) if !d.is_empty() => std::path::PathBuf::from(d),
        _ => data_dir.join("backups"),
    };
    fs::create_dir_all(&backups_dir).map_err(|e: io::Error| format!("Failed to create backups dir: {}", e))?;
    let date_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let backup_path = backups_dir.join(format!("db-backup-{}.sql", date_str));

    let mut cmd = Command::new("mysqldump");
    cmd.arg("-h").arg(host)
        .arg("-P").arg(port.to_string())
        .arg("-u").arg(user)
        .arg("--single-transaction")
        .arg("--quick")
        .arg("--lock-tables=false")
        .arg(db_name);
    if !pass.is_empty() {
        cmd.arg(format!("-p{}", pass));
    }
    let out = fs::File::create(&backup_path).map_err(|e| format!("Failed to create backup: {}", e))?;
    cmd.stdout(out);
    cmd.status().map_err(|e| format!("mysqldump failed: {}", e))?;
    Ok(backup_path.to_string_lossy().to_string())
}

/// Restore database from a SQL dump file. Restores all tables except `users` so current logins are preserved.
#[tauri::command]
fn restore_database(backup_path: String) -> Result<String, String> {
    let opts = get_mysql_opts()?;
    let host = opts.get_ip_or_hostname().to_string();
    let port = opts.get_tcp_port();
    let user = opts.get_user().unwrap_or("").to_string();
    let pass = opts.get_pass().unwrap_or("").to_string();
    let db_name = opts.get_db_name().ok_or("MYSQL_DATABASE not set")?;

    let inp = fs::File::open(&backup_path).map_err(|e| format!("Failed to open backup file: {}", e))?;
    let reader = BufReader::new(inp);

    // Filter out any statement that touches the `users` table so we keep current users.
    let mut filtered = Vec::<u8>::new();
    let mut skip_until_unlock = false;
    let mut in_users_create = false;
    let mut skip_insert_until_semicolon = false;

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read backup file: {}", e))?;
        let trimmed = line.trim();

        if skip_until_unlock {
            if trimmed.starts_with("UNLOCK TABLES") {
                skip_until_unlock = false;
            }
            continue;
        }
        if in_users_create {
            if trimmed.ends_with(");") {
                in_users_create = false;
            }
            continue;
        }
        if skip_insert_until_semicolon {
            if trimmed.ends_with(';') {
                skip_insert_until_semicolon = false;
            }
            continue;
        }

        // Skip DROP TABLE for users only
        if trimmed.starts_with("DROP TABLE IF EXISTS `users`")
            || trimmed.starts_with("DROP TABLE IF EXISTS \"users\"")
        {
            continue;
        }
        // Skip CREATE TABLE for users (with or without IF NOT EXISTS)
        if (trimmed.starts_with("CREATE TABLE `users`") || trimmed.starts_with("CREATE TABLE IF NOT EXISTS `users`"))
            || (trimmed.starts_with("CREATE TABLE \"users\"") || trimmed.starts_with("CREATE TABLE IF NOT EXISTS \"users\""))
        {
            in_users_create = true;
            continue;
        }
        // Skip LOCK TABLES for users
        if trimmed.contains("LOCK TABLES `users`") || trimmed.contains("LOCK TABLES \"users\"") {
            skip_until_unlock = true;
            continue;
        }
        // Skip INSERT INTO users (whole statement; mysqldump usually one line)
        if trimmed.contains("INSERT INTO `users`") || trimmed.contains("INSERT INTO \"users\"") {
            if !trimmed.ends_with(';') {
                skip_insert_until_semicolon = true;
            }
            continue;
        }

        filtered.write_all(line.as_bytes()).map_err(|e| format!("Failed to write filtered SQL: {}", e))?;
        filtered.write_all(b"\n").map_err(|e| format!("Failed to write filtered SQL: {}", e))?;
    }

    let mut cmd = Command::new("mysql");
    cmd.arg("-h").arg(&host)
        .arg("-P").arg(port.to_string())
        .arg("-u").arg(&user)
        .arg(&db_name);
    if !pass.is_empty() {
        cmd.arg(format!("-p{}", pass));
    }
    cmd.stdin(std::process::Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("Failed to run mysql: {}", e))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(&filtered).map_err(|e| format!("Failed to pipe SQL to mysql: {}", e))?;
        stdin.flush().map_err(|e| format!("Failed to flush: {}", e))?;
    }
    let status = child.wait().map_err(|e| format!("Failed to wait for mysql: {}", e))?;
    if !status.success() {
        return Err("mysql restore failed".to_string());
    }
    Ok("Database restored successfully (users table was not changed).".to_string())
}

/// Embedded schema: run on first init when users table does not exist.
const INIT_SQL: &str = include_str!("../data/db.sql");

/// Insert test user (testuser / admin@test.com / 123) if no user exists yet.
fn insert_test_user_if_needed(db: &Database) -> Result<(), String> {
    let check_sql = "SELECT COUNT(*) FROM users WHERE username = ?";
    let counts: Vec<i64> = db
        .query(check_sql, ("testuser",), |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to check test user: {}", e))?;
    if counts.first().copied().unwrap_or(0) > 0 {
        return Ok(());
    }
    let password_hash = bcrypt::hash("123", bcrypt::DEFAULT_COST)
        .map_err(|e| format!("Failed to hash test password: {}", e))?;
    let insert_sql = "INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)";
    db.execute(insert_sql, ("testuser", "admin@test.com", password_hash.as_str(), "admin"))
        .map_err(|e| format!("Failed to insert test user: {}", e))?;
    Ok(())
}

/// Run db.sql if the database has no users table (first-time init).
fn run_schema_if_needed(db: &Database) -> Result<(), String> {
    let check_sql = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'users'";
    let counts: Vec<i64> = db
        .query(check_sql, (), |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to check schema: {}", e))?;
    let has_users = counts.first().copied().unwrap_or(0) > 0;
    if has_users {
        return Ok(());
    }
    for stmt in INIT_SQL.split(';') {
        // Strip leading comment lines and blank lines so ";\n-- comment\n\nCREATE TABLE..." is executed
        let stmt = stmt
            .trim()
            .lines()
            .skip_while(|line| line.trim().is_empty() || line.trim().starts_with("--"))
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string();
        if stmt.is_empty() {
            continue;
        }
        db.execute(&stmt, ()).map_err(|e| format!("Schema statement failed: {} | {}", e, stmt))?;
    }
    insert_test_user_if_needed(db)?;
    Ok(())
}

/// Create MySQL database if it doesn't exist, then open connection.
#[tauri::command]
fn db_create(app: AppHandle, db_name: String) -> Result<String, String> {
    let opts = get_mysql_opts()?;
    let db_to_create = if db_name.is_empty() {
        opts.get_db_name().map(|s| s.to_string()).unwrap_or_else(|| "tauri_app".to_string())
    } else {
        db_name
    };
    let opts_no_db = OptsBuilder::from_opts(opts.clone()).db_name(None::<String>);
    let mut conn = mysql::Conn::new(Opts::from(opts_no_db))
        .map_err(|e| format!("Failed to connect to MySQL: {}", e))?;
    let safe_name = db_to_create.replace('`', "``");
    conn.query_drop(format!("CREATE DATABASE IF NOT EXISTS `{}`", safe_name))
        .map_err(|e| format!("Failed to create database: {}", e))?;
    drop(conn);

    let opts_with_db = OptsBuilder::from_opts(opts).db_name(Some(db_to_create.clone()));
    let db = Database::new(Opts::from(opts_with_db));
    db.open().map_err(|e| format!("Failed to open database: {}", e))?;
    run_schema_if_needed(&db).map_err(|e| format!("Failed to init schema: {}", e))?;
    let db_state: State<'_, Mutex<Option<Database>>> = app.state();
    let mut db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    *db_guard = Some(db);
    Ok(format!("Database created and opened: {}", db_to_create))
}

/// Open database (connect to MySQL using MYSQL_* env).
#[tauri::command]
fn db_open(app: AppHandle, _db_name: String) -> Result<String, String> {
    let opts = get_mysql_opts()?;
    let db = Database::new(opts);
    db.open().map_err(|e| format!("Failed to open database: {}", e))?;
    run_schema_if_needed(&db).map_err(|e| format!("Failed to init schema: {}", e))?;

    let db_state: State<'_, Mutex<Option<Database>>> = app.state();
    let mut db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    *db_guard = Some(db);

    Ok(format!("Database opened: {}", db_guard.as_ref().unwrap().get_connection_info()))
}

/// Close the current database
#[tauri::command]
fn db_close(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let mut db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    
    if let Some(db) = db_guard.take() {
        db.close()
            .map_err(|e| format!("Failed to close database: {}", e))?;
        Ok("Database closed successfully".to_string())
    } else {
        Err("No database is currently open".to_string())
    }
}

/// Check if database is open
#[tauri::command]
fn db_is_open(db_state: State<'_, Mutex<Option<Database>>>) -> Result<bool, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    Ok(db_guard.as_ref().map(|db| db.is_open()).unwrap_or(false))
}

/// Get required value from MySQL row (Option -> Result).
fn row_get<T: mysql::prelude::FromValue>(row: &mysql::Row, i: usize) -> anyhow::Result<T> {
    row.get(i).ok_or_else(|| anyhow::anyhow!("column {}", i))
}

/// Get column as String, converting MySQL Date/Time to string (Date/Time do not convert to String via FromValue).
fn row_get_string_or_datetime(row: &mysql::Row, i: usize) -> anyhow::Result<String> {
    let v = row.as_ref(i).ok_or_else(|| anyhow::anyhow!("column {}", i))?;
    match v {
        Value::Date(y, mo, d, h, mi, s, _) => Ok(format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", y, mo, d, h, mi, s)),
        Value::Time(neg, days, h, mi, s, micro) => {
            let sign = if *neg { "-" } else { "" };
            Ok(format!("{}{:03}:{:02}:{:02}:{:02}.{:06}", sign, days, h, mi, s, micro))
        }
        _ => row_get::<String>(row, i),
    }
}

/// Single positional param for mysql (Vec<Value> implements Into<Params>).
fn one_param<V: Into<Value>>(v: V) -> Vec<Value> {
    vec![v.into()]
}

/// Convert serde_json::Value to mysql::Value for params.
fn json_to_mysql_value(v: &serde_json::Value) -> Value {
    match v {
        serde_json::Value::String(s) => Value::Bytes(s.as_bytes().to_vec()),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                Value::Int(i)
            } else if let Some(u) = n.as_u64() {
                Value::UInt(u)
            } else {
                Value::Double(n.as_f64().unwrap_or(0.0))
            }
        }
        serde_json::Value::Bool(b) => Value::Int(if *b { 1 } else { 0 }),
        serde_json::Value::Null => Value::NULL,
        _ => Value::Bytes(v.to_string().into_bytes()),
    }
}

/// Format MySQL Date/Time value as string (mysql crate does not convert Date to String).
fn value_date_time_to_string(v: &Value) -> serde_json::Value {
    match v {
        Value::Date(y, mo, d, h, mi, s, _) => {
            serde_json::Value::String(format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", y, mo, d, h, mi, s))
        }
        Value::Time(neg, days, h, mi, s, micro) => {
            let sign = if *neg { "-" } else { "" };
            serde_json::Value::String(format!("{}{:03}:{:02}:{:02}:{:02}.{:06}", sign, days, h, mi, s, micro))
        }
        _ => serde_json::Value::Null,
    }
}

/// Convert mysql Value to serde_json::Value for query results.
fn mysql_value_to_json(v: &Value) -> serde_json::Value {
    match v {
        Value::NULL => serde_json::Value::Null,
        Value::Int(x) => serde_json::Value::Number(serde_json::Number::from(*x)),
        Value::UInt(x) => serde_json::Value::Number(serde_json::Number::from(*x)),
        Value::Float(x) => serde_json::Number::from_f64(*x as f64).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null),
        Value::Double(x) => serde_json::Number::from_f64(*x).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null),
        Value::Bytes(b) => match std::str::from_utf8(b) {
            Ok(s) => serde_json::Value::String(s.to_string()),
            Err(_) => serde_json::Value::String(format!("[BLOB:{} bytes]", b.len())),
        },
        Value::Date(..) | Value::Time(..) => value_date_time_to_string(v),
    }
}

/// Execute a SQL query (INSERT, UPDATE, DELETE, CREATE TABLE, etc.)
#[tauri::command]
fn db_execute(
    db_state: State<'_, Mutex<Option<Database>>>,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<ExecuteResult, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let mysql_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let rows_affected = db.execute(&sql, mysql_params).map_err(|e| format!("Database error: {}", e))?;

    Ok(ExecuteResult { rows_affected })
}

/// Execute a SELECT query and return results
#[tauri::command]
fn db_query(
    db_state: State<'_, Mutex<Option<Database>>>,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<QueryResult, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let columns = db.get_columns(&sql).map_err(|e| format!("Database error: {}", e))?;
    let mysql_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let result_rows = db.with_connection(|conn| {
        let stmt = conn.prep(&sql).map_err(|e| anyhow::anyhow!("SQL prepare error: {}", e))?;
        let mut result = conn.exec_iter(&stmt, mysql_params).map_err(|e| anyhow::anyhow!("SQL query error: {}", e))?;
        let mut rows = Vec::new();
        if let Some(rows_iter) = result.iter() {
            for row in rows_iter {
                let row = row.map_err(|e| anyhow::anyhow!("Row error: {}", e))?;
                let mut values = Vec::new();
                for i in 0..row.len() {
                    values.push(mysql_value_to_json(&row[i]));
                }
                rows.push(values);
            }
        }
        Ok(rows)
    }).map_err(|e| format!("Database error: {}", e))?;

    Ok(QueryResult {
        columns,
        rows: result_rows,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub email: String,
    pub full_name: Option<String>,
    pub phone: Option<String>,
    pub role: String,
    pub is_active: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_picture: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginResult {
    pub success: bool,
    pub user: Option<User>,
    pub message: String,
}

/// Initialize users table (schema from db.sql on first open).
#[tauri::command]
fn init_users_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;
    // Add profile_picture column if missing (for existing databases). MEDIUMTEXT supports base64 images (~16MB).
    let _ = db.execute("ALTER TABLE users ADD COLUMN profile_picture MEDIUMTEXT", ());
    // Upgrade existing TEXT column to MEDIUMTEXT so base64 images fit
    let _ = db.execute("ALTER TABLE users MODIFY COLUMN profile_picture MEDIUMTEXT", ());
    Ok("OK".to_string())
}

/// Register a new user
#[tauri::command]
fn register_user(
    db_state: State<'_, Mutex<Option<Database>>>,
    username: String,
    email: String,
    password: String,
) -> Result<LoginResult, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Hash the password
    let password_hash = bcrypt::hash(&password, bcrypt::DEFAULT_COST)
        .map_err(|e| format!("Failed to hash password: {}", e))?;

    // Check if username or email already exists
    let check_sql = "SELECT id FROM users WHERE username = ? OR email = ?";
    let existing = db
        .query(check_sql, (username.as_str(), email.as_str()), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Database query error: {}", e))?;

    if !existing.is_empty() {
        return Ok(LoginResult {
            success: false,
            user: None,
            message: "Username or email already exists".to_string(),
        });
    }

    // Insert new user
    let insert_sql = "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)";
    db.execute(insert_sql, (username.as_str(), email.as_str(), password_hash.as_str()))
        .map_err(|e| format!("Failed to insert user: {}", e))?;

    // Get the created user
    let user_sql = "SELECT id, username, email, full_name, phone, role, is_active, profile_picture, created_at, updated_at FROM users WHERE username = ?";
    let users = db
        .query(user_sql, one_param(username.as_str()), |row| {
            Ok(User {
                id: row_get(row, 0)?,
                username: row_get(row, 1)?,
                email: row_get(row, 2)?,
                full_name: row_get(row, 3)?,
                phone: row_get(row, 4)?,
                role: row_get(row, 5)?,
                is_active: row_get(row, 6)?,
                profile_picture: row_get::<Option<String>>(row, 7)?,
                created_at: row_get_string_or_datetime(row, 8)?,
                updated_at: row_get_string_or_datetime(row, 9)?,
            })
        })
        .map_err(|e| format!("Failed to fetch user: {}", e))?;

    if let Some(user) = users.first() {
        Ok(LoginResult {
            success: true,
            user: Some(user.clone()),
            message: "User registered successfully".to_string(),
        })
    } else {
        Err("Failed to retrieve created user".to_string())
    }
}

/// Login a user
#[tauri::command]
fn login_user(
    db_state: State<'_, Mutex<Option<Database>>>,
    username: String,
    password: String,
) -> Result<LoginResult, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Get user by username or email
    let user_sql = "SELECT id, username, email, password_hash, full_name, phone, role, is_active, profile_picture, created_at, updated_at FROM users WHERE username = ? OR email = ?";
    let users = db
        .query(user_sql, vec![Value::from(username.as_str()), Value::from(username.as_str())], |row| {
            Ok((
                row_get::<i64>(row, 0)?,
                row_get::<String>(row, 1)?,
                row_get::<String>(row, 2)?,
                row_get::<String>(row, 3)?,
                row_get::<Option<String>>(row, 4)?,
                row_get::<Option<String>>(row, 5)?,
                row_get::<Option<String>>(row, 6)?,
                row_get::<Option<i64>>(row, 7)?,
                row_get::<Option<String>>(row, 8)?,
                row_get_string_or_datetime(row, 9)?,
                row_get_string_or_datetime(row, 10)?,
            ))
        })
        .map_err(|e| format!("Database query error: {}", e))?;

    if users.is_empty() {
        return Ok(LoginResult {
            success: false,
            user: None,
            message: "Invalid username or password".to_string(),
        });
    }

    let (id, db_username, email, password_hash, full_name, phone, role, is_active, profile_picture, created_at, updated_at) = &users[0];

    // Verify password
    let password_valid = bcrypt::verify(&password, password_hash)
        .map_err(|e| format!("Password verification error: {}", e))?;

    if !password_valid {
        return Ok(LoginResult {
            success: false,
            user: None,
            message: "Invalid username or password".to_string(),
        });
    }

    Ok(LoginResult {
        success: true,
        user: Some(User {
            id: *id,
            username: db_username.clone(),
            email: email.clone(),
            full_name: full_name.clone(),
            phone: phone.clone(),
            role: role.clone().unwrap_or_else(|| "user".to_string()),
            is_active: is_active.unwrap_or(1),
            profile_picture: profile_picture.clone(),
            created_at: created_at.clone(),
            updated_at: updated_at.clone(),
        }),
        message: "Login successful".to_string(),
    })
}

/// Get all users with pagination
#[tauri::command]
fn get_users(
    db_state: State<'_, Mutex<Option<Database>>>,
    page: i64,
    per_page: i64,
    search: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
) -> Result<PaginatedResponse<User>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let offset = (page - 1) * per_page;
    
    // Build WHERE clause
    let mut where_clause = String::new();
    let mut params: Vec<serde_json::Value> = Vec::new();

    if let Some(s) = search {
        if !s.trim().is_empty() {
            let search_term = format!("%{}%", s);
            where_clause = "WHERE (username LIKE ? OR email LIKE ? OR full_name LIKE ? OR phone LIKE ?)".to_string();
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term));
        }
    }

    // Get total count
    let count_sql = format!("SELECT COUNT(*) FROM users {}", where_clause);
    let mysql_count_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let count_results: Vec<i64> = db.query(&count_sql, mysql_count_params, |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to count users: {}", e))?;
    let total: i64 = count_results.first().copied().unwrap_or(0);

    // Build Order By
    let order_clause = if let Some(sort) = sort_by {
        let order = sort_order.unwrap_or_else(|| "ASC".to_string());
        let allowed_cols = ["username", "email", "full_name", "phone", "role", "is_active", "created_at"];
        if allowed_cols.contains(&sort.as_str()) {
             format!("ORDER BY {} {}", sort, if order.to_uppercase() == "DESC" { "DESC" } else { "ASC" })
        } else {
            "ORDER BY created_at DESC".to_string()
        }
    } else {
        "ORDER BY created_at DESC".to_string()
    };

    let sql = format!("SELECT id, username, email, full_name, phone, role, is_active, profile_picture, created_at, updated_at FROM users {} {} LIMIT ? OFFSET ?", where_clause, order_clause);
    
    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));

    let mysql_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let users = db.query(&sql, mysql_params, |row| {
        Ok(User {
            id: row_get(row, 0)?,
            username: row_get(row, 1)?,
            email: row_get(row, 2)?,
            full_name: row_get(row, 3)?,
            phone: row_get(row, 4)?,
            role: row_get(row, 5)?,
            is_active: row_get(row, 6)?,
            profile_picture: row_get::<Option<String>>(row, 7)?,
            created_at: row_get_string_or_datetime(row, 8)?,
            updated_at: row_get_string_or_datetime(row, 9)?,
        })
    }).map_err(|e| format!("Failed to fetch users: {}", e))?;

    let total_pages = (total as f64 / per_page as f64).ceil() as i64;

    Ok(PaginatedResponse {
        items: users,
        total,
        page,
        per_page,
        total_pages,
    })
}

/// Get machine ID for license generation
#[tauri::command]
fn get_machine_id() -> Result<String, String> {
    Ok(license::generate_machine_id())
}

/// Store license key in secure storage
#[tauri::command]
fn store_license_key(key: String) -> Result<(), String> {
    use keyring::Entry;
    
    let entry = Entry::new("finance_app", "license_key")
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    
    entry.set_password(&key)
        .map_err(|e| format!("Failed to store license key: {}", e))?;
    
    Ok(())
}

/// Get license key from secure storage
#[tauri::command]
fn get_license_key() -> Result<Option<String>, String> {
    use keyring::Entry;
    
    let entry = Entry::new("finance_app", "license_key")
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get license key: {}", e)),
    }
}

/// Store license expiry (ISO datetime) in secure storage on this machine. Associated with the license key.
#[tauri::command]
fn store_license_expiry(expiry_iso: String) -> Result<(), String> {
    use keyring::Entry;
    let entry = Entry::new("finance_app", "license_expiry")
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    entry.set_password(&expiry_iso)
        .map_err(|e| format!("Failed to store license expiry: {}", e))?;
    Ok(())
}

/// Get license expiry from secure storage (stored on this machine when license was activated).
#[tauri::command]
fn get_license_expiry() -> Result<Option<String>, String> {
    use keyring::Entry;
    let entry = Entry::new("finance_app", "license_expiry")
        .map_err(|e| format!("Failed to create keyring entry: {}", e))?;
    match entry.get_password() {
        Ok(s) => Ok(Some(s)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to get license expiry: {}", e)),
    }
}

/// Validate license key
#[tauri::command]
fn validate_license_key(entered_key: String) -> Result<bool, String> {
    license::validate_license_key(&entered_key)
}

/// Check a license key against the server (key passed as argument, not from keyring). Use on activation page before storing.
#[tauri::command]
fn check_license_key_with_server(license_key: String) -> Result<license_server::LicenseCheckResult, String> {
    license_server::check_license_against_server(&license_key)
}

/// Check stored license: local expiry first (stored on this machine), then remote server. Returns { valid, reason? }.
#[tauri::command]
fn check_license_with_server() -> Result<license_server::LicenseCheckResult, String> {
    let key = get_license_key()?;
    let key = match key {
        Some(k) if !k.trim().is_empty() => k,
        _ => {
            return Ok(license_server::LicenseCheckResult {
                valid: false,
                reason: Some("invalid".to_string()),
            });
        }
    };
    if let Ok(Some(expiry_iso)) = get_license_expiry() {
        if let Ok(expired) = license_server::is_expiry_past(&expiry_iso) {
            if expired {
                return Ok(license_server::LicenseCheckResult {
                    valid: false,
                    reason: Some("expired".to_string()),
                });
            }
        }
    }
    license_server::check_license_against_server(&key)
}

/// Insert the given license key into the remote MySQL license table only if it does not exist; store expiry locally when inserted.
#[tauri::command]
fn register_license_on_server(license_key: String) -> Result<(), String> {
    if let Some(expiry_iso) = license_server::insert_license_on_server(&license_key)? {
        store_license_expiry(expiry_iso)?;
    }
    Ok(())
}

/// Refresh license expiry from server: fetch encrypted expiry, decrypt, and update local keyring.
#[tauri::command]
fn refresh_license_expiry_from_server() -> Result<(), String> {
    let key = get_license_key()?;
    let key = match key {
        Some(k) if !k.trim().is_empty() => k,
        _ => return Err("No license key stored".to_string()),
    };
    if let Some(expiry_iso) = license_server::fetch_expiry_iso_from_server(&key)? {
        store_license_expiry(expiry_iso)?;
    }
    Ok(())
}

/// Store Puter credentials in secure storage
#[tauri::command]
fn store_puter_credentials(app_id: String, auth_token: String) -> Result<(), String> {
    use keyring::Entry;
    
    let app_id_entry = Entry::new("finance_app", "puter_app_id")
        .map_err(|e| format!("Failed to create keyring entry for app_id: {}", e))?;
    
    let token_entry = Entry::new("finance_app", "puter_auth_token")
        .map_err(|e| format!("Failed to create keyring entry for auth_token: {}", e))?;
    
    app_id_entry.set_password(&app_id)
        .map_err(|e| format!("Failed to store Puter app ID: {}", e))?;
    
    token_entry.set_password(&auth_token)
        .map_err(|e| format!("Failed to store Puter auth token: {}", e))?;
    
    Ok(())
}

/// Get Puter credentials from secure storage
#[tauri::command]
fn get_puter_credentials() -> Result<Option<(String, String)>, String> {
    use keyring::Entry;
    
    let app_id_entry = Entry::new("finance_app", "puter_app_id")
        .map_err(|e| format!("Failed to create keyring entry for app_id: {}", e))?;
    
    let token_entry = Entry::new("finance_app", "puter_auth_token")
        .map_err(|e| format!("Failed to create keyring entry for auth_token: {}", e))?;
    
    match (app_id_entry.get_password(), token_entry.get_password()) {
        (Ok(app_id), Ok(token)) => Ok(Some((app_id, token))),
        (Err(keyring::Error::NoEntry), _) | (_, Err(keyring::Error::NoEntry)) => Ok(None),
        (Err(e), _) => Err(format!("Failed to get Puter app ID: {}", e)),
        (_, Err(e)) => Err(format!("Failed to get Puter auth token: {}", e)),
    }
}

/// Hash a password using bcrypt
#[tauri::command]
fn hash_password(password: String) -> Result<String, String> {
    bcrypt::hash(&password, bcrypt::DEFAULT_COST)
        .map_err(|e| format!("Failed to hash password: {}", e))
}

/// Verify a password against a hash using bcrypt
#[tauri::command]
fn verify_password(password: String, hash: String) -> Result<bool, String> {
    bcrypt::verify(&password, &hash)
        .map_err(|e| format!("Password verification error: {}", e))
}

// Currency Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Currency {
    pub id: i64,
    pub name: String,
    pub base: bool,
    pub rate: f64,
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize currencies table (schema from db.sql on first open).
#[tauri::command]
fn init_currencies_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Create a new currency
#[tauri::command]
fn create_currency(
    db_state: State<'_, Mutex<Option<Database>>>,
    name: String,
    base: bool,
    rate: f64,
) -> Result<Currency, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // If this is set as base, unset all other base currencies
    if base {
        let update_sql = "UPDATE currencies SET base = 0";
        db.execute(update_sql, ())
            .map_err(|e| format!("Failed to update base currencies: {}", e))?;
    }

    // Insert new currency
    let insert_sql = "INSERT INTO currencies (name, base, rate) VALUES (?, ?, ?)";
    let base_int = if base { 1 } else { 0 };
    db.execute(insert_sql, (name.as_str(), base_int, rate))
        .map_err(|e| format!("Failed to insert currency: {}", e))?;

    // Get the created currency
    let currency_sql = "SELECT id, name, base, rate, created_at, updated_at FROM currencies WHERE name = ?";
    let currencies = db
        .query(currency_sql, one_param(name.as_str()), |row| {
            Ok(Currency {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                base: row_get::<i64>(row, 2)? != 0,
                rate: row_get(row, 3)?,
                created_at: row_get_string_or_datetime(row, 4)?,
                updated_at: row_get_string_or_datetime(row, 5)?,
            })
        })
        .map_err(|e| format!("Failed to fetch currency: {}", e))?;

    if let Some(currency) = currencies.first() {
        Ok(currency.clone())
    } else {
        Err("Failed to retrieve created currency".to_string())
    }
}

/// Get all currencies
#[tauri::command]
fn get_currencies(db_state: State<'_, Mutex<Option<Database>>>) -> Result<Vec<Currency>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, name, base, rate, created_at, updated_at FROM currencies ORDER BY base DESC, name ASC";
    let currencies = db
        .query(sql, (), |row| {
            Ok(Currency {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                base: row_get::<i64>(row, 2)? != 0,
                rate: row_get(row, 3)?,
                created_at: row_get_string_or_datetime(row, 4)?,
                updated_at: row_get_string_or_datetime(row, 5)?,
            })
        })
        .map_err(|e| format!("Failed to fetch currencies: {}", e))?;

    Ok(currencies)
}

/// Update a currency
#[tauri::command]
fn update_currency(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    name: String,
    base: bool,
    rate: f64,
) -> Result<Currency, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // If this is set as base, unset all other base currencies
    if base {
        let update_sql = "UPDATE currencies SET base = 0 WHERE id != ?";
        db.execute(update_sql, one_param(id))
            .map_err(|e| format!("Failed to update base currencies: {}", e))?;
    }

    // Update currency
    let base_int = if base { 1 } else { 0 };
    let update_sql = "UPDATE currencies SET name = ?, base = ?, rate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sql, (name.as_str(), base_int, rate, id))
        .map_err(|e| format!("Failed to update currency: {}", e))?;

    // Get the updated currency
    let currency_sql = "SELECT id, name, base, rate, created_at, updated_at FROM currencies WHERE id = ?";
    let currencies = db
        .query(currency_sql, one_param(id), |row| {
            Ok(Currency {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                base: row_get::<i64>(row, 2)? != 0,
                rate: row_get(row, 3)?,
                created_at: row_get_string_or_datetime(row, 4)?,
                updated_at: row_get_string_or_datetime(row, 5)?,
            })
        })
        .map_err(|e| format!("Failed to fetch currency: {}", e))?;

    if let Some(currency) = currencies.first() {
        Ok(currency.clone())
    } else {
        Err("Failed to retrieve updated currency".to_string())
    }
}

/// Delete a currency
#[tauri::command]
fn delete_currency(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM currencies WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete currency: {}", e))?;

    Ok("Currency deleted successfully".to_string())
}

// Supplier Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Supplier {
    pub id: i64,
    pub full_name: String,
    pub phone: String,
    pub address: String,
    pub email: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize suppliers table (schema from db.sql on first open).
#[tauri::command]
fn init_suppliers_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Create a new supplier
#[tauri::command]
fn create_supplier(
    db_state: State<'_, Mutex<Option<Database>>>,
    full_name: String,
    phone: String,
    address: String,
    email: Option<String>,
    notes: Option<String>,
) -> Result<Supplier, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Insert new supplier
    let insert_sql = "INSERT INTO suppliers (full_name, phone, address, email, notes) VALUES (?, ?, ?, ?, ?)";
    let email_str: Option<&str> = email.as_ref().map(|s| s.as_str());
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    db.execute(insert_sql, (
        &full_name,
        &phone,
        &address,
        &email_str,
        &notes_str,
    ))
        .map_err(|e| format!("Failed to insert supplier: {}", e))?;

    // Get the created supplier
    let supplier_sql = "SELECT id, full_name, phone, address, email, notes, created_at, updated_at FROM suppliers WHERE full_name = ? AND phone = ? ORDER BY id DESC LIMIT 1";
    let suppliers = db
        .query(supplier_sql, (full_name.as_str(), phone.as_str()), |row| {
            Ok(Supplier {
                id: row_get(row, 0)?,
                full_name: row_get(row, 1)?,
                phone: row_get(row, 2)?,
                address: row_get(row, 3)?,
                email: row_get::<Option<String>>(row, 4)?,
                notes: row_get::<Option<String>>(row, 5)?,
                created_at: row_get_string_or_datetime(row, 6)?,
                updated_at: row_get_string_or_datetime(row, 7)?,
            })
        })
        .map_err(|e| format!("Failed to fetch supplier: {}", e))?;

    if let Some(supplier) = suppliers.first() {
        Ok(supplier.clone())
    } else {
        Err("Failed to retrieve created supplier".to_string())
    }
}

/// Get all suppliers
#[tauri::command]
fn get_suppliers(
    db_state: State<'_, Mutex<Option<Database>>>,
    page: i64,
    per_page: i64,
    search: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
) -> Result<PaginatedResponse<Supplier>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let offset = (page - 1) * per_page;
    let mut where_clause = String::new();
    let mut params: Vec<serde_json::Value> = Vec::new();

    if let Some(s) = search {
        if !s.trim().is_empty() {
            let search_term = format!("%{}%", s);
            where_clause = "WHERE (full_name LIKE ? OR phone LIKE ? OR email LIKE ?)".to_string();
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term));
        }
    }

    let count_sql = format!("SELECT COUNT(*) FROM suppliers {}", where_clause);
    let mysql_count_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let count_results: Vec<i64> = db.query(&count_sql, mysql_count_params.clone(), |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to count suppliers: {}", e))?;
    let total: i64 = count_results.first().copied().unwrap_or(0);

    let order_clause = if let Some(sort) = sort_by {
        let order = sort_order.unwrap_or_else(|| "ASC".to_string());
        let allowed_cols = ["full_name", "created_at"];
        if allowed_cols.contains(&sort.as_str()) {
            format!("ORDER BY {} {}", sort, if order.to_uppercase() == "DESC" { "DESC" } else { "ASC" })
        } else {
            "ORDER BY created_at DESC".to_string()
        }
    } else {
        "ORDER BY created_at DESC".to_string()
    };

    let sql = format!("SELECT id, full_name, phone, address, email, notes, created_at, updated_at FROM suppliers {} {} LIMIT ? OFFSET ?", where_clause, order_clause);
    
    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));

    let mysql_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let suppliers = db.query(&sql, mysql_params, |row| {
        Ok(Supplier {
            id: row_get(row, 0)?,
            full_name: row_get(row, 1)?,
            phone: row_get(row, 2)?,
            address: row_get(row, 3)?,
            email: row_get::<Option<String>>(row, 4)?,
            notes: row_get::<Option<String>>(row, 5)?,
            created_at: row_get_string_or_datetime(row, 6)?,
            updated_at: row_get_string_or_datetime(row, 7)?,
        })
    }).map_err(|e| format!("Failed to fetch suppliers: {}", e))?;

    let total_pages = (total as f64 / per_page as f64).ceil() as i64;
    
    Ok(PaginatedResponse {
        items: suppliers,
        total,
        page,
        per_page,
        total_pages,
    })
}

/// Update a supplier
#[tauri::command]
fn update_supplier(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    full_name: String,
    phone: String,
    address: String,
    email: Option<String>,
    notes: Option<String>,
) -> Result<Supplier, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Update supplier
    let update_sql = "UPDATE suppliers SET full_name = ?, phone = ?, address = ?, email = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    let email_str: Option<&str> = email.as_ref().map(|s| s.as_str());
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    db.execute(update_sql, (
        &full_name,
        &phone,
        &address,
        &email_str,
        &notes_str,
        &id,
    ))
        .map_err(|e| format!("Failed to update supplier: {}", e))?;

    // Get the updated supplier
    let supplier_sql = "SELECT id, full_name, phone, address, email, notes, created_at, updated_at FROM suppliers WHERE id = ?";
    let suppliers = db
        .query(supplier_sql, one_param(id), |row| {
            Ok(Supplier {
                id: row_get(row, 0)?,
                full_name: row_get(row, 1)?,
                phone: row_get(row, 2)?,
                address: row_get(row, 3)?,
                email: row_get::<Option<String>>(row, 4)?,
                notes: row_get::<Option<String>>(row, 5)?,
                created_at: row_get_string_or_datetime(row, 6)?,
                updated_at: row_get_string_or_datetime(row, 7)?,
            })
        })
        .map_err(|e| format!("Failed to fetch supplier: {}", e))?;

    if let Some(supplier) = suppliers.first() {
        Ok(supplier.clone())
    } else {
        Err("Failed to retrieve updated supplier".to_string())
    }
}

/// Delete a supplier
#[tauri::command]
fn delete_supplier(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM suppliers WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete supplier: {}", e))?;

    Ok("Supplier deleted successfully".to_string())
}

// Customer Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Customer {
    pub id: i64,
    pub full_name: String,
    pub phone: String,
    pub address: String,
    pub email: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize customers table (schema from db.sql on first open).
#[tauri::command]
fn init_customers_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Create a new customer
#[tauri::command]
fn create_customer(
    db_state: State<'_, Mutex<Option<Database>>>,
    full_name: String,
    phone: String,
    address: String,
    email: Option<String>,
    notes: Option<String>,
) -> Result<Customer, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Insert new customer
    let insert_sql = "INSERT INTO customers (full_name, phone, address, email, notes) VALUES (?, ?, ?, ?, ?)";
    let email_str: Option<&str> = email.as_ref().map(|s| s.as_str());
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    db.execute(insert_sql, (
        &full_name,
        &phone,
        &address,
        &email_str,
        &notes_str,
    ))
        .map_err(|e| format!("Failed to insert customer: {}", e))?;

    // Get the created customer
    let customer_sql = "SELECT id, full_name, phone, address, email, notes, created_at, updated_at FROM customers WHERE full_name = ? AND phone = ? ORDER BY id DESC LIMIT 1";
    let customers = db
        .query(customer_sql, (full_name.as_str(), phone.as_str()), |row| {
            Ok(Customer {
                id: row_get(row, 0)?,
                full_name: row_get(row, 1)?,
                phone: row_get(row, 2)?,
                address: row_get(row, 3)?,
                email: row_get::<Option<String>>(row, 4)?,
                notes: row_get::<Option<String>>(row, 5)?,
                created_at: row_get_string_or_datetime(row, 6)?,
                updated_at: row_get_string_or_datetime(row, 7)?,
            })
        })
        .map_err(|e| format!("Failed to fetch customer: {}", e))?;

    if let Some(customer) = customers.first() {
        Ok(customer.clone())
    } else {
        Err("Failed to retrieve created customer".to_string())
    }
}

/// Get all customers
#[tauri::command]
fn get_customers(
    db_state: State<'_, Mutex<Option<Database>>>,
    page: i64,
    per_page: i64,
    search: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
) -> Result<PaginatedResponse<Customer>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let offset = (page - 1) * per_page;
    let mut where_clause = String::new();
    let mut params: Vec<serde_json::Value> = Vec::new();

    if let Some(s) = search {
        if !s.trim().is_empty() {
            let search_term = format!("%{}%", s);
            where_clause = "WHERE (full_name LIKE ? OR phone LIKE ? OR email LIKE ?)".to_string();
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term));
        }
    }

    let count_sql = format!("SELECT COUNT(*) FROM customers {}", where_clause);
    let mysql_count_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let count_results: Vec<i64> = db.query(&count_sql, mysql_count_params.clone(), |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to count customers: {}", e))?;
    let total: i64 = count_results.first().copied().unwrap_or(0);

    let order_clause = if let Some(sort) = sort_by {
        let order = sort_order.unwrap_or_else(|| "ASC".to_string());
        let allowed_cols = ["full_name", "created_at"];
        if allowed_cols.contains(&sort.as_str()) {
            format!("ORDER BY {} {}", sort, if order.to_uppercase() == "DESC" { "DESC" } else { "ASC" })
        } else {
            "ORDER BY created_at DESC".to_string()
        }
    } else {
        "ORDER BY created_at DESC".to_string()
    };

    let sql = format!("SELECT id, full_name, phone, address, email, notes, created_at, updated_at FROM customers {} {} LIMIT ? OFFSET ?", where_clause, order_clause);
    
    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));

    let mysql_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let customers = db.query(&sql, mysql_params, |row| {
        Ok(Customer {
            id: row_get(row, 0)?,
            full_name: row_get(row, 1)?,
            phone: row_get(row, 2)?,
            address: row_get(row, 3)?,
            email: row_get::<Option<String>>(row, 4)?,
            notes: row_get::<Option<String>>(row, 5)?,
            created_at: row_get_string_or_datetime(row, 6)?,
            updated_at: row_get_string_or_datetime(row, 7)?,
        })
    }).map_err(|e| format!("Failed to fetch customers: {}", e))?;

    let total_pages = (total as f64 / per_page as f64).ceil() as i64;
    
    Ok(PaginatedResponse {
        items: customers,
        total,
        page,
        per_page,
        total_pages,
    })
}

/// Update a customer
#[tauri::command]
fn update_customer(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    full_name: String,
    phone: String,
    address: String,
    email: Option<String>,
    notes: Option<String>,
) -> Result<Customer, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Update customer
    let update_sql = "UPDATE customers SET full_name = ?, phone = ?, address = ?, email = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    let email_str: Option<&str> = email.as_ref().map(|s| s.as_str());
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    db.execute(update_sql, (
        &full_name,
        &phone,
        &address,
        &email_str,
        &notes_str,
        &id,
    ))
        .map_err(|e| format!("Failed to update customer: {}", e))?;

    // Get the updated customer
    let customer_sql = "SELECT id, full_name, phone, address, email, notes, created_at, updated_at FROM customers WHERE id = ?";
    let customers = db
        .query(customer_sql, one_param(id), |row| {
            Ok(Customer {
                id: row_get(row, 0)?,
                full_name: row_get(row, 1)?,
                phone: row_get(row, 2)?,
                address: row_get(row, 3)?,
                email: row_get::<Option<String>>(row, 4)?,
                notes: row_get::<Option<String>>(row, 5)?,
                created_at: row_get_string_or_datetime(row, 6)?,
                updated_at: row_get_string_or_datetime(row, 7)?,
            })
        })
        .map_err(|e| format!("Failed to fetch customer: {}", e))?;

    if let Some(customer) = customers.first() {
        Ok(customer.clone())
    } else {
        Err("Failed to retrieve updated customer".to_string())
    }
}

/// Delete a customer
#[tauri::command]
fn delete_customer(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM customers WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete customer: {}", e))?;

    Ok("Customer deleted successfully".to_string())
}

// UnitGroup Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitGroup {
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize unit_groups table (schema from db.sql on first open).
#[tauri::command]
fn init_unit_groups_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Get all unit groups
#[tauri::command]
fn get_unit_groups(db_state: State<'_, Mutex<Option<Database>>>) -> Result<Vec<UnitGroup>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, name, created_at, updated_at FROM unit_groups ORDER BY name ASC";
    let groups = db
        .query(sql, (), |row| {
            Ok(UnitGroup {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                created_at: row_get_string_or_datetime(row, 2)?,
                updated_at: row_get_string_or_datetime(row, 3)?,
            })
        })
        .map_err(|e| format!("Failed to fetch unit groups: {}", e))?;

    Ok(groups)
}

/// Create a new unit group
#[tauri::command]
fn create_unit_group(
    db_state: State<'_, Mutex<Option<Database>>>,
    name: String,
) -> Result<UnitGroup, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let insert_sql = "INSERT INTO unit_groups (name) VALUES (?)";
    db.execute(insert_sql, one_param(name.as_str()))
        .map_err(|e| format!("Failed to insert unit group: {}", e))?;

    let group_sql = "SELECT id, name, created_at, updated_at FROM unit_groups WHERE name = ?";
    let groups = db
        .query(group_sql, one_param(name.as_str()), |row| {
            Ok(UnitGroup {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                created_at: row_get_string_or_datetime(row, 2)?,
                updated_at: row_get_string_or_datetime(row, 3)?,
            })
        })
        .map_err(|e| format!("Failed to fetch unit group: {}", e))?;

    if let Some(g) = groups.first() {
        Ok(g.clone())
    } else {
        Err("Failed to retrieve created unit group".to_string())
    }
}

// Unit Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Unit {
    pub id: i64,
    pub name: String,
    pub group_id: Option<i64>,
    pub ratio: f64,
    pub is_base: bool,
    pub group_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize units table (schema from db.sql on first open).
#[tauri::command]
fn init_units_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Create a new unit
#[tauri::command]
fn create_unit(
    db_state: State<'_, Mutex<Option<Database>>>,
    name: String,
    group_id: Option<i64>,
    ratio: f64,
    is_base: bool,
) -> Result<Unit, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let is_base_int: i32 = if is_base { 1 } else { 0 };
    let insert_sql = "INSERT INTO units (name, group_id, ratio, is_base) VALUES (?, ?, ?, ?)";
    let insert_params: Vec<Value> = vec![
        Value::from(name.as_str()),
        group_id.map(Value::Int).unwrap_or(Value::NULL),
        Value::Double(ratio),
        Value::Int(is_base_int as i64),
    ];
    db.execute(insert_sql, insert_params)
        .map_err(|e| format!("Failed to insert unit: {}", e))?;

    let unit_sql = "SELECT u.id, u.name, u.created_at, u.updated_at, u.group_id, u.ratio, u.is_base, g.name FROM units u LEFT JOIN unit_groups g ON u.group_id = g.id WHERE u.name = ? ORDER BY u.id DESC LIMIT 1";
    let units = db
        .query(unit_sql, one_param(name.as_str()), |row| {
            Ok(Unit {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                created_at: row_get_string_or_datetime(row, 2)?,
                updated_at: row_get_string_or_datetime(row, 3)?,
                group_id: row_get(row, 4)?,
                ratio: row_get(row, 5)?,
                is_base: row_get::<i32>(row, 6)? != 0,
                group_name: row_get(row, 7)?,
            })
        })
        .map_err(|e| format!("Failed to fetch unit: {}", e))?;

    if let Some(unit) = units.first() {
        Ok(unit.clone())
    } else {
        Err("Failed to retrieve created unit".to_string())
    }
}

/// Get all units
#[tauri::command]
fn get_units(db_state: State<'_, Mutex<Option<Database>>>) -> Result<Vec<Unit>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT u.id, u.name, u.created_at, u.updated_at, u.group_id, u.ratio, u.is_base, g.name FROM units u LEFT JOIN unit_groups g ON u.group_id = g.id ORDER BY u.name ASC";
    let units = db
        .query(sql, (), |row| {
            Ok(Unit {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                created_at: row_get_string_or_datetime(row, 2)?,
                updated_at: row_get_string_or_datetime(row, 3)?,
                group_id: row_get(row, 4)?,
                ratio: row_get(row, 5)?,
                is_base: row_get::<i32>(row, 6)? != 0,
                group_name: row_get(row, 7)?,
            })
        })
        .map_err(|e| format!("Failed to fetch units: {}", e))?;

    Ok(units)
}

/// Update a unit
#[tauri::command]
fn update_unit(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    name: String,
    group_id: Option<i64>,
    ratio: f64,
    is_base: bool,
) -> Result<Unit, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let is_base_int: i32 = if is_base { 1 } else { 0 };
    let update_sql = "UPDATE units SET name = ?, group_id = ?, ratio = ?, is_base = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    let update_params: Vec<Value> = vec![
        Value::from(name.as_str()),
        group_id.map(Value::Int).unwrap_or(Value::NULL),
        Value::Double(ratio),
        Value::Int(is_base_int as i64),
        Value::Int(id),
    ];
    db.execute(update_sql, update_params)
        .map_err(|e| format!("Failed to update unit: {}", e))?;

    let unit_sql = "SELECT u.id, u.name, u.created_at, u.updated_at, u.group_id, u.ratio, u.is_base, g.name FROM units u LEFT JOIN unit_groups g ON u.group_id = g.id WHERE u.id = ?";
    let units = db
        .query(unit_sql, one_param(id), |row| {
            Ok(Unit {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                created_at: row_get_string_or_datetime(row, 2)?,
                updated_at: row_get_string_or_datetime(row, 3)?,
                group_id: row_get(row, 4)?,
                ratio: row_get(row, 5)?,
                is_base: row_get::<i32>(row, 6)? != 0,
                group_name: row_get(row, 7)?,
            })
        })
        .map_err(|e| format!("Failed to fetch unit: {}", e))?;

    if let Some(unit) = units.first() {
        Ok(unit.clone())
    } else {
        Err("Failed to retrieve updated unit".to_string())
    }
}

/// Delete a unit
#[tauri::command]
fn delete_unit(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM units WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete unit: {}", e))?;

    Ok("Unit deleted successfully".to_string())
}

// Product Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Product {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub price: Option<f64>,
    pub currency_id: Option<i64>,
    pub supplier_id: Option<i64>,
    pub stock_quantity: Option<f64>,
    pub unit: Option<String>,
    pub image_path: Option<String>,
    pub bar_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize products table (schema from db.sql on first open).
#[tauri::command]
fn init_products_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Create a new product
#[tauri::command]
fn create_product(
    db_state: State<'_, Mutex<Option<Database>>>,
    name: String,
    description: Option<String>,
    price: Option<f64>,
    currency_id: Option<i64>,
    supplier_id: Option<i64>,
    stock_quantity: Option<f64>,
    unit: Option<String>,
    image_path: Option<String>,
    bar_code: Option<String>,
) -> Result<Product, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Insert new product
    let insert_sql = "INSERT INTO products (name, description, price, currency_id, supplier_id, stock_quantity, unit, image_path, bar_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
    let description_str: Option<&str> = description.as_ref().map(|s| s.as_str());
    let unit_str: Option<&str> = unit.as_ref().map(|s| s.as_str());
    let image_path_str: Option<&str> = image_path.as_ref().map(|s| s.as_str());
    let bar_code_str: Option<&str> = bar_code.as_ref().map(|s| s.as_str());
    db.execute(insert_sql, (
        &name,
        &description_str,
        &price,
        &currency_id,
        &supplier_id,
        &stock_quantity,
        &unit_str,
        &image_path_str,
        &bar_code_str,
    ))
        .map_err(|e| format!("Failed to insert product: {}", e))?;

    // Get the created product
    let product_sql = "SELECT id, name, description, price, currency_id, supplier_id, stock_quantity, unit, image_path, bar_code, created_at, updated_at FROM products WHERE name = ? ORDER BY id DESC LIMIT 1";
    let products = db
        .query(product_sql, one_param(name.as_str()), |row| {
            Ok(Product {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                description: row_get::<Option<String>>(row, 2)?,
                price: row_get::<Option<f64>>(row, 3)?,
                currency_id: row_get::<Option<i64>>(row, 4)?,
                supplier_id: row_get::<Option<i64>>(row, 5)?,
                stock_quantity: row_get::<Option<f64>>(row, 6)?,
                unit: row_get::<Option<String>>(row, 7)?,
                image_path: row_get::<Option<String>>(row, 8)?,
                bar_code: row_get::<Option<String>>(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch product: {}", e))?;

    if let Some(product) = products.first() {
        Ok(product.clone())
    } else {
        Err("Failed to retrieve created product".to_string())
    }
}

/// Get all products
#[tauri::command]
fn get_products(
    db_state: State<'_, Mutex<Option<Database>>>,
    page: i64,
    per_page: i64,
    search: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
) -> Result<PaginatedResponse<Product>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let offset = (page - 1) * per_page;
    let mut where_clause = String::new();
    let mut params: Vec<serde_json::Value> = Vec::new();

    if let Some(s) = search {
        if !s.trim().is_empty() {
            let search_term = format!("%{}%", s);
            where_clause = "WHERE (name LIKE ? OR bar_code LIKE ?)".to_string();
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term));
        }
    }

    let count_sql = format!("SELECT COUNT(*) FROM products {}", where_clause);
    let mysql_count_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let count_results: Vec<i64> = db.query(&count_sql, mysql_count_params.clone(), |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to count products: {}", e))?;
    let total: i64 = count_results.first().copied().unwrap_or(0);

    let order_clause = if let Some(sort) = sort_by {
        let order = sort_order.unwrap_or_else(|| "ASC".to_string());
        let allowed_cols = ["name", "price", "stock_quantity", "created_at"];
        if allowed_cols.contains(&sort.as_str()) {
            format!("ORDER BY {} {}", sort, if order.to_uppercase() == "DESC" { "DESC" } else { "ASC" })
        } else {
            "ORDER BY created_at DESC".to_string()
        }
    } else {
        "ORDER BY created_at DESC".to_string()
    };

    let sql = format!("SELECT id, name, description, price, currency_id, supplier_id, stock_quantity, unit, image_path, bar_code, created_at, updated_at FROM products {} {} LIMIT ? OFFSET ?", where_clause, order_clause);
    
    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));

    let mysql_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let products = db.query(&sql, mysql_params, |row| {
        Ok(Product {
            id: row_get(row, 0)?,
            name: row_get(row, 1)?,
            description: row_get::<Option<String>>(row, 2)?,
            price: row_get::<Option<f64>>(row, 3)?,
            currency_id: row_get::<Option<i64>>(row, 4)?,
            supplier_id: row_get::<Option<i64>>(row, 5)?,
            stock_quantity: row_get::<Option<f64>>(row, 6)?,
            unit: row_get::<Option<String>>(row, 7)?,
            image_path: row_get::<Option<String>>(row, 8)?,
            bar_code: row_get::<Option<String>>(row, 9)?,
            created_at: row_get_string_or_datetime(row, 10)?,
            updated_at: row_get_string_or_datetime(row, 11)?,
        })
    }).map_err(|e| format!("Failed to fetch products: {}", e))?;

    let total_pages = (total as f64 / per_page as f64).ceil() as i64;
    
    Ok(PaginatedResponse {
        items: products,
        total,
        page,
        per_page,
        total_pages,
    })
}

/// Update a product
#[tauri::command]
fn update_product(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    name: String,
    description: Option<String>,
    price: Option<f64>,
    currency_id: Option<i64>,
    supplier_id: Option<i64>,
    stock_quantity: Option<f64>,
    unit: Option<String>,
    image_path: Option<String>,
    bar_code: Option<String>,
) -> Result<Product, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Update product
    let update_sql = "UPDATE products SET name = ?, description = ?, price = ?, currency_id = ?, supplier_id = ?, stock_quantity = ?, unit = ?, image_path = ?, bar_code = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    let description_str: Option<&str> = description.as_ref().map(|s| s.as_str());
    let unit_str: Option<&str> = unit.as_ref().map(|s| s.as_str());
    let image_path_str: Option<&str> = image_path.as_ref().map(|s| s.as_str());
    let bar_code_str: Option<&str> = bar_code.as_ref().map(|s| s.as_str());
    db.execute(update_sql, (
        &name,
        &description_str,
        &price,
        &currency_id,
        &supplier_id,
        &stock_quantity,
        &unit_str,
        &image_path_str,
        &bar_code_str,
        &id,
    ))
        .map_err(|e| format!("Failed to update product: {}", e))?;

    // Get the updated product
    let product_sql = "SELECT id, name, description, price, currency_id, supplier_id, stock_quantity, unit, image_path, bar_code, created_at, updated_at FROM products WHERE id = ?";
    let products = db
        .query(product_sql, one_param(id), |row| {
            Ok(Product {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                description: row_get::<Option<String>>(row, 2)?,
                price: row_get::<Option<f64>>(row, 3)?,
                currency_id: row_get::<Option<i64>>(row, 4)?,
                supplier_id: row_get::<Option<i64>>(row, 5)?,
                stock_quantity: row_get::<Option<f64>>(row, 6)?,
                unit: row_get::<Option<String>>(row, 7)?,
                image_path: row_get::<Option<String>>(row, 8)?,
                bar_code: row_get::<Option<String>>(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch product: {}", e))?;

    if let Some(product) = products.first() {
        Ok(product.clone())
    } else {
        Err("Failed to retrieve updated product".to_string())
    }
}

/// Delete a product
#[tauri::command]
fn delete_product(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Check if product is used in purchase_items
    let purchase_check_sql = "SELECT COUNT(*) FROM purchase_items WHERE product_id = ?";
    let purchase_count: i64 = db
        .query(purchase_check_sql, one_param(id), |row| {
            Ok(row_get(row, 0)?)
        })
        .map_err(|e| format!("Failed to check purchase items: {}", e))?
        .first()
        .cloned()
        .unwrap_or(0);

    // Check if product is used in sale_items
    let sale_check_sql = "SELECT COUNT(*) FROM sale_items WHERE product_id = ?";
    let sale_count: i64 = db
        .query(sale_check_sql, one_param(id), |row| {
            Ok(row_get(row, 0)?)
        })
        .map_err(|e| format!("Failed to check sale items: {}", e))?
        .first()
        .cloned()
        .unwrap_or(0);

    if purchase_count > 0 || sale_count > 0 {
        let mut reasons = Vec::new();
        if purchase_count > 0 {
            reasons.push(format!("used in {} purchase(s)", purchase_count));
        }
        if sale_count > 0 {
            reasons.push(format!("used in {} sale(s)", sale_count));
        }
        return Err(format!("Cannot delete product: it is {}", reasons.join(" and ")));
    }

    let delete_sql = "DELETE FROM products WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete product: {}", e))?;

    Ok("Product deleted successfully".to_string())
}

// Purchase Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Purchase {
    pub id: i64,
    pub supplier_id: i64,
    pub date: String,
    pub notes: Option<String>,
    pub currency_id: Option<i64>,
    pub total_amount: f64,
    pub additional_cost: f64,
    pub batch_number: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// PurchaseItem Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseItem {
    pub id: i64,
    pub purchase_id: i64,
    pub product_id: i64,
    pub unit_id: i64,
    pub per_price: f64,
    pub amount: f64,
    pub total: f64,
    pub per_unit: Option<f64>,
    pub cost_price: Option<f64>,
    pub wholesale_price: Option<f64>,
    pub retail_price: Option<f64>,
    pub expiry_date: Option<String>,
    pub created_at: String,
}

// PurchaseAdditionalCost Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchaseAdditionalCost {
    pub id: i64,
    pub purchase_id: i64,
    pub name: String,
    pub amount: f64,
    pub created_at: String,
}

/// Initialize purchases table (schema from db.sql on first open).
#[tauri::command]
fn init_purchases_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Create a new purchase with items
#[tauri::command]
fn create_purchase(
    db_state: State<'_, Mutex<Option<Database>>>,
    supplier_id: i64,
    date: String,
    notes: Option<String>,
    currency_id: Option<i64>,
    additional_costs: Vec<(String, f64)>, // (name, amount)
    items: Vec<(i64, i64, f64, f64, Option<f64>, Option<f64>, Option<f64>, Option<f64>, Option<String>)>, // (product_id, unit_id, per_price, amount, per_unit, cost_price, wholesale_price, retail_price, expiry_date)
) -> Result<Purchase, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Generate batch number
    let batch_number_sql = "SELECT COALESCE(MAX(CAST(SUBSTRING(batch_number, 7) AS SIGNED)), 0) + 1 FROM purchases WHERE batch_number LIKE 'BATCH-%'";
    let batch_numbers = db
        .query(batch_number_sql, (), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to generate batch number: {}", e))?;
    let batch_number = format!("BATCH-{:06}", batch_numbers.first().copied().unwrap_or(1));

    // Calculate total amount from items + additional costs
    let items_total: f64 = items.iter().map(|(_, _, per_price, amount, _, _, _, _, _)| per_price * amount).sum();
    let additional_costs_total: f64 = additional_costs.iter().map(|(_, amount)| amount).sum();
    let total_amount = items_total + additional_costs_total;

    // Insert purchase (without additional_cost column since we're using the table now)
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    let insert_sql = "INSERT INTO purchases (supplier_id, date, notes, currency_id, total_amount, batch_number) VALUES (?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, (
        &supplier_id,
        &date,
        &notes_str,
        &currency_id,
        &total_amount,
        &batch_number,
    ))
        .map_err(|e| format!("Failed to insert purchase: {}", e))?;

    // Get the created purchase ID
    let purchase_id_sql = "SELECT id FROM purchases WHERE supplier_id = ? AND date = ? ORDER BY id DESC LIMIT 1";
    let purchase_ids = db
        .query(purchase_id_sql, (supplier_id, date.as_str()), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to fetch purchase ID: {}", e))?;

    let purchase_id = purchase_ids.first().ok_or("Failed to retrieve purchase ID")?;

    // Insert purchase items
    for (product_id, unit_id, per_price, amount, per_unit, cost_price, wholesale_price, retail_price, expiry_date) in items {
        let total = per_price * amount;
        let insert_item_sql = "INSERT INTO purchase_items (purchase_id, product_id, unit_id, per_price, amount, total, per_unit, cost_price, wholesale_price, retail_price, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        db.execute(insert_item_sql, (
            purchase_id,
            &product_id,
            &unit_id,
            &per_price,
            &amount,
            &total,
            &per_unit,
            &cost_price,
            &wholesale_price,
            &retail_price,
            &expiry_date,
        ))
            .map_err(|e| format!("Failed to insert purchase item: {}", e))?;
    }

    // Insert additional costs
    for (name, amount) in additional_costs {
        let insert_cost_sql = "INSERT INTO purchase_additional_costs (purchase_id, name, amount) VALUES (?, ?, ?)";
        db.execute(insert_cost_sql, (
            purchase_id,
            &name,
            &amount,
        ))
            .map_err(|e| format!("Failed to insert purchase additional cost: {}", e))?;
    }

    // Get the created purchase (calculate additional_cost from the table for backward compatibility)
    let purchase_sql = "SELECT id, supplier_id, date, notes, currency_id, total_amount, batch_number, created_at, updated_at FROM purchases WHERE id = ?";
    let purchases = db
        .query(purchase_sql, one_param(purchase_id), |row| {
            Ok(Purchase {
                id: row_get(row, 0)?,
                supplier_id: row_get(row, 1)?,
                date: row_get(row, 2)?,
                notes: row_get(row, 3)?,
                currency_id: row_get(row, 4)?,
                total_amount: row_get(row, 5)?,
                additional_cost: additional_costs_total, // Sum of all additional costs
                batch_number: row_get(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch purchase: {}", e))?;

    if let Some(purchase) = purchases.first() {
        Ok(purchase.clone())
    } else {
        Err("Failed to retrieve created purchase".to_string())
    }
}

/// Get all purchases with pagination
#[tauri::command]
fn get_purchases(
    db_state: State<'_, Mutex<Option<Database>>>,
    page: i64,
    per_page: i64,
    search: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
) -> Result<PaginatedResponse<Purchase>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let offset = (page - 1) * per_page;

    // Build WHERE clause
    let mut where_clause = String::new();
    let mut params: Vec<serde_json::Value> = Vec::new();

    if let Some(s) = search {
        if !s.trim().is_empty() {
            let search_term = format!("%{}%", s);
            where_clause = "WHERE (CAST(p.date AS TEXT) LIKE ? OR p.notes LIKE ? OR p.supplier_id IN (SELECT id FROM suppliers WHERE full_name LIKE ?))".to_string();
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term));
        }
    }

    // Get total count
    let count_sql = format!("SELECT COUNT(*) FROM purchases p {}", where_clause);
    let mysql_count_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let count_results: Vec<i64> = db.query(&count_sql, mysql_count_params.clone(), |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to count purchases: {}", e))?;
    let total: i64 = count_results.first().copied().unwrap_or(0);

    // Build Order By
    let order_clause = if let Some(sort) = sort_by {
        let order = sort_order.unwrap_or_else(|| "DESC".to_string());
        let allowed_cols = ["date", "total_amount", "created_at"];
        if allowed_cols.contains(&sort.as_str()) {
            format!("ORDER BY p.{} {}", sort, if order.to_uppercase() == "DESC" { "DESC" } else { "ASC" })
        } else {
            "ORDER BY p.date DESC, p.created_at DESC".to_string()
        }
    } else {
        "ORDER BY p.date DESC, p.created_at DESC".to_string()
    };

    let sql = format!("SELECT p.id, p.supplier_id, p.date, p.notes, p.currency_id, p.total_amount, p.batch_number, p.created_at, p.updated_at FROM purchases p {} {} LIMIT ? OFFSET ?", where_clause, order_clause);
    
    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));

    let mysql_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let mut purchases = db.query(&sql, mysql_params, |row| {
        Ok(Purchase {
            id: row_get(row, 0)?,
            supplier_id: row_get(row, 1)?,
            date: row_get(row, 2)?,
            notes: row_get(row, 3)?,
            currency_id: row_get(row, 4)?,
            total_amount: row_get(row, 5)?,
            additional_cost: 0.0,
            batch_number: row_get(row, 6)?,
            created_at: row_get_string_or_datetime(row, 7)?,
            updated_at: row_get_string_or_datetime(row, 8)?,
        })
    }).map_err(|e| format!("Failed to fetch purchases: {}", e))?;

    for purchase in purchases.iter_mut() {
        let additional_costs_sql = "SELECT COALESCE(SUM(amount), 0) FROM purchase_additional_costs WHERE purchase_id = ?";
        let cost_results: Vec<f64> = db.query(additional_costs_sql, (purchase.id,), |row| Ok(row_get::<f64>(row, 0)?))
            .unwrap_or_default();
        purchase.additional_cost = cost_results.first().copied().unwrap_or(0.0);
    }

    let total_pages = (total as f64 / per_page as f64).ceil() as i64;
    
    Ok(PaginatedResponse {
        items: purchases,
        total,
        page,
        per_page,
        total_pages,
    })
}

/// Get a single purchase with its items
#[tauri::command]
fn get_purchase(db_state: State<'_, Mutex<Option<Database>>>, id: i64) -> Result<(Purchase, Vec<PurchaseItem>), String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Get purchase
    let purchase_sql = "SELECT id, supplier_id, date, notes, currency_id, total_amount, batch_number, created_at, updated_at FROM purchases WHERE id = ?";
    let purchases = db
        .query(purchase_sql, one_param(id), |row| {
            Ok(Purchase {
                id: row_get(row, 0)?,
                supplier_id: row_get(row, 1)?,
                date: row_get(row, 2)?,
                notes: row_get(row, 3)?,
                currency_id: row_get(row, 4)?,
                total_amount: row_get(row, 5)?,
                additional_cost: 0.0, // Will be calculated from purchase_additional_costs table
                batch_number: row_get(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch purchase: {}", e))?;

    let mut purchase = purchases.first().ok_or("Purchase not found")?.clone();

    // Calculate additional_cost from purchase_additional_costs table
    let additional_costs_sql = "SELECT COALESCE(SUM(amount), 0) FROM purchase_additional_costs WHERE purchase_id = ?";
    let additional_cost_results: Vec<f64> = db
        .query(additional_costs_sql, one_param(id), |row| {
            Ok(row_get::<f64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to calculate additional cost: {}", e))?;
    let additional_cost = additional_cost_results.first().copied().unwrap_or(0.0);
    purchase.additional_cost = additional_cost;

    // Get purchase items
    let items_sql = "SELECT id, purchase_id, product_id, unit_id, per_price, amount, total, per_unit, cost_price, wholesale_price, retail_price, expiry_date, created_at FROM purchase_items WHERE purchase_id = ?";
    let items = db
        .query(items_sql, one_param(id), |row| {
            Ok(PurchaseItem {
                id: row_get(row, 0)?,
                purchase_id: row_get(row, 1)?,
                product_id: row_get(row, 2)?,
                unit_id: row_get(row, 3)?,
                per_price: row_get(row, 4)?,
                amount: row_get(row, 5)?,
                total: row_get(row, 6)?,
                per_unit: row_get(row, 7)?,
                cost_price: row_get(row, 8)?,
                wholesale_price: row_get(row, 9)?,
                retail_price: row_get(row, 10)?,
                expiry_date: row_get(row, 11)?,
                created_at: row_get_string_or_datetime(row, 12)?,
            })
        })
        .map_err(|e| format!("Failed to fetch purchase items: {}", e))?;

    Ok((purchase, items))
}

/// Update a purchase
#[tauri::command]
fn update_purchase(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    supplier_id: i64,
    date: String,
    notes: Option<String>,
    currency_id: Option<i64>,
    additional_costs: Vec<(String, f64)>, // (name, amount)
    items: Vec<(i64, i64, f64, f64, Option<f64>, Option<f64>, Option<f64>, Option<f64>, Option<String>)>, // (product_id, unit_id, per_price, amount, per_unit, cost_price, wholesale_price, retail_price, expiry_date)
) -> Result<Purchase, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Calculate total amount from items + additional costs
    let items_total: f64 = items.iter().map(|(_, _, per_price, amount, _, _, _, _, _)| per_price * amount).sum();
    let additional_costs_total: f64 = additional_costs.iter().map(|(_, amount)| amount).sum();
    let total_amount = items_total + additional_costs_total;

    // Update purchase
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    let update_sql = "UPDATE purchases SET supplier_id = ?, date = ?, notes = ?, currency_id = ?, total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sql, (
        &supplier_id,
        &date,
        &notes_str,
        &currency_id,
        &total_amount,
        &id,
    ))
        .map_err(|e| format!("Failed to update purchase: {}", e))?;

    // Delete existing items
    let delete_items_sql = "DELETE FROM purchase_items WHERE purchase_id = ?";
    db.execute(delete_items_sql, one_param(id))
        .map_err(|e| format!("Failed to delete purchase items: {}", e))?;

    // Delete existing additional costs
    let delete_costs_sql = "DELETE FROM purchase_additional_costs WHERE purchase_id = ?";
    db.execute(delete_costs_sql, one_param(id))
        .map_err(|e| format!("Failed to delete purchase additional costs: {}", e))?;

    // Insert new items
    for (product_id, unit_id, per_price, amount, per_unit, cost_price, wholesale_price, retail_price, expiry_date) in items {
        let total = per_price * amount;
        let insert_item_sql = "INSERT INTO purchase_items (purchase_id, product_id, unit_id, per_price, amount, total, per_unit, cost_price, wholesale_price, retail_price, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        db.execute(insert_item_sql, (
            &id,
            &product_id,
            &unit_id,
            &per_price,
            &amount,
            &total,
            &per_unit,
            &cost_price,
            &wholesale_price,
            &retail_price,
            &expiry_date,
        ))
            .map_err(|e| format!("Failed to insert purchase item: {}", e))?;
    }

    // Insert additional costs
    for (name, amount) in additional_costs {
        let insert_cost_sql = "INSERT INTO purchase_additional_costs (purchase_id, name, amount) VALUES (?, ?, ?)";
        db.execute(insert_cost_sql, (
            &id,
            &name,
            &amount,
        ))
            .map_err(|e| format!("Failed to insert purchase additional cost: {}", e))?;
    }

    // Get the updated purchase (calculate additional_cost from the table for backward compatibility)
    let purchase_sql = "SELECT id, supplier_id, date, notes, currency_id, total_amount, batch_number, created_at, updated_at FROM purchases WHERE id = ?";
    let purchases = db
        .query(purchase_sql, one_param(id), |row| {
            Ok(Purchase {
                id: row_get(row, 0)?,
                supplier_id: row_get(row, 1)?,
                date: row_get(row, 2)?,
                notes: row_get(row, 3)?,
                currency_id: row_get(row, 4)?,
                total_amount: row_get(row, 5)?,
                additional_cost: additional_costs_total, // Sum of all additional costs
                batch_number: row_get(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch purchase: {}", e))?;

    if let Some(purchase) = purchases.first() {
        Ok(purchase.clone())
    } else {
        Err("Failed to retrieve updated purchase".to_string())
    }
}

/// Delete a purchase (items will be deleted automatically due to CASCADE)
#[tauri::command]
fn delete_purchase(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM purchases WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete purchase: {}", e))?;

    Ok("Purchase deleted successfully".to_string())
}

/// Create a purchase item (standalone, for adding items to existing purchase)
#[tauri::command]
fn create_purchase_item(
    db_state: State<'_, Mutex<Option<Database>>>,
    purchase_id: i64,
    product_id: i64,
    unit_id: i64,
    per_price: f64,
    amount: f64,
) -> Result<PurchaseItem, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let total = per_price * amount;

    let insert_sql = "INSERT INTO purchase_items (purchase_id, product_id, unit_id, per_price, amount, total, per_unit, cost_price, wholesale_price, retail_price, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, (
        &purchase_id,
        &product_id,
        &unit_id,
        &per_price,
        &amount,
        &total,
        &None::<f64>,
        &None::<f64>,
        &None::<f64>,
        &None::<f64>,
        &None::<String>,
    ))
        .map_err(|e| format!("Failed to insert purchase item: {}", e))?;

    // Update purchase total (items total + additional_cost)
    let update_purchase_sql = "UPDATE purchases SET total_amount = (SELECT COALESCE(SUM(total), 0) FROM purchase_items WHERE purchase_id = ?) + COALESCE((SELECT additional_cost FROM purchases WHERE id = ?), 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_purchase_sql, (purchase_id, purchase_id, purchase_id))
        .map_err(|e| format!("Failed to update purchase total: {}", e))?;

    // Get the created item
    let item_sql = "SELECT id, purchase_id, product_id, unit_id, per_price, amount, total, per_unit, cost_price, wholesale_price, retail_price, expiry_date, created_at FROM purchase_items WHERE purchase_id = ? AND product_id = ? ORDER BY id DESC LIMIT 1";
    let items = db
        .query(item_sql, (purchase_id, product_id), |row| {
            Ok(PurchaseItem {
                id: row_get(row, 0)?,
                purchase_id: row_get(row, 1)?,
                product_id: row_get(row, 2)?,
                unit_id: row_get(row, 3)?,
                per_price: row_get(row, 4)?,
                amount: row_get(row, 5)?,
                total: row_get(row, 6)?,
                per_unit: row_get(row, 7)?,
                cost_price: row_get(row, 8)?,
                wholesale_price: row_get(row, 9)?,
                retail_price: row_get(row, 10)?,
                expiry_date: row_get(row, 11)?,
                created_at: row_get_string_or_datetime(row, 12)?,
            })
        })
        .map_err(|e| format!("Failed to fetch purchase item: {}", e))?;

    if let Some(item) = items.first() {
        Ok(item.clone())
    } else {
        Err("Failed to retrieve created purchase item".to_string())
    }
}

/// Get purchase items for a purchase
#[tauri::command]
fn get_purchase_items(db_state: State<'_, Mutex<Option<Database>>>, purchase_id: i64) -> Result<Vec<PurchaseItem>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, purchase_id, product_id, unit_id, per_price, amount, total, per_unit, cost_price, wholesale_price, retail_price, expiry_date, created_at FROM purchase_items WHERE purchase_id = ? ORDER BY id";
    let items = db
        .query(sql, one_param(purchase_id), |row| {
            Ok(PurchaseItem {
                id: row_get(row, 0)?,
                purchase_id: row_get(row, 1)?,
                product_id: row_get(row, 2)?,
                unit_id: row_get(row, 3)?,
                per_price: row_get(row, 4)?,
                amount: row_get(row, 5)?,
                total: row_get(row, 6)?,
                per_unit: row_get(row, 7)?,
                cost_price: row_get(row, 8)?,
                wholesale_price: row_get(row, 9)?,
                retail_price: row_get(row, 10)?,
                expiry_date: row_get(row, 11)?,
                created_at: row_get_string_or_datetime(row, 12)?,
            })
        })
        .map_err(|e| format!("Failed to fetch purchase items: {}", e))?;

    Ok(items)
}

/// Get purchase additional costs for a purchase
#[tauri::command]
fn get_purchase_additional_costs(db_state: State<'_, Mutex<Option<Database>>>, purchase_id: i64) -> Result<Vec<PurchaseAdditionalCost>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, purchase_id, name, amount, created_at FROM purchase_additional_costs WHERE purchase_id = ? ORDER BY id";
    let costs = db
        .query(sql, one_param(purchase_id), |row| {
            Ok(PurchaseAdditionalCost {
                id: row_get(row, 0)?,
                purchase_id: row_get(row, 1)?,
                name: row_get(row, 2)?,
                amount: row_get(row, 3)?,
                created_at: row_get_string_or_datetime(row, 4)?,
            })
        })
        .map_err(|e| format!("Failed to fetch purchase additional costs: {}", e))?;

    Ok(costs)
}

/// Update a purchase item
#[tauri::command]
fn update_purchase_item(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    product_id: i64,
    unit_id: i64,
    per_price: f64,
    amount: f64,
) -> Result<PurchaseItem, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let total = per_price * amount;

    let update_sql = "UPDATE purchase_items SET product_id = ?, unit_id = ?, per_price = ?, amount = ?, total = ?, per_unit = ?, cost_price = ?, wholesale_price = ?, retail_price = ?, expiry_date = ? WHERE id = ?";
    db.execute(update_sql, (
        &product_id,
        &unit_id,
        &per_price,
        &amount,
        &total,
        &None::<f64>,
        &None::<f64>,
        &None::<f64>,
        &None::<f64>,
        &None::<String>,
        &id,
    ))
        .map_err(|e| format!("Failed to update purchase item: {}", e))?;

    // Get purchase_id to update purchase total
    let purchase_id_sql = "SELECT purchase_id FROM purchase_items WHERE id = ?";
    let purchase_ids = db
        .query(purchase_id_sql, one_param(id), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to fetch purchase_id: {}", e))?;

    if let Some(purchase_id) = purchase_ids.first() {
        // Update purchase total (items total + additional_cost)
        let update_purchase_sql = "UPDATE purchases SET total_amount = (SELECT COALESCE(SUM(total), 0) FROM purchase_items WHERE purchase_id = ?) + COALESCE((SELECT additional_cost FROM purchases WHERE id = ?), 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
        db.execute(update_purchase_sql, (purchase_id, purchase_id, purchase_id))
            .map_err(|e| format!("Failed to update purchase total: {}", e))?;
    }

    // Get the updated item
    let item_sql = "SELECT id, purchase_id, product_id, unit_id, per_price, amount, total, per_unit, cost_price, wholesale_price, retail_price, expiry_date, created_at FROM purchase_items WHERE id = ?";
    let items = db
        .query(item_sql, one_param(id), |row| {
            Ok(PurchaseItem {
                id: row_get(row, 0)?,
                purchase_id: row_get(row, 1)?,
                product_id: row_get(row, 2)?,
                unit_id: row_get(row, 3)?,
                per_price: row_get(row, 4)?,
                amount: row_get(row, 5)?,
                total: row_get(row, 6)?,
                per_unit: row_get(row, 7)?,
                cost_price: row_get(row, 8)?,
                wholesale_price: row_get(row, 9)?,
                retail_price: row_get(row, 10)?,
                expiry_date: row_get(row, 11)?,
                created_at: row_get_string_or_datetime(row, 12)?,
            })
        })
        .map_err(|e| format!("Failed to fetch purchase item: {}", e))?;

    if let Some(item) = items.first() {
        Ok(item.clone())
    } else {
        Err("Failed to retrieve updated purchase item".to_string())
    }
}

/// Delete a purchase item
#[tauri::command]
fn delete_purchase_item(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Get purchase_id before deleting
    let purchase_id_sql = "SELECT purchase_id FROM purchase_items WHERE id = ?";
    let purchase_ids = db
        .query(purchase_id_sql, one_param(id), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to fetch purchase_id: {}", e))?;

    let purchase_id = purchase_ids.first().ok_or("Purchase item not found")?;

    let delete_sql = "DELETE FROM purchase_items WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete purchase item: {}", e))?;

    // Update purchase total (items total + additional_cost)
    let update_purchase_sql = "UPDATE purchases SET total_amount = (SELECT COALESCE(SUM(total), 0) FROM purchase_items WHERE purchase_id = ?) + COALESCE((SELECT additional_cost FROM purchases WHERE id = ?), 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_purchase_sql, (purchase_id, purchase_id, purchase_id))
        .map_err(|e| format!("Failed to update purchase total: {}", e))?;

    Ok("Purchase item deleted successfully".to_string())
}

// Purchase Payment Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PurchasePayment {
    pub id: i64,
    pub purchase_id: i64,
    pub account_id: Option<i64>,
    pub amount: f64,
    pub currency: String,
    pub rate: f64,
    pub total: f64,
    pub date: String,
    pub notes: Option<String>,
    pub created_at: String,
}

/// Initialize purchase payments table (schema from db.sql on first open).
#[tauri::command]
fn init_purchase_payments_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Create a purchase payment
#[tauri::command]
fn create_purchase_payment(
    db_state: State<'_, Mutex<Option<Database>>>,
    purchase_id: i64,
    account_id: Option<i64>,
    amount: f64,
    currency: String,
    rate: f64,
    date: String,
    notes: Option<String>,
) -> Result<PurchasePayment, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let total = amount * rate;
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());

    let insert_sql = "INSERT INTO purchase_payments (purchase_id, account_id, amount, currency, rate, total, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, (
        &purchase_id,
        &account_id,
        &amount,
        &currency,
        &rate,
        &total,
        &date,
        &notes_str,
    ))
        .map_err(|e| format!("Failed to insert purchase payment: {}", e))?;

    // If account_id is provided, withdraw the payment amount from the account
    if let Some(aid) = account_id {
        // Get currency_id from currency name
        let currency_sql = "SELECT id FROM currencies WHERE name = ? LIMIT 1";
        let currency_ids = db
            .query(currency_sql, one_param(currency.as_str()), |row| {
                Ok(row_get::<i64>(row, 0)?)
            })
            .map_err(|e| format!("Failed to find currency: {}", e))?;
        
        if let Some(currency_id) = currency_ids.first() {
            // Check if account has sufficient balance
            let current_balance = get_account_balance_by_currency_internal(db, aid, *currency_id)
                .unwrap_or(0.0);
            
            if current_balance < amount {
                return Err(format!("Insufficient balance in account. Available: {}, Required: {}", current_balance, amount));
            }
            
            // Create account transaction record for this payment (withdrawal)
            let payment_notes = notes.as_ref().map(|_s| format!("Payment for Purchase #{}", purchase_id));
            let payment_notes_str: Option<&str> = payment_notes.as_ref().map(|s| s.as_str());
            let is_full_int = 0i64;
            
            let insert_transaction_sql = "INSERT INTO account_transactions (account_id, transaction_type, amount, currency, rate, total, transaction_date, is_full, notes) VALUES (?, 'withdraw', ?, ?, ?, ?, ?, ?, ?)";
            db.execute(insert_transaction_sql, (
                &aid,
                &amount,
                &currency,
                &rate,
                &total,
                &date,
                &is_full_int,
                &payment_notes_str,
            ))
            .map_err(|e| format!("Failed to create account transaction: {}", e))?;
            
            // Subtract the payment amount from the balance
            let new_balance = current_balance - amount;
            
            // Update account currency balance
            update_account_currency_balance_internal(db, aid, *currency_id, new_balance)?;
            
            // Update account's current_balance
            let new_account_balance = calculate_account_balance_internal(db, aid)?;
            let update_balance_sql = "UPDATE accounts SET current_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
            db.execute(update_balance_sql, (
                &new_account_balance,
                &aid,
            ))
            .map_err(|e| format!("Failed to update account balance: {}", e))?;
        }
    }

    // Get the created payment
    let payment_sql = "SELECT id, purchase_id, account_id, amount, currency, rate, total, date, notes, created_at FROM purchase_payments WHERE purchase_id = ? ORDER BY id DESC LIMIT 1";
    let payments = db
        .query(payment_sql, one_param(purchase_id), |row| {
            Ok(PurchasePayment {
                id: row_get(row, 0)?,
                purchase_id: row_get(row, 1)?,
                account_id: row_get(row, 2)?,
                amount: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                total: row_get(row, 6)?,
                date: row_get(row, 7)?,
                notes: row_get(row, 8)?,
                created_at: row_get_string_or_datetime(row, 9)?,
            })
        })
        .map_err(|e| format!("Failed to fetch purchase payment: {}", e))?;

    if let Some(payment) = payments.first() {
        Ok(payment.clone())
    } else {
        Err("Failed to retrieve created purchase payment".to_string())
    }
}

/// Get all purchase payments with pagination
#[tauri::command]
fn get_purchase_payments(
    db_state: State<'_, Mutex<Option<Database>>>,
    page: i64,
    per_page: i64,
    search: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
) -> Result<PaginatedResponse<PurchasePayment>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let offset = (page - 1) * per_page;

    // Build WHERE clause
    let mut where_clause = String::new();
    let mut params: Vec<serde_json::Value> = Vec::new();

    if let Some(s) = search {
        if !s.trim().is_empty() {
            let search_term = format!("%{}%", s);
            where_clause = "WHERE (currency LIKE ? OR notes LIKE ? OR CAST(amount AS TEXT) LIKE ?)".to_string();
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term));
        }
    }

    // Get total count
    let count_sql = format!("SELECT COUNT(*) FROM purchase_payments {}", where_clause);
    let mysql_count_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let count_results: Vec<i64> = db.query(&count_sql, mysql_count_params.clone(), |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to count purchase payments: {}", e))?;
    let total: i64 = count_results.first().copied().unwrap_or(0);

    // Build Order By
    let order_clause = if let Some(sort) = sort_by {
        let order = sort_order.unwrap_or_else(|| "ASC".to_string());
        let allowed_cols = ["amount", "total", "rate", "currency", "date", "created_at"];
        if allowed_cols.contains(&sort.as_str()) {
            format!("ORDER BY {} {}", sort, if order.to_uppercase() == "DESC" { "DESC" } else { "ASC" })
        } else {
            "ORDER BY date DESC, created_at DESC".to_string()
        }
    } else {
        "ORDER BY date DESC, created_at DESC".to_string()
    };

    // Get paginated payments
    let sql = format!("SELECT id, purchase_id, account_id, amount, currency, rate, total, date, notes, created_at FROM purchase_payments {} {} LIMIT ? OFFSET ?", where_clause, order_clause);
    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));
    let mysql_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let payments = db.query(&sql, mysql_params, |row| {
        Ok(PurchasePayment {
            id: row_get(row, 0)?,
            purchase_id: row_get(row, 1)?,
            account_id: row_get(row, 2)?,
            amount: row_get(row, 3)?,
            currency: row_get(row, 4)?,
            rate: row_get(row, 5)?,
            total: row_get(row, 6)?,
            date: row_get(row, 7)?,
            notes: row_get(row, 8)?,
            created_at: row_get_string_or_datetime(row, 9)?,
        })
    }).map_err(|e| format!("Failed to fetch purchase payments: {}", e))?;

    let total_pages = (total as f64 / per_page as f64).ceil() as i64;

    Ok(PaginatedResponse {
        items: payments,
        total,
        page,
        per_page,
        total_pages,
    })
}

/// Get payments for a purchase
#[tauri::command]
fn get_purchase_payments_by_purchase(db_state: State<'_, Mutex<Option<Database>>>, purchase_id: i64) -> Result<Vec<PurchasePayment>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, purchase_id, account_id, amount, currency, rate, total, date, notes, created_at FROM purchase_payments WHERE purchase_id = ? ORDER BY date DESC, created_at DESC";
    let payments = db
        .query(sql, one_param(purchase_id), |row| {
            Ok(PurchasePayment {
                id: row_get(row, 0)?,
                purchase_id: row_get(row, 1)?,
                account_id: row_get(row, 2)?,
                amount: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                total: row_get(row, 6)?,
                date: row_get(row, 7)?,
                notes: row_get(row, 8)?,
                created_at: row_get_string_or_datetime(row, 9)?,
            })
        })
        .map_err(|e| format!("Failed to fetch purchase payments: {}", e))?;

    Ok(payments)
}

/// Update a purchase payment
#[tauri::command]
fn update_purchase_payment(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    amount: f64,
    currency: String,
    rate: f64,
    date: String,
    notes: Option<String>,
) -> Result<PurchasePayment, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let total = amount * rate;
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());

    let update_sql = "UPDATE purchase_payments SET amount = ?, currency = ?, rate = ?, total = ?, date = ?, notes = ? WHERE id = ?";
    db.execute(update_sql, (
        &amount,
        &currency,
        &rate,
        &total,
        &date,
        &notes_str,
        &id,
    ))
        .map_err(|e| format!("Failed to update purchase payment: {}", e))?;

    // Get the updated payment
    let payment_sql = "SELECT id, purchase_id, account_id, amount, currency, rate, total, date, notes, created_at FROM purchase_payments WHERE id = ?";
    let payments = db
        .query(payment_sql, one_param(id), |row| {
            Ok(PurchasePayment {
                id: row_get(row, 0)?,
                purchase_id: row_get(row, 1)?,
                account_id: row_get(row, 2)?,
                amount: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                total: row_get(row, 6)?,
                date: row_get(row, 7)?,
                notes: row_get(row, 8)?,
                created_at: row_get_string_or_datetime(row, 9)?,
            })
        })
        .map_err(|e| format!("Failed to fetch purchase payment: {}", e))?;

    if let Some(payment) = payments.first() {
        Ok(payment.clone())
    } else {
        Err("Failed to retrieve updated purchase payment".to_string())
    }
}

/// Delete a purchase payment
#[tauri::command]
fn delete_purchase_payment(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM purchase_payments WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete purchase payment: {}", e))?;

    Ok("Purchase payment deleted successfully".to_string())
}

// Sale Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sale {
    pub id: i64,
    pub customer_id: i64,
    pub date: String,
    pub notes: Option<String>,
    pub currency_id: Option<i64>,
    pub exchange_rate: f64,
    pub total_amount: f64,
    pub base_amount: f64,
    pub paid_amount: f64,
    pub additional_cost: f64,
    pub order_discount_type: Option<String>,
    pub order_discount_value: f64,
    pub order_discount_amount: f64,
    pub discount_code_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

// SaleItem Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleItem {
    pub id: i64,
    pub sale_id: i64,
    pub product_id: i64,
    pub unit_id: i64,
    pub per_price: f64,
    pub amount: f64,
    pub total: f64,
    pub purchase_item_id: Option<i64>,
    pub sale_type: Option<String>,
    pub discount_type: Option<String>,
    pub discount_value: f64,
    pub created_at: String,
}

// ProductBatch Model (for batch information)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductBatch {
    pub purchase_item_id: i64,
    pub purchase_id: i64,
    pub batch_number: Option<String>,
    pub purchase_date: String,
    pub expiry_date: Option<String>,
    pub per_price: f64,
    pub per_unit: Option<f64>,
    pub wholesale_price: Option<f64>,
    pub retail_price: Option<f64>,
    pub amount: f64,
    pub remaining_quantity: f64,
}

/// Product-level stock (computed from batches in base units, optionally in a specific unit).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProductStock {
    pub product_id: i64,
    pub total_base: f64,
    pub total_in_unit: Option<f64>,
}

/// One row for stock report: batch with product info, remaining quantity, prices and profit.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StockBatchRow {
    pub product_id: i64,
    pub product_name: String,
    pub purchase_item_id: i64,
    pub purchase_id: i64,
    pub batch_number: Option<String>,
    pub purchase_date: String,
    pub expiry_date: Option<String>,
    pub unit_name: String,
    pub amount: f64,
    pub remaining_quantity: f64,
    pub per_price: f64,
    /// Total purchase cost of batch (amount * per_price).
    pub total_purchase_cost: f64,
    pub cost_price: f64,
    pub retail_price: Option<f64>,
    pub wholesale_price: Option<f64>,
    pub stock_value: f64,
    pub potential_revenue_retail: f64,
    pub potential_profit: f64,
    pub margin_percent: f64,
}

// SalePayment Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SalePayment {
    pub id: i64,
    pub sale_id: i64,
    pub account_id: Option<i64>,
    pub currency_id: Option<i64>,
    pub exchange_rate: f64,
    pub amount: f64,
    pub base_amount: f64,
    pub date: String,
    pub created_at: String,
}

// SaleAdditionalCost Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleAdditionalCost {
    pub id: i64,
    pub sale_id: i64,
    pub name: String,
    pub amount: f64,
    pub created_at: String,
}

/// Initialize sales table (schema from db.sql on first open).
#[tauri::command]
fn init_sales_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;
    // Migration: add discount columns for existing DBs
    let _ = db.execute("ALTER TABLE sales ADD COLUMN order_discount_type TEXT", ());
    let _ = db.execute("ALTER TABLE sales ADD COLUMN order_discount_value DOUBLE NOT NULL DEFAULT 0", ());
    let _ = db.execute("ALTER TABLE sales ADD COLUMN order_discount_amount DOUBLE NOT NULL DEFAULT 0", ());
    let _ = db.execute("ALTER TABLE sales ADD COLUMN discount_code_id BIGINT", ());
    let _ = db.execute("ALTER TABLE sale_items ADD COLUMN discount_type TEXT", ());
    let _ = db.execute("ALTER TABLE sale_items ADD COLUMN discount_value DOUBLE NOT NULL DEFAULT 0", ());
    let _ = db.execute("ALTER TABLE sale_service_items ADD COLUMN discount_type TEXT", ());
    let _ = db.execute("ALTER TABLE sale_service_items ADD COLUMN discount_value DOUBLE NOT NULL DEFAULT 0", ());
    Ok("OK".to_string())
}

/// Round to 2 decimal places.
fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

/// Round to 6 decimal places (for stock quantities).
fn round6(x: f64) -> f64 {
    (x * 1_000_000.0).round() / 1_000_000.0
}

/// Get unit ratio for conversion to base units. Base unit has ratio 1; others have ratio = base units per 1 of this unit. Returns 1.0 if unit not found or ratio is null.
fn get_unit_ratio(db: &Database, unit_id: i64) -> Result<f64, String> {
    let rows = db
        .query("SELECT COALESCE(ratio, 1) FROM units WHERE id = ?", one_param(unit_id), |row| {
            Ok(row_get::<f64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to get unit ratio: {}", e))?;
    Ok(rows.first().copied().unwrap_or(1.0))
}

/// Convert amount in given unit to base units (amount * ratio). Used for stock aggregation and validation.
fn amount_to_base(db: &Database, amount: f64, unit_id: i64) -> Result<f64, String> {
    let ratio = get_unit_ratio(db, unit_id)?;
    Ok(amount * ratio)
}

/// Get remaining quantity for a batch in base units (for validation). Returns pi_base - sold_base.
fn get_batch_remaining_base(db: &Database, purchase_item_id: i64) -> Result<f64, String> {
    let pi_row = db
        .query(
            "SELECT pi.amount, pi.unit_id FROM purchase_items pi WHERE pi.id = ?",
            one_param(purchase_item_id),
            |row| Ok((row_get::<f64>(row, 0)?, row_get::<i64>(row, 1)?)),
        )
        .map_err(|e| format!("Failed to get purchase item: {}", e))?;
    let (pi_amount, pi_unit_id) = pi_row.first().ok_or("Purchase item not found")?;
    let pi_base = amount_to_base(db, *pi_amount, *pi_unit_id)?;
    let sold: Vec<f64> = db
        .query(
            "SELECT si.amount, si.unit_id FROM sale_items si WHERE si.purchase_item_id = ?",
            one_param(purchase_item_id),
            |row| Ok((row_get::<f64>(row, 0)?, row_get::<i64>(row, 1)?)),
        )
        .map_err(|e| format!("Failed to get sale items: {}", e))?
        .into_iter()
        .map(|(amt, uid)| amount_to_base(db, amt, uid).unwrap_or(0.0))
        .collect();
    let sold_base: f64 = sold.iter().sum();
    Ok(round6((pi_base - sold_base).max(0.0)))
}

/// Compute line or order discount amount. type_ = "percent" | "fixed", value = percent 0-100 or fixed amount.
fn compute_discount_amount(subtotal: f64, discount_type: Option<&String>, discount_value: f64) -> f64 {
    if subtotal <= 0.0 {
        return 0.0;
    }
    let typ = discount_type.as_ref().map(|s| s.as_str());
    match typ {
        Some("percent") => {
            let pct = discount_value.clamp(0.0, 100.0);
            round2(subtotal * pct / 100.0)
        }
        Some("fixed") => round2(discount_value.min(subtotal).max(0.0)),
        _ => 0.0,
    }
}

/// Create a new sale with items and optional service items
#[tauri::command]
fn create_sale(
    db_state: State<'_, Mutex<Option<Database>>>,
    customer_id: i64,
    date: String,
    notes: Option<String>,
    currency_id: Option<i64>,
    exchange_rate: f64,
    paid_amount: f64,
    additional_costs: Vec<(String, f64)>, // (name, amount)
    items: Vec<(i64, i64, f64, f64, Option<i64>, Option<String>, Option<String>, f64)>, // (product_id, unit_id, per_price, amount, purchase_item_id, sale_type, discount_type, discount_value)
    service_items: Vec<(i64, String, f64, f64, Option<String>, f64)>, // (service_id, name, price, quantity, discount_type, discount_value)
    order_discount_type: Option<String>,
    order_discount_value: f64,
) -> Result<Sale, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    if items.is_empty() && service_items.is_empty() {
        return Err("Sale must have at least one product item or service item".to_string());
    }

    // Compute line totals with line-level discount
    let mut items_line_totals: Vec<f64> = Vec::with_capacity(items.len());
    for (_, _, per_price, amount, _, _, discount_type, discount_value) in &items {
        let line_subtotal = per_price * amount;
        let disc = compute_discount_amount(line_subtotal, discount_type.as_ref(), *discount_value);
        items_line_totals.push(round2(line_subtotal - disc));
    }
    let mut service_line_totals: Vec<f64> = Vec::with_capacity(service_items.len());
    for (_, _, price, qty, discount_type, discount_value) in &service_items {
        let line_subtotal = price * qty;
        let disc = compute_discount_amount(line_subtotal, discount_type.as_ref(), *discount_value);
        service_line_totals.push(round2(line_subtotal - disc));
    }

    let subtotal: f64 = round2(items_line_totals.iter().sum::<f64>() + service_line_totals.iter().sum::<f64>());
    let order_discount_amount = compute_discount_amount(subtotal, order_discount_type.as_ref(), order_discount_value);
    let additional_costs_total: f64 = additional_costs.iter().map(|(_, amount)| amount).sum();
    let total_amount = round2(subtotal - order_discount_amount + additional_costs_total);
    let base_amount = total_amount * exchange_rate;

    // Insert sale with discount columns
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    let insert_sql = "INSERT INTO sales (customer_id, date, notes, currency_id, exchange_rate, total_amount, base_amount, paid_amount, additional_cost, order_discount_type, order_discount_value, order_discount_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, (
        &customer_id,
        &date,
        &notes_str,
        &currency_id,
        &exchange_rate,
        &total_amount,
        &base_amount,
        &paid_amount,
        &additional_costs_total,
        &order_discount_type,
        &order_discount_value,
        &order_discount_amount,
    ))
        .map_err(|e| format!("Failed to insert sale: {}", e))?;

    // Get the created sale ID
    let sale_id_sql = "SELECT id FROM sales WHERE customer_id = ? AND date = ? ORDER BY id DESC LIMIT 1";
    let sale_ids = db
        .query(sale_id_sql, (customer_id, date.as_str()), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to fetch sale ID: {}", e))?;

    let sale_id = sale_ids.first().ok_or("Failed to retrieve sale ID")?;

    // Get base currency ID (first currency marked as base, or first currency)
    let base_currency_sql = "SELECT id FROM currencies WHERE base = 1 LIMIT 1";
    let base_currencies = db.query(base_currency_sql, (), |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to get base currency: {}", e))?;
    let base_currency_id = base_currencies.first().copied().unwrap_or_else(|| {
        // Fallback to first currency if no base currency set
        db.query("SELECT id FROM currencies LIMIT 1", (), |row| Ok(row_get::<i64>(row, 0)?))
            .ok()
            .and_then(|v| v.first().copied())
            .unwrap_or(1)
    });

    // Create journal entry for sale: Debit Accounts Receivable, Credit Sales Revenue
    let ar_account_sql = "SELECT id FROM accounts WHERE account_type = 'Asset' AND name LIKE '%Receivable%' LIMIT 1";
    let ar_accounts = db.query(ar_account_sql, (), |row| Ok(row_get::<i64>(row, 0)?))
        .ok()
        .and_then(|v| v.first().copied());
    
    let revenue_account_sql = "SELECT id FROM accounts WHERE account_type = 'Revenue' LIMIT 1";
    let revenue_accounts = db.query(revenue_account_sql, (), |row| Ok(row_get::<i64>(row, 0)?))
        .ok()
        .and_then(|v| v.first().copied());

    if let (Some(ar_account), Some(revenue_account)) = (ar_accounts, revenue_accounts) {
        let sale_currency_id = currency_id.unwrap_or(base_currency_id);
        let journal_lines = vec![
            (ar_account, sale_currency_id, base_amount, 0.0, exchange_rate, Some(format!("Sale #{}", sale_id))),
            (revenue_account, sale_currency_id, 0.0, base_amount, exchange_rate, Some(format!("Sale #{}", sale_id))),
        ];
        let _ = create_journal_entry_internal(db, &date, notes.clone(), Some("sale".to_string()), Some(*sale_id), journal_lines);
    }

    // Insert initial payment if paid_amount > 0
    if paid_amount > 0.0 {
        let payment_currency_id = currency_id.unwrap_or(base_currency_id);
        let payment_base_amount = paid_amount * exchange_rate;
        let insert_payment_sql = "INSERT INTO sale_payments (sale_id, currency_id, exchange_rate, amount, base_amount, date) VALUES (?, ?, ?, ?, ?, ?)";
        db.execute(insert_payment_sql, (
            sale_id,
            &payment_currency_id,
            &exchange_rate,
            &paid_amount,
            &payment_base_amount,
            &date,
        ))
            .map_err(|e| format!("Failed to insert initial payment: {}", e))?;
    }

    // Validate batch stock for each sale item (unit-precise)
    let mut batch_used_base: HashMap<i64, f64> = HashMap::new();
    for (product_id, unit_id, per_price, amount, purchase_item_id, sale_type, discount_type, discount_value) in &items {
        if let Some(pid) = purchase_item_id {
            let remaining_base = get_batch_remaining_base(db, *pid)?;
            let used_so_far = batch_used_base.get(pid).copied().unwrap_or(0.0);
            let this_base = amount_to_base(db, *amount, *unit_id)?;
            if used_so_far + this_base > remaining_base + 1e-9 {
                return Err("موجودی دسته کافی نیست (Insufficient batch stock)".to_string());
            }
            batch_used_base.insert(*pid, used_so_far + this_base);
        }
    }

    // Insert sale items (with discount_type, discount_value, total = line total after discount)
    for (idx, (product_id, unit_id, per_price, amount, purchase_item_id, sale_type, discount_type, discount_value)) in items.into_iter().enumerate() {
        let total = *items_line_totals.get(idx).unwrap_or(&(per_price * amount));
        let insert_item_sql = "INSERT INTO sale_items (sale_id, product_id, unit_id, per_price, amount, total, purchase_item_id, sale_type, discount_type, discount_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        db.execute(insert_item_sql, (
            sale_id,
            &product_id,
            &unit_id,
            &per_price,
            &amount,
            &total,
            &purchase_item_id,
            &sale_type,
            &discount_type,
            &discount_value,
        ))
            .map_err(|e| format!("Failed to insert sale item: {}", e))?;
    }

    // Insert sale service items (with discount_type, discount_value)
    for (idx, (service_id, name, price, quantity, discount_type, discount_value)) in service_items.into_iter().enumerate() {
        let total = *service_line_totals.get(idx).unwrap_or(&(price * quantity));
        let insert_ssi_sql = "INSERT INTO sale_service_items (sale_id, service_id, name, price, quantity, total, discount_type, discount_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
        db.execute(insert_ssi_sql, (
            sale_id,
            &service_id,
            &name,
            &price,
            &quantity,
            &total,
            &discount_type,
            &discount_value,
        ))
            .map_err(|e| format!("Failed to insert sale service item: {}", e))?;
    }

    // Insert additional costs
    for (name, amount) in additional_costs {
        let insert_cost_sql = "INSERT INTO sale_additional_costs (sale_id, name, amount) VALUES (?, ?, ?)";
        db.execute(insert_cost_sql, (
            sale_id,
            &name,
            &amount,
        ))
            .map_err(|e| format!("Failed to insert sale additional cost: {}", e))?;
    }

    // Get the created sale (with new columns)
    let sale_sql = "SELECT id, customer_id, date, notes, currency_id, exchange_rate, total_amount, base_amount, paid_amount, additional_cost, order_discount_type, order_discount_value, order_discount_amount, discount_code_id, created_at, updated_at FROM sales WHERE id = ?";
    let sales = db
        .query(sale_sql, one_param(sale_id), |row| {
            Ok(Sale {
                id: row_get(row, 0)?,
                customer_id: row_get(row, 1)?,
                date: row_get(row, 2)?,
                notes: row_get(row, 3)?,
                currency_id: row_get(row, 4)?,
                exchange_rate: row_get(row, 5)?,
                total_amount: row_get(row, 6)?,
                base_amount: row_get(row, 7)?,
                paid_amount: row_get(row, 8)?,
                additional_cost: row_get(row, 9)?,
                order_discount_type: row_get(row, 10)?,
                order_discount_value: row_get(row, 11)?,
                order_discount_amount: row_get(row, 12)?,
                discount_code_id: row_get(row, 13)?,
                created_at: row_get_string_or_datetime(row, 14)?,
                updated_at: row_get_string_or_datetime(row, 15)?,
            })
        })
        .map_err(|e| format!("Failed to fetch sale: {}", e))?;

    if let Some(sale) = sales.first() {
        Ok(sale.clone())
    } else {
        Err("Failed to retrieve created sale".to_string())
    }
}

/// Get all sales with pagination
#[tauri::command]
fn get_sales(
    db_state: State<'_, Mutex<Option<Database>>>,
    page: i64,
    per_page: i64,
    search: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
) -> Result<PaginatedResponse<Sale>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let offset = (page - 1) * per_page;

    // Build WHERE clause
    let mut where_clause = String::new();
    let mut params: Vec<serde_json::Value> = Vec::new();

    if let Some(s) = search {
        if !s.trim().is_empty() {
            let search_term = format!("%{}%", s);
            // MySQL doesn't support CAST(... AS TEXT) (SQLite-ism). Use CHAR for LIKE searches.
            where_clause = "WHERE (CAST(s.date AS CHAR) LIKE ? OR s.notes LIKE ? OR s.customer_id IN (SELECT id FROM customers WHERE full_name LIKE ? OR phone LIKE ?))".to_string();
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term));
        }
    }

    // Get total count
    let count_sql = format!("SELECT COUNT(*) FROM sales s {}", where_clause);
    let mysql_count_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let count_results: Vec<i64> = db.query(&count_sql, mysql_count_params.clone(), |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to count sales: {}", e))?;
    let total: i64 = count_results.first().copied().unwrap_or(0);

    // Build Order By
    let order_clause = if let Some(sort) = sort_by {
        let order = sort_order.unwrap_or_else(|| "DESC".to_string());
        let allowed_cols = ["date", "total_amount", "paid_amount", "created_at"];
        if allowed_cols.contains(&sort.as_str()) {
            format!("ORDER BY s.{} {}", sort, if order.to_uppercase() == "DESC" { "DESC" } else { "ASC" })
        } else {
            "ORDER BY s.date DESC, s.created_at DESC".to_string()
        }
    } else {
        "ORDER BY s.date DESC, s.created_at DESC".to_string()
    };

    let sql = format!("SELECT s.id, s.customer_id, s.date, s.notes, s.currency_id, s.exchange_rate, s.total_amount, s.base_amount, s.paid_amount, s.additional_cost, s.order_discount_type, s.order_discount_value, s.order_discount_amount, s.discount_code_id, s.created_at, s.updated_at FROM sales s {} {} LIMIT ? OFFSET ?", where_clause, order_clause);
    
    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));

    let mysql_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let sales = db.query(&sql, mysql_params, |row| {
        Ok(Sale {
            id: row_get(row, 0)?,
            customer_id: row_get(row, 1)?,
            date: row_get(row, 2)?,
            notes: row_get::<Option<String>>(row, 3)?,
            currency_id: row_get(row, 4)?,
            exchange_rate: row_get(row, 5)?,
            total_amount: row_get(row, 6)?,
            base_amount: row_get(row, 7)?,
            paid_amount: row_get(row, 8)?,
            additional_cost: row_get(row, 9)?,
            order_discount_type: row_get(row, 10)?,
            order_discount_value: row_get(row, 11)?,
            order_discount_amount: row_get(row, 12)?,
            discount_code_id: row_get(row, 13)?,
            created_at: row_get_string_or_datetime(row, 14)?,
            updated_at: row_get_string_or_datetime(row, 15)?,
        })
    }).map_err(|e| format!("Failed to fetch sales: {}", e))?;

    let total_pages = (total as f64 / per_page as f64).ceil() as i64;
    
    Ok(PaginatedResponse {
        items: sales,
        total,
        page,
        per_page,
        total_pages,
    })
}

/// Get a single sale with its items and service items
#[tauri::command]
fn get_sale(db_state: State<'_, Mutex<Option<Database>>>, id: i64) -> Result<(Sale, Vec<SaleItem>, Vec<SaleServiceItem>), String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Get sale (with discount columns)
    let sale_sql = "SELECT id, customer_id, date, notes, currency_id, exchange_rate, total_amount, base_amount, paid_amount, additional_cost, order_discount_type, order_discount_value, order_discount_amount, discount_code_id, created_at, updated_at FROM sales WHERE id = ?";
    let sales = db
        .query(sale_sql, one_param(id), |row| {
            Ok(Sale {
                id: row_get(row, 0)?,
                customer_id: row_get(row, 1)?,
                date: row_get(row, 2)?,
                notes: row_get(row, 3)?,
                currency_id: row_get(row, 4)?,
                exchange_rate: row_get(row, 5)?,
                total_amount: row_get(row, 6)?,
                base_amount: row_get(row, 7)?,
                paid_amount: row_get(row, 8)?,
                additional_cost: row_get(row, 9)?,
                order_discount_type: row_get(row, 10)?,
                order_discount_value: row_get(row, 11)?,
                order_discount_amount: row_get(row, 12)?,
                discount_code_id: row_get(row, 13)?,
                created_at: row_get_string_or_datetime(row, 14)?,
                updated_at: row_get_string_or_datetime(row, 15)?,
            })
        })
        .map_err(|e| format!("Failed to fetch sale: {}", e))?;

    let sale = sales.first().ok_or("Sale not found")?;

    // Get sale items (with discount columns)
    let items_sql = "SELECT id, sale_id, product_id, unit_id, per_price, amount, total, purchase_item_id, sale_type, discount_type, discount_value, created_at FROM sale_items WHERE sale_id = ?";
    let items = db
        .query(items_sql, one_param(id), |row| {
            Ok(SaleItem {
                id: row_get(row, 0)?,
                sale_id: row_get(row, 1)?,
                product_id: row_get(row, 2)?,
                unit_id: row_get(row, 3)?,
                per_price: row_get(row, 4)?,
                amount: row_get(row, 5)?,
                total: row_get(row, 6)?,
                purchase_item_id: row_get(row, 7)?,
                sale_type: row_get(row, 8)?,
                discount_type: row_get(row, 9)?,
                discount_value: row_get(row, 10)?,
                created_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch sale items: {}", e))?;

    // Get sale service items (with discount columns)
    let ssi_sql = "SELECT id, sale_id, service_id, name, price, quantity, total, discount_type, discount_value, created_at FROM sale_service_items WHERE sale_id = ? ORDER BY id";
    let service_items = db
        .query(ssi_sql, one_param(id), |row| {
            Ok(SaleServiceItem {
                id: row_get(row, 0)?,
                sale_id: row_get(row, 1)?,
                service_id: row_get(row, 2)?,
                name: row_get(row, 3)?,
                price: row_get(row, 4)?,
                quantity: row_get(row, 5)?,
                total: row_get(row, 6)?,
                discount_type: row_get(row, 7)?,
                discount_value: row_get(row, 8)?,
                created_at: row_get_string_or_datetime(row, 9)?,
            })
        })
        .map_err(|e| format!("Failed to fetch sale service items: {}", e))?;

    Ok((sale.clone(), items, service_items))
}

/// Get sale additional costs
#[tauri::command]
fn get_sale_additional_costs(db_state: State<'_, Mutex<Option<Database>>>, sale_id: i64) -> Result<Vec<SaleAdditionalCost>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, sale_id, name, amount, created_at FROM sale_additional_costs WHERE sale_id = ? ORDER BY id";
    let costs = db
        .query(sql, one_param(sale_id), |row| {
            Ok(SaleAdditionalCost {
                id: row_get(row, 0)?,
                sale_id: row_get(row, 1)?,
                name: row_get(row, 2)?,
                amount: row_get(row, 3)?,
                created_at: row_get_string_or_datetime(row, 4)?,
            })
        })
        .map_err(|e| format!("Failed to fetch sale additional costs: {}", e))?;

    Ok(costs)
}

/// Update a sale
#[tauri::command]
fn update_sale(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    customer_id: i64,
    date: String,
    notes: Option<String>,
    currency_id: Option<i64>,
    exchange_rate: f64,
    _paid_amount: f64, // Ignored, handled by payments table
    additional_costs: Vec<(String, f64)>, // (name, amount)
    items: Vec<(i64, i64, f64, f64, Option<i64>, Option<String>, Option<String>, f64)>, // (product_id, unit_id, per_price, amount, purchase_item_id, sale_type, discount_type, discount_value)
    service_items: Vec<(i64, String, f64, f64, Option<String>, f64)>, // (service_id, name, price, quantity, discount_type, discount_value)
    order_discount_type: Option<String>,
    order_discount_value: f64,
) -> Result<Sale, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    if items.is_empty() && service_items.is_empty() {
        return Err("Sale must have at least one product item or service item".to_string());
    }

    // Compute line totals with line-level discount
    let mut items_line_totals: Vec<f64> = Vec::with_capacity(items.len());
    for (_, _, per_price, amount, _, _, discount_type, discount_value) in &items {
        let line_subtotal = per_price * amount;
        let disc = compute_discount_amount(line_subtotal, discount_type.as_ref(), *discount_value);
        items_line_totals.push(round2(line_subtotal - disc));
    }
    let mut service_line_totals: Vec<f64> = Vec::with_capacity(service_items.len());
    for (_, _, price, qty, discount_type, discount_value) in &service_items {
        let line_subtotal = price * qty;
        let disc = compute_discount_amount(line_subtotal, discount_type.as_ref(), *discount_value);
        service_line_totals.push(round2(line_subtotal - disc));
    }

    let subtotal: f64 = round2(items_line_totals.iter().sum::<f64>() + service_line_totals.iter().sum::<f64>());
    let order_discount_amount = compute_discount_amount(subtotal, order_discount_type.as_ref(), order_discount_value);
    let additional_costs_total: f64 = additional_costs.iter().map(|(_, amount)| amount).sum();
    let total_amount = round2(subtotal - order_discount_amount + additional_costs_total);
    let base_amount = total_amount * exchange_rate;

    // Update sale (with discount columns)
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    let update_sql = "UPDATE sales SET customer_id = ?, date = ?, notes = ?, currency_id = ?, exchange_rate = ?, total_amount = ?, base_amount = ?, additional_cost = ?, order_discount_type = ?, order_discount_value = ?, order_discount_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sql, (
        &customer_id,
        &date,
        &notes_str,
        &currency_id,
        &exchange_rate,
        &total_amount,
        &base_amount,
        &additional_costs_total,
        &order_discount_type,
        &order_discount_value,
        &order_discount_amount,
        &id,
    ))
        .map_err(|e| format!("Failed to update sale: {}", e))?;

    // Delete existing items
    let delete_items_sql = "DELETE FROM sale_items WHERE sale_id = ?";
    db.execute(delete_items_sql, one_param(id))
        .map_err(|e| format!("Failed to delete sale items: {}", e))?;

    // Insert new items (with discount)
    for (idx, (product_id, unit_id, per_price, amount, purchase_item_id, sale_type, discount_type, discount_value)) in items.into_iter().enumerate() {
        let total = *items_line_totals.get(idx).unwrap_or(&(per_price * amount));
        let insert_item_sql = "INSERT INTO sale_items (sale_id, product_id, unit_id, per_price, amount, total, purchase_item_id, sale_type, discount_type, discount_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        db.execute(insert_item_sql, (
            &id,
            &product_id,
            &unit_id,
            &per_price,
            &amount,
            &total,
            &purchase_item_id,
            &sale_type,
            &discount_type,
            &discount_value,
        ))
            .map_err(|e| format!("Failed to insert sale item: {}", e))?;
    }

    // Delete existing sale service items and insert new ones
    let delete_ssi_sql = "DELETE FROM sale_service_items WHERE sale_id = ?";
    db.execute(delete_ssi_sql, one_param(id))
        .map_err(|e| format!("Failed to delete sale service items: {}", e))?;

    for (idx, (service_id, name, price, quantity, discount_type, discount_value)) in service_items.into_iter().enumerate() {
        let total = *service_line_totals.get(idx).unwrap_or(&(price * quantity));
        let insert_ssi_sql = "INSERT INTO sale_service_items (sale_id, service_id, name, price, quantity, total, discount_type, discount_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
        db.execute(insert_ssi_sql, (
            &id,
            &service_id,
            &name,
            &price,
            &quantity,
            &total,
            &discount_type,
            &discount_value,
        ))
            .map_err(|e| format!("Failed to insert sale service item: {}", e))?;
    }

    // Delete existing additional costs
    let delete_costs_sql = "DELETE FROM sale_additional_costs WHERE sale_id = ?";
    db.execute(delete_costs_sql, one_param(id))
        .map_err(|e| format!("Failed to delete sale additional costs: {}", e))?;

    // Insert new additional costs
    for (name, amount) in additional_costs {
        let insert_cost_sql = "INSERT INTO sale_additional_costs (sale_id, name, amount) VALUES (?, ?, ?)";
        db.execute(insert_cost_sql, (
            &id,
            &name,
            &amount,
        ))
            .map_err(|e| format!("Failed to insert sale additional cost: {}", e))?;
    }

    // Get the updated sale (with new columns)
    let sale_sql = "SELECT id, customer_id, date, notes, currency_id, exchange_rate, total_amount, base_amount, paid_amount, additional_cost, order_discount_type, order_discount_value, order_discount_amount, discount_code_id, created_at, updated_at FROM sales WHERE id = ?";
    let sales = db
        .query(sale_sql, one_param(id), |row| {
            Ok(Sale {
                id: row_get(row, 0)?,
                customer_id: row_get(row, 1)?,
                date: row_get(row, 2)?,
                notes: row_get(row, 3)?,
                currency_id: row_get(row, 4)?,
                exchange_rate: row_get(row, 5)?,
                total_amount: row_get(row, 6)?,
                base_amount: row_get(row, 7)?,
                paid_amount: row_get(row, 8)?,
                additional_cost: row_get(row, 9)?,
                order_discount_type: row_get(row, 10)?,
                order_discount_value: row_get(row, 11)?,
                order_discount_amount: row_get(row, 12)?,
                discount_code_id: row_get(row, 13)?,
                created_at: row_get_string_or_datetime(row, 14)?,
                updated_at: row_get_string_or_datetime(row, 15)?,
            })
        })
        .map_err(|e| format!("Failed to fetch sale: {}", e))?;

    if let Some(sale) = sales.first() {
        Ok(sale.clone())
    } else {
        Err("Failed to retrieve updated sale".to_string())
    }
}

/// Delete a sale (items will be deleted automatically due to CASCADE)
#[tauri::command]
fn delete_sale(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM sales WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete sale: {}", e))?;

    Ok("Sale deleted successfully".to_string())
}

/// Create a sale item (standalone, for adding items to existing sale)
#[tauri::command]
fn create_sale_item(
    db_state: State<'_, Mutex<Option<Database>>>,
    sale_id: i64,
    product_id: i64,
    unit_id: i64,
    per_price: f64,
    amount: f64,
    purchase_item_id: Option<i64>,
    sale_type: Option<String>,
    discount_type: Option<String>,
    discount_value: f64,
) -> Result<SaleItem, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    if let Some(pid) = purchase_item_id {
        let sale_amount_base = amount_to_base(db, amount, unit_id)?;
        let remaining_base = get_batch_remaining_base(db, pid)?;
        if sale_amount_base > remaining_base + 1e-9 {
            return Err("موجودی دسته کافی نیست (Insufficient batch stock)".to_string());
        }
    }

    let line_subtotal = per_price * amount;
    let disc = compute_discount_amount(line_subtotal, discount_type.as_ref(), discount_value);
    let total = round2(line_subtotal - disc);

    let insert_sql = "INSERT INTO sale_items (sale_id, product_id, unit_id, per_price, amount, total, purchase_item_id, sale_type, discount_type, discount_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, (
        &sale_id,
        &product_id,
        &unit_id,
        &per_price,
        &amount,
        &total,
        &purchase_item_id,
        &sale_type,
        &discount_type,
        &discount_value,
    ))
        .map_err(|e| format!("Failed to insert sale item: {}", e))?;

    // Update sale total: subtotal - order_discount_amount + additional_cost
    let update_sale_sql = "UPDATE sales SET total_amount = (SELECT COALESCE(SUM(total), 0) FROM sale_items WHERE sale_id = ?) + (SELECT COALESCE(SUM(total), 0) FROM sale_service_items WHERE sale_id = ?) - COALESCE((SELECT order_discount_amount FROM sales WHERE id = ?), 0) + COALESCE((SELECT additional_cost FROM sales WHERE id = ?), 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sale_sql, (sale_id, sale_id, sale_id, sale_id, sale_id))
        .map_err(|e| format!("Failed to update sale total: {}", e))?;

    // Get the created item (with discount columns)
    let item_sql = "SELECT id, sale_id, product_id, unit_id, per_price, amount, total, purchase_item_id, sale_type, discount_type, discount_value, created_at FROM sale_items WHERE sale_id = ? AND product_id = ? ORDER BY id DESC LIMIT 1";
    let items = db
        .query(item_sql, (sale_id, product_id), |row| {
            Ok(SaleItem {
                id: row_get(row, 0)?,
                sale_id: row_get(row, 1)?,
                product_id: row_get(row, 2)?,
                unit_id: row_get(row, 3)?,
                per_price: row_get(row, 4)?,
                amount: row_get(row, 5)?,
                total: row_get(row, 6)?,
                purchase_item_id: row_get(row, 7)?,
                sale_type: row_get(row, 8)?,
                discount_type: row_get(row, 9)?,
                discount_value: row_get(row, 10)?,
                created_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch sale item: {}", e))?;

    if let Some(item) = items.first() {
        Ok(item.clone())
    } else {
        Err("Failed to retrieve created sale item".to_string())
    }
}

/// Get sale items for a sale
#[tauri::command]
fn get_sale_items(db_state: State<'_, Mutex<Option<Database>>>, sale_id: i64) -> Result<Vec<SaleItem>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, sale_id, product_id, unit_id, per_price, amount, total, purchase_item_id, sale_type, discount_type, discount_value, created_at FROM sale_items WHERE sale_id = ? ORDER BY id";
    let items = db
        .query(sql, one_param(sale_id), |row| {
            Ok(SaleItem {
                id: row_get(row, 0)?,
                sale_id: row_get(row, 1)?,
                product_id: row_get(row, 2)?,
                unit_id: row_get(row, 3)?,
                per_price: row_get(row, 4)?,
                amount: row_get(row, 5)?,
                total: row_get(row, 6)?,
                purchase_item_id: row_get(row, 7)?,
                sale_type: row_get(row, 8)?,
                discount_type: row_get(row, 9)?,
                discount_value: row_get(row, 10)?,
                created_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch sale items: {}", e))?;

    Ok(items)
}

/// Get all batches for a product (from purchase_items). Remaining quantity is computed with unit conversion (base units) so sale and purchase can use different units.
#[tauri::command]
fn get_product_batches(db_state: State<'_, Mutex<Option<Database>>>, product_id: i64) -> Result<Vec<ProductBatch>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Unit-precise: convert to base (amount * ratio), subtract sold_base, convert back to batch unit. COALESCE(ratio,1) for units without group.
    let sql = "
        SELECT 
            pi.id AS purchase_item_id,
            pi.purchase_id,
            p.batch_number,
            p.date AS purchase_date,
            pi.expiry_date,
            pi.per_price,
            pi.per_unit,
            pi.wholesale_price,
            pi.retail_price,
            pi.amount,
            ROUND(((pi.amount * COALESCE(u_pi.ratio, 1)) - COALESCE(sold.sold_base, 0)) / COALESCE(u_pi.ratio, 1), 6) AS remaining_quantity
        FROM purchase_items pi
        INNER JOIN purchases p ON pi.purchase_id = p.id
        LEFT JOIN units u_pi ON u_pi.id = pi.unit_id
        LEFT JOIN (
            SELECT si.purchase_item_id,
                SUM(si.amount * COALESCE(u_si.ratio, 1)) AS sold_base
            FROM sale_items si
            LEFT JOIN units u_si ON u_si.id = si.unit_id
            WHERE si.purchase_item_id IS NOT NULL
            GROUP BY si.purchase_item_id
        ) sold ON sold.purchase_item_id = pi.id
        WHERE pi.product_id = ?
        HAVING remaining_quantity > 0
        ORDER BY p.date ASC, pi.id ASC
    ";

    let batches = db
        .query(sql, one_param(product_id), |row| {
            let remaining: f64 = row_get(row, 10)?;
            Ok(ProductBatch {
                purchase_item_id: row_get(row, 0)?,
                purchase_id: row_get(row, 1)?,
                batch_number: row_get(row, 2)?,
                purchase_date: row_get(row, 3)?,
                expiry_date: row_get(row, 4)?,
                per_price: row_get(row, 5)?,
                per_unit: row_get(row, 6)?,
                wholesale_price: row_get(row, 7)?,
                retail_price: row_get(row, 8)?,
                amount: row_get(row, 9)?,
                remaining_quantity: round6(remaining),
            })
        })
        .map_err(|e| format!("Failed to fetch product batches: {}", e))?;

    Ok(batches)
}

/// Get product-level stock (sum of batch remaining in base units). If unit_id is provided, also return total in that unit.
#[tauri::command]
fn get_product_stock(
    db_state: State<'_, Mutex<Option<Database>>>,
    product_id: i64,
    unit_id: Option<i64>,
) -> Result<ProductStock, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "
        SELECT COALESCE(SUM(
            GREATEST(0, (pi.amount * COALESCE(u_pi.ratio, 1)) - COALESCE(sold.sold_base, 0))
        ), 0) AS total_base
        FROM purchase_items pi
        LEFT JOIN units u_pi ON u_pi.id = pi.unit_id
        LEFT JOIN (
            SELECT si.purchase_item_id,
                SUM(si.amount * COALESCE(u_si.ratio, 1)) AS sold_base
            FROM sale_items si
            LEFT JOIN units u_si ON u_si.id = si.unit_id
            WHERE si.purchase_item_id IS NOT NULL
            GROUP BY si.purchase_item_id
        ) sold ON sold.purchase_item_id = pi.id
        WHERE pi.product_id = ?
    ";
    let rows = db
        .query(sql, one_param(product_id), |row| Ok(row_get::<f64>(row, 0)?))
        .map_err(|e| format!("Failed to get product stock: {}", e))?;
    let total_base = round6(rows.first().copied().unwrap_or(0.0));

    let total_in_unit = if let Some(uid) = unit_id {
        let ratio = get_unit_ratio(db, uid)?;
        Some(if ratio.abs() < 1e-12 {
            0.0
        } else {
            round6(total_base / ratio)
        })
    } else {
        None
    };

    Ok(ProductStock {
        product_id,
        total_base,
        total_in_unit,
    })
}

/// Get stock report: all batches with remaining > 0, with product name and unit. Unit-precise remaining.
#[tauri::command]
fn get_stock_by_batches(db_state: State<'_, Mutex<Option<Database>>>) -> Result<Vec<StockBatchRow>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "
        SELECT 
            pi.product_id,
            COALESCE(pr.name, '') AS product_name,
            pi.id AS purchase_item_id,
            pi.purchase_id,
            p.batch_number,
            p.date AS purchase_date,
            pi.expiry_date,
            COALESCE(u_pi.name, '') AS unit_name,
            pi.amount,
            ROUND(((pi.amount * COALESCE(u_pi.ratio, 1)) - COALESCE(sold.sold_base, 0)) / COALESCE(u_pi.ratio, 1), 6) AS remaining_quantity,
            pi.per_price,
            COALESCE(pi.cost_price, pi.per_price) AS cost_price,
            pi.retail_price,
            pi.wholesale_price
        FROM purchase_items pi
        INNER JOIN purchases p ON pi.purchase_id = p.id
        LEFT JOIN units u_pi ON u_pi.id = pi.unit_id
        LEFT JOIN products pr ON pr.id = pi.product_id
        LEFT JOIN (
            SELECT si.purchase_item_id,
                SUM(si.amount * COALESCE(u_si.ratio, 1)) AS sold_base
            FROM sale_items si
            LEFT JOIN units u_si ON u_si.id = si.unit_id
            WHERE si.purchase_item_id IS NOT NULL
            GROUP BY si.purchase_item_id
        ) sold ON sold.purchase_item_id = pi.id
        HAVING remaining_quantity > 0
        ORDER BY pr.name ASC, p.date ASC, pi.id ASC
    ";
    let rows = db
        .query(sql, (), |row| {
            let remaining: f64 = row_get(row, 9)?;
            let per_price: f64 = row_get(row, 10)?;
            let cost_price: f64 = row_get(row, 11)?;
            let retail_price: Option<f64> = row_get(row, 12)?;
            let wholesale_price: Option<f64> = row_get(row, 13)?;
            let amount: f64 = row_get(row, 8)?;
            let total_purchase_cost = round2(amount * per_price);
            let stock_value = round2(cost_price * remaining);
            let sell_price = retail_price.unwrap_or(per_price);
            let potential_revenue_retail = round2(sell_price * remaining);
            let potential_profit = round2(potential_revenue_retail - stock_value);
            let margin_percent = if potential_revenue_retail > 0.0 {
                round2((potential_profit / potential_revenue_retail) * 100.0)
            } else {
                0.0
            };
            Ok(StockBatchRow {
                product_id: row_get(row, 0)?,
                product_name: row_get(row, 1)?,
                purchase_item_id: row_get(row, 2)?,
                purchase_id: row_get(row, 3)?,
                batch_number: row_get(row, 4)?,
                purchase_date: row_get(row, 5)?,
                expiry_date: row_get(row, 6)?,
                unit_name: row_get(row, 7)?,
                amount,
                remaining_quantity: round6(remaining),
                per_price,
                total_purchase_cost,
                cost_price,
                retail_price,
                wholesale_price,
                stock_value,
                potential_revenue_retail,
                potential_profit,
                margin_percent,
            })
        })
        .map_err(|e| format!("Failed to get stock by batches: {}", e))?;

    Ok(rows)
}

/// Update a sale item
#[tauri::command]
fn update_sale_item(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    product_id: i64,
    unit_id: i64,
    per_price: f64,
    amount: f64,
    purchase_item_id: Option<i64>,
    sale_type: Option<String>,
    discount_type: Option<String>,
    discount_value: f64,
) -> Result<SaleItem, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    if let Some(pid) = purchase_item_id {
        let current_row = db
            .query("SELECT amount, unit_id, purchase_item_id FROM sale_items WHERE id = ?", one_param(id), |row| {
                Ok((row_get::<f64>(row, 0)?, row_get::<i64>(row, 1)?, row_get::<Option<i64>>(row, 2)?))
            })
            .map_err(|e| format!("Failed to get sale item: {}", e))?;
        let add_back = current_row.first().and_then(|(cur_amt, cur_uid, cur_pid)| {
            if *cur_pid == Some(pid) { Some(amount_to_base(db, *cur_amt, *cur_uid).unwrap_or(0.0)) } else { Some(0.0) }
        }).unwrap_or(0.0);
        let remaining_base = get_batch_remaining_base(db, pid)?;
        let sale_amount_base = amount_to_base(db, amount, unit_id)?;
        if sale_amount_base > remaining_base + add_back + 1e-9 {
            return Err("موجودی دسته کافی نیست (Insufficient batch stock)".to_string());
        }
    }

    let line_subtotal = per_price * amount;
    let disc = compute_discount_amount(line_subtotal, discount_type.as_ref(), discount_value);
    let total = round2(line_subtotal - disc);

    let update_sql = "UPDATE sale_items SET product_id = ?, unit_id = ?, per_price = ?, amount = ?, total = ?, purchase_item_id = ?, sale_type = ?, discount_type = ?, discount_value = ? WHERE id = ?";
    db.execute(update_sql, (
        &product_id,
        &unit_id,
        &per_price,
        &amount,
        &total,
        &purchase_item_id,
        &sale_type,
        &discount_type,
        &discount_value,
        &id,
    ))
        .map_err(|e| format!("Failed to update sale item: {}", e))?;

    // Get sale_id to update sale total
    let sale_id_sql = "SELECT sale_id FROM sale_items WHERE id = ?";
    let sale_ids = db
        .query(sale_id_sql, one_param(id), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to fetch sale_id: {}", e))?;

    if let Some(sale_id) = sale_ids.first() {
        // Update sale total: subtotal - order_discount_amount + additional_cost
        let update_sale_sql = "UPDATE sales SET total_amount = (SELECT COALESCE(SUM(total), 0) FROM sale_items WHERE sale_id = ?) + (SELECT COALESCE(SUM(total), 0) FROM sale_service_items WHERE sale_id = ?) - COALESCE((SELECT order_discount_amount FROM sales WHERE id = ?), 0) + COALESCE((SELECT additional_cost FROM sales WHERE id = ?), 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
        db.execute(update_sale_sql, (sale_id, sale_id, sale_id, sale_id, sale_id))
            .map_err(|e| format!("Failed to update sale total: {}", e))?;
    }

    // Get the updated item (with discount columns)
    let item_sql = "SELECT id, sale_id, product_id, unit_id, per_price, amount, total, purchase_item_id, sale_type, discount_type, discount_value, created_at FROM sale_items WHERE id = ?";
    let items = db
        .query(item_sql, one_param(id), |row| {
            Ok(SaleItem {
                id: row_get(row, 0)?,
                sale_id: row_get(row, 1)?,
                product_id: row_get(row, 2)?,
                unit_id: row_get(row, 3)?,
                per_price: row_get(row, 4)?,
                amount: row_get(row, 5)?,
                total: row_get(row, 6)?,
                purchase_item_id: row_get(row, 7)?,
                sale_type: row_get(row, 8)?,
                discount_type: row_get(row, 9)?,
                discount_value: row_get(row, 10)?,
                created_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch sale item: {}", e))?;

    if let Some(item) = items.first() {
        Ok(item.clone())
    } else {
        Err("Failed to retrieve updated sale item".to_string())
    }
}

/// Delete a sale item
#[tauri::command]
fn delete_sale_item(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Get sale_id before deleting
    let sale_id_sql = "SELECT sale_id FROM sale_items WHERE id = ?";
    let sale_ids = db
        .query(sale_id_sql, one_param(id), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to fetch sale_id: {}", e))?;

    let sale_id = sale_ids.first().ok_or("Sale item not found")?;

    let delete_sql = "DELETE FROM sale_items WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete sale item: {}", e))?;

    // Update sale total: subtotal - order_discount_amount + additional_cost
    let update_sale_sql = "UPDATE sales SET total_amount = (SELECT COALESCE(SUM(total), 0) FROM sale_items WHERE sale_id = ?) + (SELECT COALESCE(SUM(total), 0) FROM sale_service_items WHERE sale_id = ?) - COALESCE((SELECT order_discount_amount FROM sales WHERE id = ?), 0) + COALESCE((SELECT additional_cost FROM sales WHERE id = ?), 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sale_sql, (sale_id, sale_id, sale_id, sale_id, sale_id))
        .map_err(|e| format!("Failed to update sale total: {}", e))?;

    Ok("Sale item deleted successfully".to_string())
}

/// Create a sale payment
#[tauri::command]
fn create_sale_payment(
    db_state: State<'_, Mutex<Option<Database>>>,
    sale_id: i64,
    account_id: Option<i64>,
    currency_id: Option<i64>,
    exchange_rate: f64,
    amount: f64,
    date: String,
) -> Result<SalePayment, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let base_amount = amount * exchange_rate;
    let payment_currency_id = currency_id.unwrap_or_else(|| {
        // Get sale currency or base currency
        let sale_currency_sql = "SELECT currency_id FROM sales WHERE id = ?";
        db.query(sale_currency_sql, one_param(sale_id), |row| Ok(row_get::<Option<i64>>(row, 0)?))
            .ok()
            .and_then(|v| v.first().and_then(|c| *c))
            .unwrap_or_else(|| {
                // Fallback to base currency
                db.query("SELECT id FROM currencies WHERE base = 1 LIMIT 1", (), |row| Ok(row_get::<i64>(row, 0)?))
                    .ok()
                    .and_then(|v| v.first().copied())
                    .unwrap_or(1)
            })
    });

    let insert_sql = "INSERT INTO sale_payments (sale_id, account_id, currency_id, exchange_rate, amount, base_amount, date) VALUES (?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, (
        &sale_id,
        &account_id,
        &payment_currency_id,
        &exchange_rate,
        &amount,
        &base_amount,
        &date,
    ))
        .map_err(|e| format!("Failed to insert sale payment: {}", e))?;

    // If account_id is provided, deposit the payment amount to the account
    if let Some(aid) = account_id {
        // Get current balance for the account's currency
        let current_balance = get_account_balance_by_currency_internal(db, aid, payment_currency_id)
            .unwrap_or(0.0);
        
        // Get currency name for transaction record
        let currency_name_sql = "SELECT name FROM currencies WHERE id = ? LIMIT 1";
        let currency_names = db
            .query(currency_name_sql, one_param(payment_currency_id), |row| {
                Ok(row_get::<String>(row, 0)?)
            })
            .map_err(|e| format!("Failed to find currency name: {}", e))?;
        
        if let Some(currency_name) = currency_names.first() {
            // Create account transaction record for this payment (deposit)
            let payment_notes = Some(format!("Payment for Sale #{}", sale_id));
            let payment_notes_str: Option<&str> = payment_notes.as_ref().map(|s| s.as_str());
            let is_full_int = 0i64;
            
            let insert_transaction_sql = "INSERT INTO account_transactions (account_id, transaction_type, amount, currency, rate, total, transaction_date, is_full, notes) VALUES (?, 'deposit', ?, ?, ?, ?, ?, ?, ?)";
            db.execute(insert_transaction_sql, (
                &aid,
                &amount,
                currency_name,
                &exchange_rate,
                &base_amount,
                &date,
                &is_full_int,
                &payment_notes_str,
            ))
            .map_err(|e| format!("Failed to create account transaction: {}", e))?;
            
            // Add the payment amount to the balance (deposit)
            let new_balance = current_balance + amount;
            
            // Update account currency balance
            update_account_currency_balance_internal(db, aid, payment_currency_id, new_balance)?;
            
            // Update account's current_balance
            let new_account_balance = calculate_account_balance_internal(db, aid)?;
            let update_balance_sql = "UPDATE accounts SET current_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
            db.execute(update_balance_sql, (
                &new_account_balance,
                &aid,
            ))
            .map_err(|e| format!("Failed to update account balance: {}", e))?;
        }
    }

    // Update sale paid_amount
    let update_sale_sql = "UPDATE sales SET paid_amount = (SELECT COALESCE(SUM(base_amount), 0) FROM sale_payments WHERE sale_id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sale_sql, (sale_id, sale_id))
        .map_err(|e| format!("Failed to update sale paid amount: {}", e))?;

    // Create journal entry for payment: Debit Cash/Bank, Credit Accounts Receivable
    let cash_account_sql = "SELECT id FROM accounts WHERE account_type = 'Asset' AND (name LIKE '%Cash%' OR name LIKE '%Bank%') LIMIT 1";
    let cash_accounts = db.query(cash_account_sql, (), |row| Ok(row_get::<i64>(row, 0)?))
        .ok()
        .and_then(|v| v.first().copied());
    
    let ar_account_sql = "SELECT id FROM accounts WHERE account_type = 'Asset' AND name LIKE '%Receivable%' LIMIT 1";
    let ar_accounts = db.query(ar_account_sql, (), |row| Ok(row_get::<i64>(row, 0)?))
        .ok()
        .and_then(|v| v.first().copied());

    if let (Some(cash_account), Some(ar_account)) = (cash_accounts, ar_accounts) {
        let journal_lines = vec![
            (cash_account, payment_currency_id, base_amount, 0.0, exchange_rate, Some(format!("Payment for Sale #{}", sale_id))),
            (ar_account, payment_currency_id, 0.0, base_amount, exchange_rate, Some(format!("Payment for Sale #{}", sale_id))),
        ];
        let _ = create_journal_entry_internal(db, &date, Some(format!("Payment for Sale #{}", sale_id)), Some("sale_payment".to_string()), Some(sale_id), journal_lines);
    }

    // Get the created payment
    let payment_sql = "SELECT id, sale_id, account_id, currency_id, exchange_rate, amount, base_amount, date, created_at FROM sale_payments WHERE sale_id = ? ORDER BY id DESC LIMIT 1";
    let payments = db
        .query(payment_sql, one_param(sale_id), |row| {
            Ok(SalePayment {
                id: row_get(row, 0)?,
                sale_id: row_get(row, 1)?,
                account_id: row_get(row, 2)?,
                currency_id: row_get(row, 3)?,
                exchange_rate: row_get(row, 4)?,
                amount: row_get(row, 5)?,
                base_amount: row_get(row, 6)?,
                date: row_get(row, 7)?,
                created_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch sale payment: {}", e))?;

    if let Some(payment) = payments.first() {
        Ok(payment.clone())
    } else {
        Err("Failed to retrieve created sale payment".to_string())
    }
}

/// Get payments for a sale
#[tauri::command]
fn get_sale_payments(db_state: State<'_, Mutex<Option<Database>>>, sale_id: i64) -> Result<Vec<SalePayment>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, sale_id, account_id, currency_id, exchange_rate, amount, base_amount, date, created_at FROM sale_payments WHERE sale_id = ? ORDER BY date DESC, created_at DESC";
    let payments = db
        .query(sql, one_param(sale_id), |row| {
            Ok(SalePayment {
                id: row_get(row, 0)?,
                sale_id: row_get(row, 1)?,
                account_id: row_get(row, 2)?,
                currency_id: row_get(row, 3)?,
                exchange_rate: row_get(row, 4)?,
                amount: row_get(row, 5)?,
                base_amount: row_get(row, 6)?,
                date: row_get(row, 7)?,
                created_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch sale payments: {}", e))?;

    Ok(payments)
}

/// Delete a sale payment
#[tauri::command]
fn delete_sale_payment(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Get sale_id before deleting
    let sale_id_sql = "SELECT sale_id FROM sale_payments WHERE id = ?";
    let sale_ids = db
        .query(sale_id_sql, one_param(id), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to fetch sale_id: {}", e))?;

    let sale_id = sale_ids.first().ok_or("Sale payment not found")?;

    let delete_sql = "DELETE FROM sale_payments WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete sale payment: {}", e))?;

    // Update sale paid_amount
    let update_sale_sql = "UPDATE sales SET paid_amount = (SELECT COALESCE(SUM(amount), 0) FROM sale_payments WHERE sale_id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sale_sql, (sale_id, sale_id))
        .map_err(|e| format!("Failed to update sale paid amount: {}", e))?;

    Ok("Sale payment deleted successfully".to_string())
}

// Service Model (catalog: offered services)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Service {
    pub id: i64,
    pub name: String,
    pub price: f64,
    pub currency_id: Option<i64>,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// SaleServiceItem Model (service line item on a sale)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleServiceItem {
    pub id: i64,
    pub sale_id: i64,
    pub service_id: i64,
    pub name: String,
    pub price: f64,
    pub quantity: f64,
    pub total: f64,
    pub discount_type: Option<String>,
    pub discount_value: f64,
    pub created_at: String,
}

// SaleDiscountCode Model (for coupon/promo codes)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaleDiscountCode {
    pub id: i64,
    pub code: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub value: f64,
    pub min_purchase: f64,
    pub valid_from: Option<String>,
    pub valid_to: Option<String>,
    pub max_uses: Option<i32>,
    pub use_count: i32,
    pub created_at: String,
}

/// Payload for create_discount_code and update_discount_code (JSON key "type" maps to type_).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct DiscountCodePayload {
    code: String,
    #[serde(rename = "type")]
    type_: String,
    value: f64,
    min_purchase: f64,
    valid_from: Option<String>,
    valid_to: Option<String>,
    max_uses: Option<i32>,
}

/// Initialize services table (catalog schema from db.sql on first open).
#[tauri::command]
fn init_services_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Initialize sale_discount_codes table (for existing DBs that don't have it).
#[tauri::command]
fn init_sale_discount_codes_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;
    let sql = "CREATE TABLE IF NOT EXISTS sale_discount_codes (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        code VARCHAR(255) NOT NULL UNIQUE,
        type VARCHAR(32) NOT NULL,
        value DOUBLE NOT NULL DEFAULT 0,
        min_purchase DOUBLE NOT NULL DEFAULT 0,
        valid_from TEXT,
        valid_to TEXT,
        max_uses INT,
        use_count INT NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )";
    db.execute(sql, ()).map_err(|e| format!("Failed to create sale_discount_codes table: {}", e))?;
    Ok("OK".to_string())
}

/// Validate a discount code and return applicable discount (type, value) or error. subtotal = items+services subtotal before order discount.
#[tauri::command]
fn validate_discount_code(
    db_state: State<'_, Mutex<Option<Database>>>,
    code: String,
    subtotal: f64,
) -> Result<(String, f64), String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let code_upper = code.trim().to_uppercase();
    if code_upper.is_empty() {
        return Err("Code is required".to_string());
    }

    let sql = "SELECT id, code, type, value, min_purchase, valid_from, valid_to, max_uses, use_count FROM sale_discount_codes WHERE UPPER(TRIM(code)) = ? LIMIT 1";
    let rows: Vec<(i64, String, String, f64, f64, Option<String>, Option<String>, Option<i32>, i32)> = db
        .query(sql, one_param(&code_upper), |row| {
            Ok((
                row_get(row, 0)?,
                row_get(row, 1)?,
                row_get(row, 2)?,
                row_get(row, 3)?,
                row_get(row, 4)?,
                row_get(row, 5)?,
                row_get(row, 6)?,
                row_get(row, 7)?,
                row_get(row, 8)?,
            ))
        })
        .map_err(|e| format!("Failed to lookup discount code: {}", e))?;

    let (_id, _code, type_, value, min_purchase, valid_from, valid_to, max_uses, use_count) = rows
        .into_iter()
        .next()
        .ok_or_else(|| "Discount code not found".to_string())?;

    if subtotal < min_purchase {
        return Err(format!("Minimum purchase for this code is {}", min_purchase));
    }

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    if let Some(ref from) = valid_from {
        if from.as_str() > today.as_str() {
            return Err("Discount code is not yet valid".to_string());
        }
    }
    if let Some(ref to) = valid_to {
        if to.as_str() < today.as_str() {
            return Err("Discount code has expired".to_string());
        }
    }

    if let Some(max) = max_uses {
        if use_count >= max {
            return Err("Discount code has reached maximum uses".to_string());
        }
    }

    let discount_type = if type_.eq_ignore_ascii_case("percent") {
        "percent".to_string()
    } else {
        "fixed".to_string()
    };
    Ok((discount_type, value))
}

/// Get all discount codes (optionally filtered by search).
#[tauri::command]
fn get_discount_codes(
    db_state: State<'_, Mutex<Option<Database>>>,
    search: Option<String>,
) -> Result<Vec<SaleDiscountCode>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let (sql, params): (String, Vec<Value>) = if let Some(s) = search {
        if s.trim().is_empty() {
            ("SELECT id, code, type, value, min_purchase, valid_from, valid_to, max_uses, use_count, created_at FROM sale_discount_codes ORDER BY code ASC".to_string(), vec![])
        } else {
            let term = format!("%{}%", s.trim());
            ("SELECT id, code, type, value, min_purchase, valid_from, valid_to, max_uses, use_count, created_at FROM sale_discount_codes WHERE code LIKE ? ORDER BY code ASC".to_string(), vec![Value::Bytes(term.into_bytes())])
        }
    } else {
        ("SELECT id, code, type, value, min_purchase, valid_from, valid_to, max_uses, use_count, created_at FROM sale_discount_codes ORDER BY code ASC".to_string(), vec![])
    };

    let list = db
        .query(&sql, params, |row| {
            Ok(SaleDiscountCode {
                id: row_get(row, 0)?,
                code: row_get(row, 1)?,
                type_: row_get(row, 2)?,
                value: row_get(row, 3)?,
                min_purchase: row_get(row, 4)?,
                valid_from: row_get(row, 5)?,
                valid_to: row_get(row, 6)?,
                max_uses: row_get(row, 7)?,
                use_count: row_get(row, 8)?,
                created_at: row_get_string_or_datetime(row, 9)?,
            })
        })
        .map_err(|e| format!("Failed to list discount codes: {}", e))?;
    Ok(list)
}

/// Create a new discount code.
#[tauri::command]
fn create_discount_code(
    db_state: State<'_, Mutex<Option<Database>>>,
    payload: DiscountCodePayload,
) -> Result<SaleDiscountCode, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let code_trimmed = payload.code.trim().to_uppercase();
    if code_trimmed.is_empty() {
        return Err("Code is required".to_string());
    }
    let discount_type = if payload.type_.eq_ignore_ascii_case("percent") {
        "percent"
    } else {
        "fixed"
    };

    let sql = "INSERT INTO sale_discount_codes (code, type, value, min_purchase, valid_from, valid_to, max_uses, use_count) VALUES (?, ?, ?, ?, ?, ?, ?, 0)";
    let valid_from_val = payload.valid_from.as_ref().map(|s| Value::Bytes(s.as_bytes().to_vec())).unwrap_or(Value::NULL);
    let valid_to_val = payload.valid_to.as_ref().map(|s| Value::Bytes(s.as_bytes().to_vec())).unwrap_or(Value::NULL);
    let max_uses_val = payload.max_uses.map(|n| Value::Int(n as i64)).unwrap_or(Value::NULL);
    let params: Vec<Value> = vec![
        Value::Bytes(code_trimmed.as_bytes().to_vec()),
        Value::Bytes(discount_type.as_bytes().to_vec()),
        Value::Double(payload.value),
        Value::Double(payload.min_purchase),
        valid_from_val,
        valid_to_val,
        max_uses_val,
    ];
    db.execute(sql, params)
        .map_err(|e| {
            let msg = e.to_string();
            if msg.to_lowercase().contains("duplicate") || msg.contains("UNIQUE") || msg.contains("1062") {
                "این کد تخفیف قبلاً ثبت شده است".to_string()
            } else {
                format!("Failed to create discount code: {}", e)
            }
        })?;

    let id_sql = "SELECT id FROM sale_discount_codes ORDER BY id DESC LIMIT 1";
    let ids = db.query(id_sql, (), |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to get discount code id: {}", e))?;
    let id = *ids.first().ok_or("Failed to get new discount code id")?;

    let sel = "SELECT id, code, type, value, min_purchase, valid_from, valid_to, max_uses, use_count, created_at FROM sale_discount_codes WHERE id = ?";
    let rows = db
        .query(sel, one_param(&id), |row| {
            Ok(SaleDiscountCode {
                id: row_get(row, 0)?,
                code: row_get(row, 1)?,
                type_: row_get(row, 2)?,
                value: row_get(row, 3)?,
                min_purchase: row_get(row, 4)?,
                valid_from: row_get(row, 5)?,
                valid_to: row_get(row, 6)?,
                max_uses: row_get(row, 7)?,
                use_count: row_get(row, 8)?,
                created_at: row_get_string_or_datetime(row, 9)?,
            })
        })
        .map_err(|e| format!("Failed to fetch created discount code: {}", e))?;
    rows.into_iter().next().ok_or("Failed to load created discount code".to_string())
}

/// Update a discount code.
#[tauri::command]
fn update_discount_code(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    payload: DiscountCodePayload,
) -> Result<SaleDiscountCode, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let code_trimmed = payload.code.trim().to_uppercase();
    if code_trimmed.is_empty() {
        return Err("Code is required".to_string());
    }
    let discount_type = if payload.type_.eq_ignore_ascii_case("percent") {
        "percent"
    } else {
        "fixed"
    };

    let sql = "UPDATE sale_discount_codes SET code = ?, type = ?, value = ?, min_purchase = ?, valid_from = ?, valid_to = ?, max_uses = ? WHERE id = ?";
    let valid_from_val = payload.valid_from.as_ref().map(|s| Value::Bytes(s.as_bytes().to_vec())).unwrap_or(Value::NULL);
    let valid_to_val = payload.valid_to.as_ref().map(|s| Value::Bytes(s.as_bytes().to_vec())).unwrap_or(Value::NULL);
    let max_uses_val = payload.max_uses.map(|n| Value::Int(n as i64)).unwrap_or(Value::NULL);
    let params: Vec<Value> = vec![
        Value::Bytes(code_trimmed.as_bytes().to_vec()),
        Value::Bytes(discount_type.as_bytes().to_vec()),
        Value::Double(payload.value),
        Value::Double(payload.min_purchase),
        valid_from_val,
        valid_to_val,
        max_uses_val,
        Value::Int(id),
    ];
    db.execute(sql, params)
        .map_err(|e| format!("Failed to update discount code: {}", e))?;

    let sel = "SELECT id, code, type, value, min_purchase, valid_from, valid_to, max_uses, use_count, created_at FROM sale_discount_codes WHERE id = ?";
    let rows = db
        .query(sel, one_param(&id), |row| {
            Ok(SaleDiscountCode {
                id: row_get(row, 0)?,
                code: row_get(row, 1)?,
                type_: row_get(row, 2)?,
                value: row_get(row, 3)?,
                min_purchase: row_get(row, 4)?,
                valid_from: row_get(row, 5)?,
                valid_to: row_get(row, 6)?,
                max_uses: row_get(row, 7)?,
                use_count: row_get(row, 8)?,
                created_at: row_get_string_or_datetime(row, 9)?,
            })
        })
        .map_err(|e| format!("Failed to fetch updated discount code: {}", e))?;
    rows.into_iter().next().ok_or("Failed to load updated discount code".to_string())
}

/// Delete a discount code.
#[tauri::command]
fn delete_discount_code(db_state: State<'_, Mutex<Option<Database>>>, id: i64) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;
    db.execute("DELETE FROM sale_discount_codes WHERE id = ?", one_param(&id))
        .map_err(|e| format!("Failed to delete discount code: {}", e))?;
    Ok("OK".to_string())
}

/// Create a new service (catalog entry)
#[tauri::command]
fn create_service(
    db_state: State<'_, Mutex<Option<Database>>>,
    name: String,
    price: f64,
    currency_id: Option<i64>,
    description: Option<String>,
) -> Result<Service, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let desc_str: Option<&str> = description.as_ref().map(|s| s.as_str());
    let insert_sql = "INSERT INTO services (name, price, currency_id, description) VALUES (?, ?, ?, ?)";
    db.execute(insert_sql, (
        &name,
        &price,
        &currency_id,
        &desc_str,
    ))
        .map_err(|e| format!("Failed to insert service: {}", e))?;

    let service_id_sql = "SELECT id FROM services ORDER BY id DESC LIMIT 1";
    let service_ids = db
        .query(service_id_sql, (), |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to fetch service ID: {}", e))?;

    let service_id = service_ids.first().ok_or("Failed to retrieve service ID")?;

    let service_sql = "SELECT id, name, price, currency_id, description, created_at, updated_at FROM services WHERE id = ?";
    let services = db
        .query(service_sql, one_param(service_id), |row| {
            Ok(Service {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                price: row_get(row, 2)?,
                currency_id: row_get(row, 3)?,
                description: row_get(row, 4)?,
                created_at: row_get_string_or_datetime(row, 5)?,
                updated_at: row_get_string_or_datetime(row, 6)?,
            })
        })
        .map_err(|e| format!("Failed to fetch service: {}", e))?;

    if let Some(service) = services.first() {
        Ok(service.clone())
    } else {
        Err("Failed to retrieve created service".to_string())
    }
}

/// Get all services (catalog) with pagination
#[tauri::command]
fn get_services(
    db_state: State<'_, Mutex<Option<Database>>>,
    page: i64,
    per_page: i64,
    search: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
) -> Result<PaginatedResponse<Service>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let offset = (page - 1) * per_page;

    let mut where_clause = String::new();
    let mut params: Vec<serde_json::Value> = Vec::new();

    if let Some(s) = search {
        if !s.trim().is_empty() {
            let search_term = format!("%{}%", s);
            where_clause = "WHERE (s.name LIKE ? OR s.description LIKE ?)".to_string();
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term));
        }
    }

    let count_sql = format!("SELECT COUNT(*) FROM services s {}", where_clause);
    let mysql_count_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let count_results: Vec<i64> = db.query(&count_sql, mysql_count_params.clone(), |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to count services: {}", e))?;
    let total: i64 = count_results.first().copied().unwrap_or(0);

    let order_clause = if let Some(sort) = sort_by {
        let order = sort_order.unwrap_or_else(|| "ASC".to_string());
        let allowed_cols = ["name", "price", "created_at"];
        if allowed_cols.contains(&sort.as_str()) {
            format!("ORDER BY s.{} {}", sort, if order.to_uppercase() == "DESC" { "DESC" } else { "ASC" })
        } else {
            "ORDER BY s.name ASC".to_string()
        }
    } else {
        "ORDER BY s.name ASC".to_string()
    };

    let sql = format!("SELECT s.id, s.name, s.price, s.currency_id, s.description, s.created_at, s.updated_at FROM services s {} {} LIMIT ? OFFSET ?", where_clause, order_clause);

    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));

    let mysql_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let services = db
        .query(&sql, mysql_params, |row| {
            Ok(Service {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                price: row_get(row, 2)?,
                currency_id: row_get(row, 3)?,
                description: row_get(row, 4)?,
                created_at: row_get_string_or_datetime(row, 5)?,
                updated_at: row_get_string_or_datetime(row, 6)?,
            })
        })
        .map_err(|e| format!("Failed to fetch services: {}", e))?;

    let total_pages = (total as f64 / per_page as f64).ceil() as i64;
    Ok(PaginatedResponse {
        items: services,
        total,
        page,
        per_page,
        total_pages,
    })
}

/// Get a single service (catalog entry) by ID
#[tauri::command]
fn get_service(db_state: State<'_, Mutex<Option<Database>>>, id: i64) -> Result<Service, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let service_sql = "SELECT id, name, price, currency_id, description, created_at, updated_at FROM services WHERE id = ?";
    let services = db
        .query(service_sql, one_param(id), |row| {
            Ok(Service {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                price: row_get(row, 2)?,
                currency_id: row_get(row, 3)?,
                description: row_get(row, 4)?,
                created_at: row_get_string_or_datetime(row, 5)?,
                updated_at: row_get_string_or_datetime(row, 6)?,
            })
        })
        .map_err(|e| format!("Failed to fetch service: {}", e))?;

    services.first().cloned().ok_or("Service not found".to_string())
}

/// Update a service (catalog entry)
#[tauri::command]
fn update_service(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    name: String,
    price: f64,
    currency_id: Option<i64>,
    description: Option<String>,
) -> Result<Service, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let desc_str: Option<&str> = description.as_ref().map(|s| s.as_str());
    let update_sql = "UPDATE services SET name = ?, price = ?, currency_id = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sql, (
        &name,
        &price,
        &currency_id,
        &desc_str,
        &id,
    ))
        .map_err(|e| format!("Failed to update service: {}", e))?;

    let service_sql = "SELECT id, name, price, currency_id, description, created_at, updated_at FROM services WHERE id = ?";
    let services = db
        .query(service_sql, one_param(id), |row| {
            Ok(Service {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                price: row_get(row, 2)?,
                currency_id: row_get(row, 3)?,
                description: row_get(row, 4)?,
                created_at: row_get_string_or_datetime(row, 5)?,
                updated_at: row_get_string_or_datetime(row, 6)?,
            })
        })
        .map_err(|e| format!("Failed to fetch service: {}", e))?;

    services.first().cloned().ok_or("Failed to retrieve updated service".to_string())
}

/// Delete a service (catalog entry)
#[tauri::command]
fn delete_service(db_state: State<'_, Mutex<Option<Database>>>, id: i64) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM services WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete service: {}", e))?;

    Ok("Service deleted successfully".to_string())
}

// ExpenseType Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpenseType {
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize expense_types table (schema from db.sql on first open).
#[tauri::command]
fn init_expense_types_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Create a new expense type
#[tauri::command]
fn create_expense_type(
    db_state: State<'_, Mutex<Option<Database>>>,
    name: String,
) -> Result<ExpenseType, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Insert new expense type
    let insert_sql = "INSERT INTO expense_types (name) VALUES (?)";
    db.execute(insert_sql, one_param(name.as_str()))
        .map_err(|e| format!("Failed to insert expense type: {}", e))?;

    // Get the created expense type
    let expense_type_sql = "SELECT id, name, created_at, updated_at FROM expense_types WHERE name = ?";
    let expense_types = db
        .query(expense_type_sql, one_param(name.as_str()), |row| {
            Ok(ExpenseType {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                created_at: row_get_string_or_datetime(row, 2)?,
                updated_at: row_get_string_or_datetime(row, 3)?,
            })
        })
        .map_err(|e| format!("Failed to fetch expense type: {}", e))?;

    if let Some(expense_type) = expense_types.first() {
        Ok(expense_type.clone())
    } else {
        Err("Failed to retrieve created expense type".to_string())
    }
}

/// Get all expense types
#[tauri::command]
fn get_expense_types(db_state: State<'_, Mutex<Option<Database>>>) -> Result<Vec<ExpenseType>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, name, created_at, updated_at FROM expense_types ORDER BY name ASC";
    let expense_types = db
        .query(sql, (), |row| {
            Ok(ExpenseType {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                created_at: row_get_string_or_datetime(row, 2)?,
                updated_at: row_get_string_or_datetime(row, 3)?,
            })
        })
        .map_err(|e| format!("Failed to fetch expense types: {}", e))?;

    Ok(expense_types)
}

/// Update an expense type
#[tauri::command]
fn update_expense_type(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    name: String,
) -> Result<ExpenseType, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Update expense type
    let update_sql = "UPDATE expense_types SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sql, (name.as_str(), id))
        .map_err(|e| format!("Failed to update expense type: {}", e))?;

    // Get the updated expense type
    let expense_type_sql = "SELECT id, name, created_at, updated_at FROM expense_types WHERE id = ?";
    let expense_types = db
        .query(expense_type_sql, one_param(id), |row| {
            Ok(ExpenseType {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                created_at: row_get_string_or_datetime(row, 2)?,
                updated_at: row_get_string_or_datetime(row, 3)?,
            })
        })
        .map_err(|e| format!("Failed to fetch expense type: {}", e))?;

    if let Some(expense_type) = expense_types.first() {
        Ok(expense_type.clone())
    } else {
        Err("Failed to retrieve updated expense type".to_string())
    }
}

/// Delete an expense type
#[tauri::command]
fn delete_expense_type(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM expense_types WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete expense type: {}", e))?;

    Ok("Expense type deleted successfully".to_string())
}

// Expense Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Expense {
    pub id: i64,
    pub expense_type_id: i64,
    pub account_id: Option<i64>,
    pub amount: f64,
    pub currency: String,
    pub rate: f64,
    pub total: f64,
    pub date: String,
    pub bill_no: Option<String>,
    pub description: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize expenses table (schema from db.sql on first open).
#[tauri::command]
fn init_expenses_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Create a new expense
#[tauri::command]
fn create_expense(
    db_state: State<'_, Mutex<Option<Database>>>,
    expense_type_id: i64,
    account_id: Option<i64>,
    amount: f64,
    currency: String,
    rate: f64,
    total: f64,
    date: String,
    bill_no: Option<String>,
    description: Option<String>,
) -> Result<Expense, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // If account_id is provided, withdraw the expense amount from the account
    if let Some(aid) = account_id {
        // Get currency_id from currency name
        let currency_sql = "SELECT id FROM currencies WHERE name = ? LIMIT 1";
        let currency_ids = db
            .query(currency_sql, one_param(currency.as_str()), |row| {
                Ok(row_get::<i64>(row, 0)?)
            })
            .map_err(|e| format!("Failed to find currency: {}", e))?;
        
        if let Some(currency_id) = currency_ids.first() {
            // Check if account has sufficient balance
            let current_balance = get_account_balance_by_currency_internal(db, aid, *currency_id)
                .unwrap_or(0.0);
            
            if current_balance < amount {
                return Err(format!("Insufficient balance in account. Available: {}, Required: {}", current_balance, amount));
            }
            
            // Create account transaction record for this expense (withdrawal)
            let expense_notes = description.as_ref().map(|_s| format!("Expense: {}", description.as_ref().unwrap_or(&"".to_string())));
            let expense_notes_str: Option<&str> = expense_notes.as_ref().map(|s| s.as_str());
            let is_full_int = 0i64;
            
            let insert_transaction_sql = "INSERT INTO account_transactions (account_id, transaction_type, amount, currency, rate, total, transaction_date, is_full, notes) VALUES (?, 'withdraw', ?, ?, ?, ?, ?, ?, ?)";
            db.execute(insert_transaction_sql, (
                &aid,
                &amount,
                &currency,
                &rate,
                &total,
                &date,
                &is_full_int,
                &expense_notes_str,
            ))
            .map_err(|e| format!("Failed to create account transaction: {}", e))?;
            
            // Subtract the expense amount from the balance
            let new_balance = current_balance - amount;
            
            // Update account currency balance
            update_account_currency_balance_internal(db, aid, *currency_id, new_balance)?;
            
            // Update account's current_balance
            let new_account_balance = calculate_account_balance_internal(db, aid)?;
            let update_balance_sql = "UPDATE accounts SET current_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
            db.execute(update_balance_sql, (new_account_balance, aid))
                .map_err(|e| format!("Failed to update account balance: {}", e))?;
        }
    }

    // Insert new expense
    let insert_sql = "INSERT INTO expenses (expense_type_id, account_id, amount, currency, rate, total, date, bill_no, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, (
        &expense_type_id,
        &account_id,
        &amount,
        &currency,
        &rate,
        &total,
        &date,
        &bill_no,
        &description,
    ))
        .map_err(|e| format!("Failed to insert expense: {}", e))?;

    // Get the created expense
    let expense_sql = "SELECT id, expense_type_id, account_id, amount, currency, rate, total, date, bill_no, description, created_at, updated_at FROM expenses WHERE expense_type_id = ? AND date = ? ORDER BY id DESC LIMIT 1";
    let expenses = db
        .query(expense_sql, (expense_type_id, date.as_str()), |row| {
            Ok(Expense {
                id: row_get(row, 0)?,
                expense_type_id: row_get(row, 1)?,
                account_id: row_get(row, 2)?,
                amount: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                total: row_get(row, 6)?,
                date: row_get(row, 7)?,
                bill_no: row_get(row, 8)?,
                description: row_get(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch expense: {}", e))?;

    if let Some(expense) = expenses.first() {
        Ok(expense.clone())
    } else {
        Err("Failed to retrieve created expense".to_string())
    }
}

#[tauri::command]
fn get_expenses(
    db_state: State<'_, Mutex<Option<Database>>>,
    page: i64,
    per_page: i64,
    search: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
) -> Result<PaginatedResponse<Expense>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let offset = (page - 1) * per_page;

    // Build WHERE clause
    let mut where_clause = String::new();
    let mut params: Vec<serde_json::Value> = Vec::new();

    if let Some(s) = search {
        if !s.trim().is_empty() {
             let search_term = format!("%{}%", s);
             where_clause = "WHERE (currency LIKE ? OR date LIKE ? OR bill_no LIKE ? OR description LIKE ?)".to_string();
             params.push(serde_json::Value::String(search_term.clone()));
             params.push(serde_json::Value::String(search_term.clone()));
             params.push(serde_json::Value::String(search_term.clone()));
             params.push(serde_json::Value::String(search_term));
        }
    }

    // Get total count
    let count_sql = format!("SELECT COUNT(*) FROM expenses {}", where_clause);
    let mysql_count_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let count_results: Vec<i64> = db
        .query(&count_sql, mysql_count_params, |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to count expenses: {}", e))?;
    let total: i64 = count_results.first().copied().unwrap_or(0);

    // Build Order By
    let order_clause = if let Some(sort) = sort_by {
        let order = sort_order.unwrap_or_else(|| "ASC".to_string());
        let allowed_cols = ["amount", "currency", "rate", "total", "date", "created_at"];
        if allowed_cols.contains(&sort.as_str()) {
             format!("ORDER BY {} {}", sort, if order.to_uppercase() == "DESC" { "DESC" } else { "ASC" })
        } else {
            "ORDER BY date DESC, created_at DESC".to_string()
        }
    } else {
        "ORDER BY date DESC, created_at DESC".to_string()
    };

    let sql = format!("SELECT id, expense_type_id, account_id, amount, currency, rate, total, date, bill_no, description, created_at, updated_at FROM expenses {} {} LIMIT ? OFFSET ?", where_clause, order_clause);
    
    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));

    let mysql_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let expenses = db
        .query(&sql, mysql_params, |row| {
            Ok(Expense {
                id: row_get(row, 0)?,
                expense_type_id: row_get(row, 1)?,
                account_id: row_get(row, 2)?,
                amount: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                total: row_get(row, 6)?,
                date: row_get(row, 7)?,
                bill_no: row_get(row, 8)?,
                description: row_get(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch expenses: {}", e))?;

    let total_pages = (total as f64 / per_page as f64).ceil() as i64;
    
    Ok(PaginatedResponse {
        items: expenses,
        total,
        page,
        per_page,
        total_pages,
    })
}

/// Get a single expense
#[tauri::command]
fn get_expense(db_state: State<'_, Mutex<Option<Database>>>, id: i64) -> Result<Expense, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let expense_sql = "SELECT id, expense_type_id, account_id, amount, currency, rate, total, date, bill_no, description, created_at, updated_at FROM expenses WHERE id = ?";
    let expenses = db
        .query(expense_sql, one_param(id), |row| {
            Ok(Expense {
                id: row_get(row, 0)?,
                expense_type_id: row_get(row, 1)?,
                account_id: row_get(row, 2)?,
                amount: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                total: row_get(row, 6)?,
                date: row_get(row, 7)?,
                bill_no: row_get(row, 8)?,
                description: row_get(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch expense: {}", e))?;

    let expense = expenses.first().ok_or("Expense not found")?;
    Ok(expense.clone())
}

/// Update an expense
#[tauri::command]
fn update_expense(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    expense_type_id: i64,
    account_id: Option<i64>,
    amount: f64,
    currency: String,
    rate: f64,
    total: f64,
    date: String,
    bill_no: Option<String>,
    description: Option<String>,
) -> Result<Expense, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Get old expense to restore balance if needed
    let old_expense_sql = "SELECT account_id, amount, currency FROM expenses WHERE id = ?";
    let old_expenses = db
        .query(old_expense_sql, one_param(id), |row| {
            Ok((
                row_get::<Option<i64>>(row, 0)?,
                row_get::<f64>(row, 1)?,
                row_get::<String>(row, 2)?,
            ))
        })
        .map_err(|e| format!("Failed to fetch old expense: {}", e))?;
    
    if let Some((old_account_id, old_amount, old_currency)) = old_expenses.first() {
        // If old expense had an account, restore the balance (deposit back)
        if let Some(old_aid) = old_account_id {
            let old_currency_sql = "SELECT id FROM currencies WHERE name = ? LIMIT 1";
            let old_currency_ids = db
                .query(old_currency_sql, one_param(old_currency.as_str()), |row| {
                    Ok(row_get::<i64>(row, 0)?)
                })
                .map_err(|e| format!("Failed to find old currency: {}", e))?;
            
            if let Some(old_currency_id) = old_currency_ids.first() {
                let current_balance = get_account_balance_by_currency_internal(db, *old_aid, *old_currency_id)
                    .unwrap_or(0.0);
                let new_balance = current_balance + old_amount;
                update_account_currency_balance_internal(db, *old_aid, *old_currency_id, new_balance)?;
                
                let new_account_balance = calculate_account_balance_internal(db, *old_aid)?;
                let update_balance_sql = "UPDATE accounts SET current_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
                db.execute(update_balance_sql, (new_account_balance, old_aid))
                    .map_err(|e| format!("Failed to update account balance: {}", e))?;
            }
        }
    }

    // If account_id is provided, withdraw the expense amount from the account
    if let Some(aid) = account_id {
        // Get currency_id from currency name
        let currency_sql = "SELECT id FROM currencies WHERE name = ? LIMIT 1";
        let currency_ids = db
            .query(currency_sql, one_param(currency.as_str()), |row| {
                Ok(row_get::<i64>(row, 0)?)
            })
            .map_err(|e| format!("Failed to find currency: {}", e))?;
        
        if let Some(currency_id) = currency_ids.first() {
            // Check if account has sufficient balance
            let current_balance = get_account_balance_by_currency_internal(db, aid, *currency_id)
                .unwrap_or(0.0);
            
            if current_balance < amount {
                return Err(format!("Insufficient balance in account. Available: {}, Required: {}", current_balance, amount));
            }
            
            // Create account transaction record for this expense (withdrawal)
            let expense_notes = description.as_ref().map(|_s| format!("Expense: {}", description.as_ref().unwrap_or(&"".to_string())));
            let expense_notes_str: Option<&str> = expense_notes.as_ref().map(|s| s.as_str());
            let is_full_int = 0i64;
            
            let insert_transaction_sql = "INSERT INTO account_transactions (account_id, transaction_type, amount, currency, rate, total, transaction_date, is_full, notes) VALUES (?, 'withdraw', ?, ?, ?, ?, ?, ?, ?)";
            db.execute(insert_transaction_sql, (
                &aid,
                &amount,
                &currency,
                &rate,
                &total,
                &date,
                &is_full_int,
                &expense_notes_str,
            ))
            .map_err(|e| format!("Failed to create account transaction: {}", e))?;
            
            // Subtract the expense amount from the balance
            let new_balance = current_balance - amount;
            
            // Update account currency balance
            update_account_currency_balance_internal(db, aid, *currency_id, new_balance)?;
            
            // Update account's current_balance
            let new_account_balance = calculate_account_balance_internal(db, aid)?;
            let update_balance_sql = "UPDATE accounts SET current_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
            db.execute(update_balance_sql, (new_account_balance, aid))
                .map_err(|e| format!("Failed to update account balance: {}", e))?;
        }
    }

    // Update expense
    let update_sql = "UPDATE expenses SET expense_type_id = ?, account_id = ?, amount = ?, currency = ?, rate = ?, total = ?, date = ?, bill_no = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sql, (
        &expense_type_id,
        &account_id,
        &amount,
        &currency,
        &rate,
        &total,
        &date,
        &bill_no,
        &description,
        &id,
    ))
        .map_err(|e| format!("Failed to update expense: {}", e))?;

    // Get the updated expense
    let expense_sql = "SELECT id, expense_type_id, account_id, amount, currency, rate, total, date, bill_no, description, created_at, updated_at FROM expenses WHERE id = ?";
    let expenses = db
        .query(expense_sql, one_param(id), |row| {
            Ok(Expense {
                id: row_get(row, 0)?,
                expense_type_id: row_get(row, 1)?,
                account_id: row_get(row, 2)?,
                amount: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                total: row_get(row, 6)?,
                date: row_get(row, 7)?,
                bill_no: row_get(row, 8)?,
                description: row_get(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch expense: {}", e))?;

    if let Some(expense) = expenses.first() {
        Ok(expense.clone())
    } else {
        Err("Failed to retrieve updated expense".to_string())
    }
}

/// Delete an expense
#[tauri::command]
fn delete_expense(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM expenses WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete expense: {}", e))?;

    Ok("Expense deleted successfully".to_string())
}

// Employee Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Employee {
    pub id: i64,
    pub full_name: String,
    pub phone: String,
    pub email: Option<String>,
    pub address: String,
    pub position: Option<String>,
    pub hire_date: Option<String>,
    pub base_salary: Option<f64>,
    pub photo_path: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize employees table (schema from db.sql on first open).
#[tauri::command]
fn init_employees_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Create a new employee
#[tauri::command]
fn create_employee(
    db_state: State<'_, Mutex<Option<Database>>>,
    full_name: String,
    phone: String,
    email: Option<String>,
    address: String,
    position: Option<String>,
    hire_date: Option<String>,
    base_salary: Option<f64>,
    photo_path: Option<String>,
    notes: Option<String>,
) -> Result<Employee, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Insert new employee
    let insert_sql = "INSERT INTO employees (full_name, phone, email, address, position, hire_date, base_salary, photo_path, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
    let email_str: Option<&str> = email.as_ref().map(|s| s.as_str());
    let position_str: Option<&str> = position.as_ref().map(|s| s.as_str());
    let hire_date_str: Option<&str> = hire_date.as_ref().map(|s| s.as_str());
    let photo_path_str: Option<&str> = photo_path.as_ref().map(|s| s.as_str());
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    
    db.execute(insert_sql, (
        &full_name,
        &phone,
        &email_str,
        &address,
        &position_str,
        &hire_date_str,
        &base_salary,
        &photo_path_str,
        &notes_str,
    ))
        .map_err(|e| format!("Failed to insert employee: {}", e))?;

    // Get the created employee
    let employee_sql = "SELECT id, full_name, phone, email, address, position, hire_date, base_salary, photo_path, notes, created_at, updated_at FROM employees WHERE full_name = ? AND phone = ? ORDER BY id DESC LIMIT 1";
    let employees = db
        .query(employee_sql, (full_name.as_str(), phone.as_str()), |row| {
            Ok(Employee {
                id: row_get(row, 0)?,
                full_name: row_get(row, 1)?,
                phone: row_get(row, 2)?,
                email: row_get::<Option<String>>(row, 3)?,
                address: row_get(row, 4)?,
                position: row_get::<Option<String>>(row, 5)?,
                hire_date: row_get::<Option<String>>(row, 6)?,
                base_salary: row_get::<Option<f64>>(row, 7)?,
                photo_path: row_get::<Option<String>>(row, 8)?,
                notes: row_get::<Option<String>>(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch employee: {}", e))?;

    if let Some(employee) = employees.first() {
        Ok(employee.clone())
    } else {
        Err("Failed to retrieve created employee".to_string())
    }
}

/// Get all employees
#[tauri::command]
fn get_employees(
    db_state: State<'_, Mutex<Option<Database>>>,
    page: i64,
    per_page: i64,
    search: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
) -> Result<PaginatedResponse<Employee>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let offset = (page - 1) * per_page;
    
    // Build WHERE clause
    let mut where_clause = String::new();
    let mut params: Vec<serde_json::Value> = Vec::new();

    if let Some(s) = search {
        if !s.trim().is_empty() {
            let search_term = format!("%{}%", s);
            where_clause = "WHERE (full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR position LIKE ?)".to_string();
            params.push(serde_json::Value::String(search_term.clone())); // full_name
            params.push(serde_json::Value::String(search_term.clone())); // phone
            params.push(serde_json::Value::String(search_term.clone())); // email
            params.push(serde_json::Value::String(search_term)); // position
        }
    }

    // Get total count
    let count_sql = format!("SELECT COUNT(*) FROM employees {}", where_clause);
    let mysql_count_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let count_results: Vec<i64> = db
        .query(&count_sql, mysql_count_params, |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to count employees: {}", e))?;
    let total: i64 = count_results.first().copied().unwrap_or(0);

    // Build Order By
    let order_clause = if let Some(sort) = sort_by {
        let order = sort_order.unwrap_or_else(|| "ASC".to_string());
        // Validate sort column to prevent injection (basic check)
        let allowed_cols = ["full_name", "phone", "email", "address", "position", "hire_date", "base_salary", "created_at"];
        if allowed_cols.contains(&sort.as_str()) {
             format!("ORDER BY {} {}", sort, if order.to_uppercase() == "DESC" { "DESC" } else { "ASC" })
        } else {
            "ORDER BY created_at DESC".to_string()
        }
    } else {
        "ORDER BY created_at DESC".to_string()
    };

    let sql = format!("SELECT id, full_name, phone, email, address, position, hire_date, base_salary, photo_path, notes, created_at, updated_at FROM employees {} {} LIMIT ? OFFSET ?", where_clause, order_clause);

    // Add pagination params
    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));

    let mysql_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let employees = db
        .query(&sql, mysql_params, |row| {
            Ok(Employee {
                id: row_get(row, 0)?,
                full_name: row_get(row, 1)?,
                phone: row_get(row, 2)?,
                email: row_get::<Option<String>>(row, 3)?,
                address: row_get(row, 4)?,
                position: row_get::<Option<String>>(row, 5)?,
                hire_date: row_get::<Option<String>>(row, 6)?,
                base_salary: row_get::<Option<f64>>(row, 7)?,
                photo_path: row_get::<Option<String>>(row, 8)?,
                notes: row_get::<Option<String>>(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch employees: {}", e))?;

    let total_pages = (total as f64 / per_page as f64).ceil() as i64;

    Ok(PaginatedResponse {
        items: employees,
        total,
        page,
        per_page,
        total_pages,
    })
}

/// Get employee by ID
#[tauri::command]
fn get_employee(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<Employee, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, full_name, phone, email, address, position, hire_date, base_salary, photo_path, notes, created_at, updated_at FROM employees WHERE id = ?";
    let employees = db
        .query(sql, one_param(id), |row| {
            Ok(Employee {
                id: row_get(row, 0)?,
                full_name: row_get(row, 1)?,
                phone: row_get(row, 2)?,
                email: row_get::<Option<String>>(row, 3)?,
                address: row_get(row, 4)?,
                position: row_get::<Option<String>>(row, 5)?,
                hire_date: row_get::<Option<String>>(row, 6)?,
                base_salary: row_get::<Option<f64>>(row, 7)?,
                photo_path: row_get::<Option<String>>(row, 8)?,
                notes: row_get::<Option<String>>(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch employee: {}", e))?;

    if let Some(employee) = employees.first() {
        Ok(employee.clone())
    } else {
        Err("Employee not found".to_string())
    }
}

/// Update an employee
#[tauri::command]
fn update_employee(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    full_name: String,
    phone: String,
    email: Option<String>,
    address: String,
    position: Option<String>,
    hire_date: Option<String>,
    base_salary: Option<f64>,
    photo_path: Option<String>,
    notes: Option<String>,
) -> Result<Employee, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Update employee
    let update_sql = "UPDATE employees SET full_name = ?, phone = ?, email = ?, address = ?, position = ?, hire_date = ?, base_salary = ?, photo_path = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    let email_str: Option<&str> = email.as_ref().map(|s| s.as_str());
    let position_str: Option<&str> = position.as_ref().map(|s| s.as_str());
    let hire_date_str: Option<&str> = hire_date.as_ref().map(|s| s.as_str());
    let photo_path_str: Option<&str> = photo_path.as_ref().map(|s| s.as_str());
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    
    db.execute(update_sql, (
        &full_name,
        &phone,
        &email_str,
        &address,
        &position_str,
        &hire_date_str,
        &base_salary,
        &photo_path_str,
        &notes_str,
        &id,
    ))
        .map_err(|e| format!("Failed to update employee: {}", e))?;

    // Get the updated employee
    let employee_sql = "SELECT id, full_name, phone, email, address, position, hire_date, base_salary, photo_path, notes, created_at, updated_at FROM employees WHERE id = ?";
    let employees = db
        .query(employee_sql, one_param(id), |row| {
            Ok(Employee {
                id: row_get(row, 0)?,
                full_name: row_get(row, 1)?,
                phone: row_get(row, 2)?,
                email: row_get::<Option<String>>(row, 3)?,
                address: row_get(row, 4)?,
                position: row_get::<Option<String>>(row, 5)?,
                hire_date: row_get::<Option<String>>(row, 6)?,
                base_salary: row_get::<Option<f64>>(row, 7)?,
                photo_path: row_get::<Option<String>>(row, 8)?,
                notes: row_get::<Option<String>>(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch employee: {}", e))?;

    if let Some(employee) = employees.first() {
        Ok(employee.clone())
    } else {
        Err("Failed to retrieve updated employee".to_string())
    }
}

/// Delete an employee
#[tauri::command]
fn delete_employee(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM employees WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete employee: {}", e))?;

    Ok("Employee deleted successfully".to_string())
}

// Salary Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Salary {
    pub id: i64,
    pub employee_id: i64,
    pub year: i32,
    pub month: String, // Dari month name like حمل, ثور
    pub amount: f64,
    pub deductions: f64,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize salaries table (schema from db.sql on first open).
#[tauri::command]
fn init_salaries_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Create a new salary
#[tauri::command]
fn create_salary(
    db_state: State<'_, Mutex<Option<Database>>>,
    employee_id: i64,
    year: i32,
    month: String,
    amount: f64,
    deductions: f64,
    notes: Option<String>,
) -> Result<Salary, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Insert new salary
    let insert_sql = "INSERT INTO salaries (employee_id, year, month, amount, deductions, notes) VALUES (?, ?, ?, ?, ?, ?)";
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    
    db.execute(insert_sql, (
        &employee_id,
        &year,
        &month,
        &amount,
        &deductions,
        &notes_str,
    ))
        .map_err(|e| format!("Failed to insert salary: {}", e))?;

    // Get the created salary
    let salary_sql = "SELECT id, employee_id, year, month, amount, deductions, notes, created_at, updated_at FROM salaries WHERE employee_id = ? AND year = ? AND month = ? ORDER BY id DESC LIMIT 1";
    let salaries = db
        .query(salary_sql, (employee_id, year, month.as_str()), |row| {
            Ok(Salary {
                id: row_get(row, 0)?,
                employee_id: row_get(row, 1)?,
                year: row_get(row, 2)?,
                month: row_get(row, 3)?,
                amount: row_get(row, 4)?,
                deductions: row_get(row, 5)?,
                notes: row_get::<Option<String>>(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch salary: {}", e))?;

    if let Some(salary) = salaries.first() {
        Ok(salary.clone())
    } else {
        Err("Failed to retrieve created salary".to_string())
    }
}

/// Get all salaries
#[tauri::command]
fn get_salaries(
    db_state: State<'_, Mutex<Option<Database>>>,
    page: i64,
    per_page: i64,
    search: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
) -> Result<PaginatedResponse<Salary>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let offset = (page - 1) * per_page;

    // Build WHERE clause
    let mut where_clause = String::new();
    let mut params: Vec<serde_json::Value> = Vec::new();

    if let Some(s) = search {
        if !s.trim().is_empty() {
             let search_term = format!("%{}%", s);
             where_clause = "WHERE (CAST(s.year AS TEXT) LIKE ? OR s.month LIKE ? OR s.employee_id IN (SELECT id FROM employees WHERE full_name LIKE ?))".to_string();
             params.push(serde_json::Value::String(search_term.clone()));
             params.push(serde_json::Value::String(search_term.clone()));
             params.push(serde_json::Value::String(search_term));
        }
    }

    // Get total count
    let count_sql = format!("SELECT COUNT(*) FROM salaries s {}", where_clause);
    let mysql_count_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let count_results: Vec<i64> = db
        .query(&count_sql, mysql_count_params, |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to count salaries: {}", e))?;
    let total: i64 = count_results.first().copied().unwrap_or(0);

    // Build Order By
    let order_clause = if let Some(sort) = sort_by {
        let order = sort_order.unwrap_or_else(|| "ASC".to_string());
        let allowed_cols = ["amount", "year", "month", "created_at"];
        if allowed_cols.contains(&sort.as_str()) {
             format!("ORDER BY s.{} {}", sort, if order.to_uppercase() == "DESC" { "DESC" } else { "ASC" })
        } else {
            "ORDER BY s.year DESC, s.month DESC".to_string()
        }
    } else {
        "ORDER BY s.year DESC, s.month DESC".to_string()
    };

    let sql = format!("SELECT s.id, s.employee_id, s.year, s.month, s.amount, COALESCE(s.deductions, 0) as deductions, s.notes, s.created_at, s.updated_at FROM salaries s {} {} LIMIT ? OFFSET ?", where_clause, order_clause);
    
    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));

    let mysql_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let salaries = db
        .query(&sql, mysql_params, |row| {
            Ok(Salary {
                id: row_get(row, 0)?,
                employee_id: row_get(row, 1)?,
                year: row_get(row, 2)?,
                month: row_get(row, 3)?,
                amount: row_get(row, 4)?,
                deductions: row_get(row, 5)?,
                notes: row_get::<Option<String>>(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch salaries: {}", e))?;

    let total_pages = (total as f64 / per_page as f64).ceil() as i64;
    
    Ok(PaginatedResponse {
        items: salaries,
        total,
        page,
        per_page,
        total_pages,
    })
}

/// Get salaries by employee ID
#[tauri::command]
fn get_salaries_by_employee(
    db_state: State<'_, Mutex<Option<Database>>>,
    employee_id: i64,
) -> Result<Vec<Salary>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, employee_id, year, month, amount, COALESCE(deductions, 0) as deductions, notes, created_at, updated_at FROM salaries WHERE employee_id = ? ORDER BY year DESC, month DESC";
    let salaries = db
        .query(sql, one_param(employee_id), |row| {
            Ok(Salary {
                id: row_get(row, 0)?,
                employee_id: row_get(row, 1)?,
                year: row_get(row, 2)?,
                month: row_get(row, 3)?,
                amount: row_get(row, 4)?,
                deductions: row_get(row, 5)?,
                notes: row_get::<Option<String>>(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch salaries: {}", e))?;

    Ok(salaries)
}

/// Get salary by ID
#[tauri::command]
fn get_salary(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<Salary, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, employee_id, year, month, amount, COALESCE(deductions, 0) as deductions, notes, created_at, updated_at FROM salaries WHERE id = ?";
    let salaries = db
        .query(sql, one_param(id), |row| {
            Ok(Salary {
                id: row_get(row, 0)?,
                employee_id: row_get(row, 1)?,
                year: row_get(row, 2)?,
                month: row_get(row, 3)?,
                amount: row_get(row, 4)?,
                deductions: row_get(row, 5)?,
                notes: row_get::<Option<String>>(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch salary: {}", e))?;

    if let Some(salary) = salaries.first() {
        Ok(salary.clone())
    } else {
        Err("Salary not found".to_string())
    }
}

/// Update a salary
#[tauri::command]
fn update_salary(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    employee_id: i64,
    year: i32,
    month: String,
    amount: f64,
    deductions: f64,
    notes: Option<String>,
) -> Result<Salary, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Update salary
    let update_sql = "UPDATE salaries SET employee_id = ?, year = ?, month = ?, amount = ?, deductions = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    
    db.execute(update_sql, (
        &employee_id,
        &year,
        &month,
        &amount,
        &deductions,
        &notes_str,
        &id,
    ))
        .map_err(|e| format!("Failed to update salary: {}", e))?;

    // Get the updated salary
    let salary_sql = "SELECT id, employee_id, year, month, amount, COALESCE(deductions, 0) as deductions, notes, created_at, updated_at FROM salaries WHERE id = ?";
    let salaries = db
        .query(salary_sql, one_param(id), |row| {
            Ok(Salary {
                id: row_get(row, 0)?,
                employee_id: row_get(row, 1)?,
                year: row_get(row, 2)?,
                month: row_get(row, 3)?,
                amount: row_get(row, 4)?,
                deductions: row_get(row, 5)?,
                notes: row_get::<Option<String>>(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch salary: {}", e))?;

    if let Some(salary) = salaries.first() {
        Ok(salary.clone())
    } else {
        Err("Failed to retrieve updated salary".to_string())
    }
}

/// Delete a salary
#[tauri::command]
fn delete_salary(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM salaries WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete salary: {}", e))?;

    Ok("Salary deleted successfully".to_string())
}

// Deduction Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deduction {
    pub id: i64,
    pub employee_id: i64,
    pub year: i32,
    pub month: String, // Dari month name like حمل, ثور
    pub currency: String,
    pub rate: f64,
    pub amount: f64,
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize deductions table (schema from db.sql on first open).
#[tauri::command]
fn init_deductions_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Create a new deduction
#[tauri::command]
fn create_deduction(
    db_state: State<'_, Mutex<Option<Database>>>,
    employee_id: i64,
    year: i32,
    month: String,
    currency: String,
    rate: f64,
    amount: f64,
) -> Result<Deduction, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Insert new deduction
    let insert_sql = "INSERT INTO deductions (employee_id, year, month, currency, rate, amount) VALUES (?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, (
        &employee_id,
        &year,
        &month,
        &currency,
        &rate,
        &amount,
    ))
        .map_err(|e| format!("Failed to insert deduction: {}", e))?;

    // Get the created deduction
    let deduction_sql = "SELECT id, employee_id, year, month, currency, rate, amount, created_at, updated_at FROM deductions WHERE employee_id = ? AND year = ? AND month = ? AND currency = ? AND rate = ? AND amount = ? ORDER BY id DESC LIMIT 1";
    let deductions = db
        .query(deduction_sql, (
            &employee_id,
            &year,
            &month,
            &currency,
            &rate,
            &amount,
        ), |row| {
            Ok(Deduction {
                id: row_get(row, 0)?,
                employee_id: row_get(row, 1)?,
                year: row_get(row, 2)?,
                month: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                amount: row_get(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch deduction: {}", e))?;

    if let Some(deduction) = deductions.first() {
        Ok(deduction.clone())
    } else {
        Err("Failed to retrieve created deduction".to_string())
    }
}

/// Get all deductions with pagination
#[tauri::command]
fn get_deductions(
    db_state: State<'_, Mutex<Option<Database>>>,
    page: i64,
    per_page: i64,
    search: Option<String>,
    sort_by: Option<String>,
    sort_order: Option<String>,
) -> Result<PaginatedResponse<Deduction>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let offset = (page - 1) * per_page;

    // Build WHERE clause
    let mut where_clause = String::new();
    let mut params: Vec<serde_json::Value> = Vec::new();

    if let Some(s) = search {
        if !s.trim().is_empty() {
             let search_term = format!("%{}%", s);
             where_clause = "WHERE (currency LIKE ? OR month LIKE ? OR CAST(year AS TEXT) LIKE ?)".to_string();
             params.push(serde_json::Value::String(search_term.clone()));
             params.push(serde_json::Value::String(search_term.clone()));
             params.push(serde_json::Value::String(search_term));
        }
    }

    // Get total count
    let count_sql = format!("SELECT COUNT(*) FROM deductions {}", where_clause);
    let mysql_count_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let count_results: Vec<i64> = db
        .query(&count_sql, mysql_count_params, |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to count deductions: {}", e))?;
    let total: i64 = count_results.first().copied().unwrap_or(0);

    // Build Order By
    let order_clause = if let Some(sort) = sort_by {
        let order = sort_order.unwrap_or_else(|| "ASC".to_string());
        let allowed_cols = ["amount", "year", "month", "currency", "rate", "created_at"];
        if allowed_cols.contains(&sort.as_str()) {
             format!("ORDER BY {} {}", sort, if order.to_uppercase() == "DESC" { "DESC" } else { "ASC" })
        } else {
            "ORDER BY year DESC, month DESC, created_at DESC".to_string()
        }
    } else {
        "ORDER BY year DESC, month DESC, created_at DESC".to_string()
    };

    let sql = format!("SELECT id, employee_id, COALESCE(year, 1403) as year, COALESCE(month, 'حمل') as month, currency, rate, amount, created_at, updated_at FROM deductions {} {} LIMIT ? OFFSET ?", where_clause, order_clause);
    
    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));

    let mysql_params: Vec<Value> = params.iter().map(json_to_mysql_value).collect();
    let deductions = db
        .query(&sql, mysql_params, |row| {
            Ok(Deduction {
                id: row_get(row, 0)?,
                employee_id: row_get(row, 1)?,
                year: row_get(row, 2)?,
                month: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                amount: row_get(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch deductions: {}", e))?;

    let total_pages = (total as f64 / per_page as f64).ceil() as i64;
    
    Ok(PaginatedResponse {
        items: deductions,
        total,
        page,
        per_page,
        total_pages,
    })
}

/// Get deductions by employee ID
#[tauri::command]
fn get_deductions_by_employee(
    db_state: State<'_, Mutex<Option<Database>>>,
    employee_id: i64,
) -> Result<Vec<Deduction>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, employee_id, COALESCE(year, 1403) as year, COALESCE(month, 'حمل') as month, currency, rate, amount, created_at, updated_at FROM deductions WHERE employee_id = ? ORDER BY year DESC, month DESC, created_at DESC";
    let deductions = db
        .query(sql, one_param(employee_id), |row| {
            Ok(Deduction {
                id: row_get(row, 0)?,
                employee_id: row_get(row, 1)?,
                year: row_get(row, 2)?,
                month: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                amount: row_get(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch deductions: {}", e))?;

    Ok(deductions)
}

/// Get deductions by employee ID, year, and month
#[tauri::command]
fn get_deductions_by_employee_year_month(
    db_state: State<'_, Mutex<Option<Database>>>,
    employee_id: i64,
    year: i32,
    month: String,
) -> Result<Vec<Deduction>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, employee_id, COALESCE(year, 1403) as year, COALESCE(month, 'حمل') as month, currency, rate, amount, created_at, updated_at FROM deductions WHERE employee_id = ? AND year = ? AND month = ? ORDER BY created_at DESC";
    let deductions = db
        .query(sql, (
            &employee_id,
            &year,
            &month,
        ), |row| {
            Ok(Deduction {
                id: row_get(row, 0)?,
                employee_id: row_get(row, 1)?,
                year: row_get(row, 2)?,
                month: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                amount: row_get(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch deductions: {}", e))?;

    Ok(deductions)
}

/// Get deduction by ID
#[tauri::command]
fn get_deduction(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<Deduction, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, employee_id, COALESCE(year, 1403) as year, COALESCE(month, 'حمل') as month, currency, rate, amount, created_at, updated_at FROM deductions WHERE id = ?";
    let deductions = db
        .query(sql, one_param(id), |row| {
            Ok(Deduction {
                id: row_get(row, 0)?,
                employee_id: row_get(row, 1)?,
                year: row_get(row, 2)?,
                month: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                amount: row_get(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch deduction: {}", e))?;

    let deduction = deductions.first().ok_or("Deduction not found")?;
    Ok(deduction.clone())
}

/// Update a deduction
#[tauri::command]
fn update_deduction(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    employee_id: i64,
    currency: String,
    rate: f64,
    amount: f64,
) -> Result<Deduction, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Update deduction
    let update_sql = "UPDATE deductions SET employee_id = ?, currency = ?, rate = ?, amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sql, (
        &employee_id,
        &currency,
        &rate,
        &amount,
        &id,
    ))
        .map_err(|e| format!("Failed to update deduction: {}", e))?;

    // Get the updated deduction
    let deduction_sql = "SELECT id, employee_id, COALESCE(year, 1403) as year, COALESCE(month, 'حمل') as month, currency, rate, amount, created_at, updated_at FROM deductions WHERE id = ?";
    let deductions = db
        .query(deduction_sql, one_param(id), |row| {
            Ok(Deduction {
                id: row_get(row, 0)?,
                employee_id: row_get(row, 1)?,
                year: row_get(row, 2)?,
                month: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                amount: row_get(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch deduction: {}", e))?;

    if let Some(deduction) = deductions.first() {
        Ok(deduction.clone())
    } else {
        Err("Failed to retrieve updated deduction".to_string())
    }
}

/// Delete a deduction
#[tauri::command]
fn delete_deduction(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM deductions WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete deduction: {}", e))?;

    Ok("Deduction deleted successfully".to_string())
}

// ========== Company Settings ==========

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanySettings {
    pub id: i64,
    pub name: String,
    pub logo: Option<String>,
    pub phone: Option<String>,
    pub address: Option<String>,
    pub font: Option<String>,
    pub auto_backup_dir: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize company_settings table (schema from db.sql on first open).
/// Ensures auto_backup_dir column exists and logo column is MEDIUMTEXT (for base64 images).
#[tauri::command]
fn init_company_settings_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;
    if let Err(e) = db.execute("ALTER TABLE company_settings ADD COLUMN auto_backup_dir TEXT NULL", ()) {
        let msg = e.to_string();
        if !msg.contains("Duplicate column") && !msg.contains("1060") {
            return Err(msg);
        }
    }
    // Allow larger logo (base64 data URLs); TEXT is 64KB, MEDIUMTEXT is 16MB
    if let Err(e) = db.execute("ALTER TABLE company_settings MODIFY COLUMN logo MEDIUMTEXT", ()) {
        let msg = e.to_string();
        if !msg.contains("Duplicate column") && !msg.contains("1060") {
            return Err(msg);
        }
    }
    Ok("OK".to_string())
}

/// Get company settings (only one row should exist)
#[tauri::command]
fn get_company_settings(db_state: State<'_, Mutex<Option<Database>>>) -> Result<CompanySettings, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, name, logo, phone, address, font, auto_backup_dir, created_at, updated_at FROM company_settings ORDER BY id LIMIT 1";
    let settings_list = db
        .query(sql, (), |row| {
            Ok(CompanySettings {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                logo: row_get(row, 2)?,
                phone: row_get(row, 3)?,
                address: row_get(row, 4)?,
                font: row_get(row, 5)?,
                auto_backup_dir: row_get(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch company settings: {}", e))?;

    let settings = settings_list.first().ok_or("No company settings found")?;
    Ok(settings.clone())
}

/// Update company settings
#[tauri::command]
fn update_company_settings(
    db_state: State<'_, Mutex<Option<Database>>>,
    name: String,
    logo: Option<String>,
    phone: Option<String>,
    address: Option<String>,
    font: Option<String>,
    auto_backup_dir: Option<String>,
) -> Result<CompanySettings, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Check if settings exist
    let count_sql = "SELECT COUNT(*) FROM company_settings";
    let counts = db.query(count_sql, (), |row| Ok(row_get::<i64>(row, 0)?))
        .unwrap_or_else(|_| vec![]);
    let count: i64 = counts.first().copied().unwrap_or(0);

    if count == 0 {
        // Insert new settings
        let insert_sql = "INSERT INTO company_settings (name, logo, phone, address, font, auto_backup_dir) VALUES (?, ?, ?, ?, ?, ?)";
        db.execute(insert_sql, (
            &name,
            &logo,
            &phone,
            &address,
            &font,
            &auto_backup_dir,
        ))
        .map_err(|e| format!("Failed to insert company settings: {}", e))?;
    } else {
        // Update existing settings (update first row). Use derived table to avoid MySQL ERROR 1093 (can't specify target table in FROM clause).
        let update_sql = "UPDATE company_settings SET name = ?, logo = ?, phone = ?, address = ?, font = ?, auto_backup_dir = ?, updated_at = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM (SELECT id FROM company_settings ORDER BY id LIMIT 1) AS _cs)";
        db.execute(update_sql, (
            &name,
            &logo,
            &phone,
            &address,
            &font,
            &auto_backup_dir,
        ))
        .map_err(|e| format!("Failed to update company settings: {}", e))?;
    }

    // Get the updated settings (reuse the same db reference)
    let get_sql = "SELECT id, name, logo, phone, address, font, auto_backup_dir, created_at, updated_at FROM company_settings ORDER BY id LIMIT 1";
    let settings_list = db
        .query(get_sql, (), |row| {
            Ok(CompanySettings {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                logo: row_get(row, 2)?,
                phone: row_get(row, 3)?,
                address: row_get(row, 4)?,
                font: row_get(row, 5)?,
                auto_backup_dir: row_get(row, 6)?,
                created_at: row_get_string_or_datetime(row, 7)?,
                updated_at: row_get_string_or_datetime(row, 8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch updated company settings: {}", e))?;

    let settings = settings_list.first().ok_or("No company settings found")?;
    Ok(settings.clone())
}

// COA Category Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoaCategory {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub code: String,
    pub category_type: String, // Asset, Liability, Equity, Revenue, Expense
    pub level: i64,
    pub created_at: String,
    pub updated_at: String,
}

// Account Currency Balance Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountCurrencyBalance {
    pub id: i64,
    pub account_id: i64,
    pub currency_id: i64,
    pub balance: f64,
    pub updated_at: String,
}

// Journal Entry Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalEntry {
    pub id: i64,
    pub entry_number: String,
    pub entry_date: String,
    pub description: Option<String>,
    pub reference_type: Option<String>, // sale, purchase, manual, etc.
    pub reference_id: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

// Journal Entry Line Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JournalEntryLine {
    pub id: i64,
    pub journal_entry_id: i64,
    pub account_id: i64,
    pub currency_id: i64,
    pub debit_amount: f64,
    pub credit_amount: f64,
    pub exchange_rate: f64,
    pub base_amount: f64,
    pub description: Option<String>,
    pub created_at: String,
}

// Currency Exchange Rate Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CurrencyExchangeRate {
    pub id: i64,
    pub from_currency_id: i64,
    pub to_currency_id: i64,
    pub rate: f64,
    pub date: String,
    pub created_at: String,
}

/// Initialize COA categories table (schema from db.sql on first open).
#[tauri::command]
fn init_coa_categories_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Initialize account currency balances table (schema from db.sql on first open).
#[tauri::command]
fn init_account_currency_balances_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Initialize journal entries table (schema from db.sql on first open).
#[tauri::command]
fn init_journal_entries_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Initialize journal entry lines table (schema from db.sql on first open).
#[tauri::command]
fn init_journal_entry_lines_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Initialize currency exchange rates table (schema from db.sql on first open).
#[tauri::command]
fn init_currency_exchange_rates_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Create a new COA category
#[tauri::command]
fn create_coa_category(
    db_state: State<'_, Mutex<Option<Database>>>,
    parent_id: Option<i64>,
    name: String,
    code: String,
    category_type: String,
) -> Result<CoaCategory, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Calculate level based on parent
    let level = if let Some(pid) = parent_id {
        let parent_level_sql = "SELECT level FROM coa_categories WHERE id = ?";
        let parent_levels = db
            .query(parent_level_sql, one_param(pid), |row| {
                Ok(row_get::<i64>(row, 0)?)
            })
            .map_err(|e| format!("Failed to fetch parent level: {}", e))?;
        parent_levels.first().copied().unwrap_or(0) + 1
    } else {
        0
    };

    let insert_sql = "INSERT INTO coa_categories (parent_id, name, code, category_type, level) VALUES (?, ?, ?, ?, ?)";
    db.execute(insert_sql, (
        &parent_id,
        &name,
        &code,
        &category_type,
        &level,
    ))
        .map_err(|e| format!("Failed to insert COA category: {}", e))?;

    // Get the created category
    let category_sql = "SELECT id, parent_id, name, code, category_type, level, created_at, updated_at FROM coa_categories WHERE code = ? ORDER BY id DESC LIMIT 1";
    let categories = db
        .query(category_sql, one_param(code.as_str()), |row| {
            Ok(CoaCategory {
                id: row_get(row, 0)?,
                parent_id: row_get(row, 1)?,
                name: row_get(row, 2)?,
                code: row_get(row, 3)?,
                category_type: row_get(row, 4)?,
                level: row_get(row, 5)?,
                created_at: row_get_string_or_datetime(row, 6)?,
                updated_at: row_get_string_or_datetime(row, 7)?,
            })
        })
        .map_err(|e| format!("Failed to fetch COA category: {}", e))?;

    if let Some(category) = categories.first() {
        Ok(category.clone())
    } else {
        Err("Failed to retrieve created COA category".to_string())
    }
}

/// Get all COA categories
#[tauri::command]
fn get_coa_categories(db_state: State<'_, Mutex<Option<Database>>>) -> Result<Vec<CoaCategory>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, parent_id, name, code, category_type, level, created_at, updated_at FROM coa_categories ORDER BY level, code";
    let categories = db
        .query(sql, (), |row| {
            Ok(CoaCategory {
                id: row_get(row, 0)?,
                parent_id: row_get(row, 1)?,
                name: row_get(row, 2)?,
                code: row_get(row, 3)?,
                category_type: row_get(row, 4)?,
                level: row_get(row, 5)?,
                created_at: row_get_string_or_datetime(row, 6)?,
                updated_at: row_get_string_or_datetime(row, 7)?,
            })
        })
        .map_err(|e| format!("Failed to fetch COA categories: {}", e))?;

    Ok(categories)
}

/// Get COA category tree (hierarchical structure)
#[tauri::command]
fn get_coa_category_tree(db_state: State<'_, Mutex<Option<Database>>>) -> Result<Vec<CoaCategory>, String> {
    // For now, return flat list sorted by level and code
    // Frontend can build tree structure
    get_coa_categories(db_state)
}

/// Update a COA category
#[tauri::command]
fn update_coa_category(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    parent_id: Option<i64>,
    name: String,
    code: String,
    category_type: String,
) -> Result<CoaCategory, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Calculate level based on parent
    let level = if let Some(pid) = parent_id {
        let parent_level_sql = "SELECT level FROM coa_categories WHERE id = ?";
        let parent_levels = db
            .query(parent_level_sql, one_param(pid), |row| {
                Ok(row_get::<i64>(row, 0)?)
            })
            .map_err(|e| format!("Failed to fetch parent level: {}", e))?;
        parent_levels.first().copied().unwrap_or(0) + 1
    } else {
        0
    };

    let update_sql = "UPDATE coa_categories SET parent_id = ?, name = ?, code = ?, category_type = ?, level = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sql, (
        &parent_id,
        &name,
        &code,
        &category_type,
        &level,
        &id,
    ))
        .map_err(|e| format!("Failed to update COA category: {}", e))?;

    // Get the updated category
    let category_sql = "SELECT id, parent_id, name, code, category_type, level, created_at, updated_at FROM coa_categories WHERE id = ?";
    let categories = db
        .query(category_sql, one_param(id), |row| {
            Ok(CoaCategory {
                id: row_get(row, 0)?,
                parent_id: row_get(row, 1)?,
                name: row_get(row, 2)?,
                code: row_get(row, 3)?,
                category_type: row_get(row, 4)?,
                level: row_get(row, 5)?,
                created_at: row_get_string_or_datetime(row, 6)?,
                updated_at: row_get_string_or_datetime(row, 7)?,
            })
        })
        .map_err(|e| format!("Failed to fetch COA category: {}", e))?;

    if let Some(category) = categories.first() {
        Ok(category.clone())
    } else {
        Err("COA category not found".to_string())
    }
}

/// Delete a COA category
#[tauri::command]
fn delete_coa_category(db_state: State<'_, Mutex<Option<Database>>>, id: i64) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Check if category has children
    let children_sql = "SELECT COUNT(*) FROM coa_categories WHERE parent_id = ?";
    let children_count: i64 = db
        .query(children_sql, one_param(id), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to check children: {}", e))?
        .first()
        .copied()
        .unwrap_or(0);

    if children_count > 0 {
        return Err("Cannot delete category with child categories".to_string());
    }

    // Check if category has accounts
    let accounts_sql = "SELECT COUNT(*) FROM accounts WHERE coa_category_id = ?";
    let accounts_count: i64 = db
        .query(accounts_sql, one_param(id), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to check accounts: {}", e))?
        .first()
        .copied()
        .unwrap_or(0);

    if accounts_count > 0 {
        return Err("Cannot delete category with assigned accounts".to_string());
    }

    let delete_sql = "DELETE FROM coa_categories WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete COA category: {}", e))?;

    Ok("COA category deleted successfully".to_string())
}

/// Initialize all standard COA categories
#[tauri::command]
fn init_standard_coa_categories(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Check if categories already exist
    let check_sql = "SELECT COUNT(*) FROM coa_categories";
    let count: i64 = db
        .query(check_sql, (), |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to check categories: {}", e))?
        .first()
        .copied()
        .unwrap_or(0);

    if count > 0 {
        return Ok("COA categories already initialized".to_string());
    }

    // Helper function to insert category and return its ID
    let insert_category = |parent_id: Option<i64>, name: &str, code: &str, category_type: &str, level: i64| -> Result<i64, String> {
        let insert_sql = "INSERT INTO coa_categories (parent_id, name, code, category_type, level) VALUES (?, ?, ?, ?, ?)";
        let insert_params: Vec<Value> = vec![
            parent_id.map(Value::Int).unwrap_or(Value::NULL),
            Value::from(name),
            Value::from(code),
            Value::from(category_type),
            Value::Int(level),
        ];
        db.execute(insert_sql, insert_params)
        .map_err(|e| format!("Failed to insert COA category {}: {}", code, e))?;

        let get_id_sql = "SELECT id FROM coa_categories WHERE code = ? ORDER BY id DESC LIMIT 1";
        let ids: Vec<i64> = db
            .query(get_id_sql, one_param(code), |row| Ok(row_get::<i64>(row, 0)?))
            .map_err(|e| format!("Failed to get category ID: {}", e))?;
        
        ids.first().copied().ok_or_else(|| format!("Failed to retrieve category ID for {}", code))
    };

    // Assets (دارایی‌ها) - Level 0
    let assets_id = insert_category(None, "دارایی‌ها", "1", "Asset", 0)?;
    
    // Current Assets (دارایی‌های جاری) - Level 1
    let current_assets_id = insert_category(Some(assets_id), "دارایی‌های جاری", "11", "Asset", 1)?;
    insert_category(Some(current_assets_id), "موجودی نقد", "111", "Asset", 2)?;
    insert_category(Some(current_assets_id), "بانک‌ها", "112", "Asset", 2)?;
    insert_category(Some(current_assets_id), "حساب‌های دریافتنی", "113", "Asset", 2)?;
    insert_category(Some(current_assets_id), "پیش‌پرداخت‌ها", "114", "Asset", 2)?;
    insert_category(Some(current_assets_id), "موجودی کالا", "115", "Asset", 2)?;
    
    // Fixed Assets (دارایی‌های ثابت) - Level 1
    let fixed_assets_id = insert_category(Some(assets_id), "دارایی‌های ثابت", "12", "Asset", 1)?;
    insert_category(Some(fixed_assets_id), "زمین و ساختمان", "121", "Asset", 2)?;
    insert_category(Some(fixed_assets_id), "ماشین‌آلات و تجهیزات", "122", "Asset", 2)?;
    insert_category(Some(fixed_assets_id), "وسایل نقلیه", "123", "Asset", 2)?;
    insert_category(Some(fixed_assets_id), "اثاثیه و لوازم", "124", "Asset", 2)?;
    insert_category(Some(fixed_assets_id), "استهلاک انباشته", "125", "Asset", 2)?;
    
    // Other Assets (سایر دارایی‌ها) - Level 1
    let other_assets_id = insert_category(Some(assets_id), "سایر دارایی‌ها", "13", "Asset", 1)?;
    insert_category(Some(other_assets_id), "سرمایه‌گذاری‌ها", "131", "Asset", 2)?;
    insert_category(Some(other_assets_id), "دارایی‌های نامشهود", "132", "Asset", 2)?;
    
    // Liabilities (بدهی‌ها) - Level 0
    let liabilities_id = insert_category(None, "بدهی‌ها", "2", "Liability", 0)?;
    
    // Current Liabilities (بدهی‌های جاری) - Level 1
    let current_liabilities_id = insert_category(Some(liabilities_id), "بدهی‌های جاری", "21", "Liability", 1)?;
    insert_category(Some(current_liabilities_id), "حساب‌های پرداختنی", "211", "Liability", 2)?;
    insert_category(Some(current_liabilities_id), "وام‌های کوتاه‌مدت", "212", "Liability", 2)?;
    insert_category(Some(current_liabilities_id), "پیش‌دریافت‌ها", "213", "Liability", 2)?;
    insert_category(Some(current_liabilities_id), "بدهی‌های مالیاتی", "214", "Liability", 2)?;
    insert_category(Some(current_liabilities_id), "حقوق و دستمزد پرداختنی", "215", "Liability", 2)?;
    
    // Long-term Liabilities (بدهی‌های بلندمدت) - Level 1
    let long_term_liabilities_id = insert_category(Some(liabilities_id), "بدهی‌های بلندمدت", "22", "Liability", 1)?;
    insert_category(Some(long_term_liabilities_id), "وام‌های بلندمدت", "221", "Liability", 2)?;
    insert_category(Some(long_term_liabilities_id), "اوراق قرضه", "222", "Liability", 2)?;
    
    // Equity (حقوق صاحبان سهام) - Level 0
    let equity_id = insert_category(None, "حقوق صاحبان سهام", "3", "Equity", 0)?;
    
    // Capital (سرمایه) - Level 1
    let capital_id = insert_category(Some(equity_id), "سرمایه", "31", "Equity", 1)?;
    insert_category(Some(capital_id), "سرمایه اولیه", "311", "Equity", 2)?;
    insert_category(Some(capital_id), "افزایش سرمایه", "312", "Equity", 2)?;
    
    // Retained Earnings (سود انباشته) - Level 1
    let retained_earnings_id = insert_category(Some(equity_id), "سود انباشته", "32", "Equity", 1)?;
    insert_category(Some(retained_earnings_id), "سود سال جاری", "321", "Equity", 2)?;
    insert_category(Some(retained_earnings_id), "سود سال‌های قبل", "322", "Equity", 2)?;
    
    // Reserves (ذخایر) - Level 1
    insert_category(Some(equity_id), "ذخایر", "33", "Equity", 1)?;
    
    // Revenue (درآمدها) - Level 0
    let revenue_id = insert_category(None, "درآمدها", "4", "Revenue", 0)?;
    
    // Operating Revenue (درآمدهای عملیاتی) - Level 1
    let operating_revenue_id = insert_category(Some(revenue_id), "درآمدهای عملیاتی", "41", "Revenue", 1)?;
    insert_category(Some(operating_revenue_id), "فروش کالا", "411", "Revenue", 2)?;
    insert_category(Some(operating_revenue_id), "فروش خدمات", "412", "Revenue", 2)?;
    
    // Other Revenue (درآمدهای دیگر) - Level 1
    let other_revenue_id = insert_category(Some(revenue_id), "درآمدهای دیگر", "42", "Revenue", 1)?;
    insert_category(Some(other_revenue_id), "درآمد سود بانکی", "421", "Revenue", 2)?;
    insert_category(Some(other_revenue_id), "درآمد سود سرمایه‌گذاری", "422", "Revenue", 2)?;
    insert_category(Some(other_revenue_id), "سایر درآمدها", "423", "Revenue", 2)?;
    
    // Expenses (هزینه‌ها) - Level 0
    let expenses_id = insert_category(None, "هزینه‌ها", "5", "Expense", 0)?;
    
    // Operating Expenses (هزینه‌های عملیاتی) - Level 1
    let operating_expenses_id = insert_category(Some(expenses_id), "هزینه‌های عملیاتی", "51", "Expense", 1)?;
    insert_category(Some(operating_expenses_id), "بهای تمام شده کالای فروش رفته", "511", "Expense", 2)?;
    insert_category(Some(operating_expenses_id), "هزینه خرید", "512", "Expense", 2)?;
    insert_category(Some(operating_expenses_id), "هزینه حقوق و دستمزد", "513", "Expense", 2)?;
    insert_category(Some(operating_expenses_id), "هزینه اجاره", "514", "Expense", 2)?;
    insert_category(Some(operating_expenses_id), "هزینه آب و برق", "515", "Expense", 2)?;
    insert_category(Some(operating_expenses_id), "هزینه حمل و نقل", "516", "Expense", 2)?;
    insert_category(Some(operating_expenses_id), "هزینه تبلیغات", "517", "Expense", 2)?;
    insert_category(Some(operating_expenses_id), "هزینه استهلاک", "518", "Expense", 2)?;
    
    // Administrative Expenses (هزینه‌های اداری) - Level 1
    let admin_expenses_id = insert_category(Some(expenses_id), "هزینه‌های اداری", "52", "Expense", 1)?;
    insert_category(Some(admin_expenses_id), "هزینه‌های عمومی", "521", "Expense", 2)?;
    
    // Financial Expenses (هزینه‌های مالی) - Level 1
    let financial_expenses_id = insert_category(Some(expenses_id), "هزینه‌های مالی", "53", "Expense", 1)?;
    insert_category(Some(financial_expenses_id), "هزینه بهره", "531", "Expense", 2)?;
    
    // Other Expenses (سایر هزینه‌ها) - Level 1
    insert_category(Some(expenses_id), "سایر هزینه‌ها", "54", "Expense", 1)?;

    Ok("Standard COA categories initialized successfully".to_string())
}

// Account Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: i64,
    pub name: String,
    pub currency_id: Option<i64>,
    pub coa_category_id: Option<i64>,
    pub account_code: Option<String>,
    pub account_type: Option<String>,
    pub initial_balance: f64,
    pub current_balance: f64,
    pub is_active: bool,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// Account Transaction Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountTransaction {
    pub id: i64,
    pub account_id: i64,
    pub transaction_type: String, // 'deposit' or 'withdraw'
    pub amount: f64,
    pub currency: String,
    pub rate: f64,
    pub total: f64,
    pub transaction_date: String,
    pub is_full: bool,
    pub notes: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize accounts table (schema from db.sql on first open).
#[tauri::command]
fn init_accounts_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Initialize account transactions table (schema from db.sql on first open).
#[tauri::command]
fn init_account_transactions_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let _db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let _ = _db_guard.as_ref().ok_or("No database is currently open")?;
    Ok("OK".to_string())
}

/// Create a new account
#[tauri::command]
fn create_account(
    db_state: State<'_, Mutex<Option<Database>>>,
    name: String,
    currency_id: Option<i64>,
    coa_category_id: Option<i64>,
    account_code: Option<String>,
    account_type: Option<String>,
    initial_balance: f64,
    notes: Option<String>,
) -> Result<Account, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    // Convert empty strings to None to avoid UNIQUE constraint violations
    let code_str: Option<&str> = account_code.as_ref()
        .and_then(|s| if s.trim().is_empty() { None } else { Some(s.as_str()) });
    let type_str: Option<&str> = account_type.as_ref().map(|s| s.as_str());
    let is_active_int = 1i64;

    let insert_sql = "INSERT INTO accounts (name, currency_id, coa_category_id, account_code, account_type, initial_balance, current_balance, is_active, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, (
        &name,
        &currency_id,
        &coa_category_id,
        &code_str,
        &type_str,
        &initial_balance,
        &initial_balance,
        &is_active_int,
        &notes_str,
    ))
        .map_err(|e| format!("Failed to insert account: {}", e))?;

    // Get the created account ID first
    let account_id_sql = "SELECT id FROM accounts WHERE name = ? ORDER BY id DESC LIMIT 1";
    let account_ids = db
        .query(account_id_sql, one_param(name.as_str()), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to get account ID: {}", e))?;
    let account_id = account_ids.first().ok_or("Failed to get account ID")?;

    // Initialize currency balance if currency_id is provided
    if let Some(cid) = currency_id {
        update_account_currency_balance_internal(db, *account_id, cid, initial_balance)?;
    }

    // Get the created account
    let account_sql = "SELECT id, name, currency_id, coa_category_id, account_code, account_type, initial_balance, current_balance, is_active, notes, created_at, updated_at FROM accounts WHERE name = ? ORDER BY id DESC LIMIT 1";
    let accounts = db
        .query(account_sql, one_param(name.as_str()), |row| {
            Ok(Account {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                currency_id: row_get(row, 2)?,
                coa_category_id: row_get(row, 3)?,
                account_code: row_get(row, 4)?,
                account_type: row_get(row, 5)?,
                initial_balance: row_get(row, 6)?,
                current_balance: row_get(row, 7)?,
                is_active: row_get::<i64>(row, 8)? != 0,
                notes: row_get(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch account: {}", e))?;

    if let Some(account) = accounts.first() {
        Ok(account.clone())
    } else {
        Err("Failed to retrieve created account".to_string())
    }
}

/// Get all accounts
#[tauri::command]
fn get_accounts(db_state: State<'_, Mutex<Option<Database>>>) -> Result<Vec<Account>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, name, currency_id, coa_category_id, account_code, account_type, initial_balance, current_balance, is_active, notes, created_at, updated_at FROM accounts ORDER BY name";
    let accounts = db
        .query(sql, (), |row| {
            Ok(Account {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                currency_id: row_get(row, 2)?,
                coa_category_id: row_get(row, 3)?,
                account_code: row_get(row, 4)?,
                account_type: row_get(row, 5)?,
                initial_balance: row_get(row, 6)?,
                current_balance: row_get(row, 7)?,
                is_active: row_get::<i64>(row, 8)? != 0,
                notes: row_get(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch accounts: {}", e))?;

    Ok(accounts)
}

/// Get a single account
#[tauri::command]
fn get_account(db_state: State<'_, Mutex<Option<Database>>>, id: i64) -> Result<Account, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, name, currency_id, coa_category_id, account_code, account_type, initial_balance, current_balance, is_active, notes, created_at, updated_at FROM accounts WHERE id = ?";
    let accounts = db
        .query(sql, one_param(id), |row| {
            Ok(Account {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                currency_id: row_get(row, 2)?,
                coa_category_id: row_get(row, 3)?,
                account_code: row_get(row, 4)?,
                account_type: row_get(row, 5)?,
                initial_balance: row_get(row, 6)?,
                current_balance: row_get(row, 7)?,
                is_active: row_get::<i64>(row, 8)? != 0,
                notes: row_get(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch account: {}", e))?;

    if let Some(account) = accounts.first() {
        Ok(account.clone())
    } else {
        Err("Account not found".to_string())
    }
}

/// Update an account
#[tauri::command]
fn update_account(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    name: String,
    currency_id: Option<i64>,
    coa_category_id: Option<i64>,
    account_code: Option<String>,
    account_type: Option<String>,
    initial_balance: f64,
    is_active: bool,
    notes: Option<String>,
) -> Result<Account, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    // Convert empty strings to None to avoid UNIQUE constraint violations
    let code_str: Option<&str> = account_code.as_ref()
        .and_then(|s| if s.trim().is_empty() { None } else { Some(s.as_str()) });
    let type_str: Option<&str> = account_type.as_ref().map(|s| s.as_str());
    let is_active_int = if is_active { 1i64 } else { 0i64 };

    let update_sql = "UPDATE accounts SET name = ?, currency_id = ?, coa_category_id = ?, account_code = ?, account_type = ?, initial_balance = ?, is_active = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sql, (
        &name,
        &currency_id,
        &coa_category_id,
        &code_str,
        &type_str,
        &initial_balance,
        &is_active_int,
        &notes_str,
        &id,
    ))
        .map_err(|e| format!("Failed to update account: {}", e))?;

    // Recalculate current balance
    let balance = calculate_account_balance_internal(db, id)?;
    let update_balance_sql = "UPDATE accounts SET current_balance = ? WHERE id = ?";
    db.execute(update_balance_sql, (balance, id))
        .map_err(|e| format!("Failed to update account balance: {}", e))?;

    // Get the updated account directly
    let account_sql = "SELECT id, name, currency_id, coa_category_id, account_code, account_type, initial_balance, current_balance, is_active, notes, created_at, updated_at FROM accounts WHERE id = ?";
    let accounts = db
        .query(account_sql, one_param(id), |row| {
            Ok(Account {
                id: row_get(row, 0)?,
                name: row_get(row, 1)?,
                currency_id: row_get(row, 2)?,
                coa_category_id: row_get(row, 3)?,
                account_code: row_get(row, 4)?,
                account_type: row_get(row, 5)?,
                initial_balance: row_get(row, 6)?,
                current_balance: row_get(row, 7)?,
                is_active: row_get::<i64>(row, 8)? != 0,
                notes: row_get(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch account: {}", e))?;

    if let Some(account) = accounts.first() {
        Ok(account.clone())
    } else {
        Err("Account not found".to_string())
    }
}

/// Delete an account
#[tauri::command]
fn delete_account(db_state: State<'_, Mutex<Option<Database>>>, id: i64) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM accounts WHERE id = ?";
    db.execute(delete_sql, one_param(id))
        .map_err(|e| format!("Failed to delete account: {}", e))?;

    Ok("Account deleted successfully".to_string())
}

/// Calculate account balance (internal helper)
fn calculate_account_balance_internal(db: &Database, account_id: i64) -> Result<f64, String> {
    // Get initial balance
    let initial_balance_sql = "SELECT initial_balance FROM accounts WHERE id = ?";
    let initial_balances = db
        .query(initial_balance_sql, one_param(account_id), |row| {
            Ok(row_get::<f64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to fetch initial balance: {}", e))?;

    let initial_balance = initial_balances.first().copied().unwrap_or(0.0);

    // Calculate sum of deposits
    let deposits_sql = "SELECT COALESCE(SUM(total), 0) FROM account_transactions WHERE account_id = ? AND transaction_type = 'deposit'";
    let deposits = db
        .query(deposits_sql, one_param(account_id), |row| {
            Ok(row_get::<f64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to calculate deposits: {}", e))?;

    let total_deposits = deposits.first().copied().unwrap_or(0.0);

    // Calculate sum of withdrawals
    let withdrawals_sql = "SELECT COALESCE(SUM(total), 0) FROM account_transactions WHERE account_id = ? AND transaction_type = 'withdraw'";
    let withdrawals = db
        .query(withdrawals_sql, one_param(account_id), |row| {
            Ok(row_get::<f64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to calculate withdrawals: {}", e))?;

    let total_withdrawals = withdrawals.first().copied().unwrap_or(0.0);

    // Current balance = initial_balance + deposits - withdrawals
    Ok(initial_balance + total_deposits - total_withdrawals)
}

/// Get account balance
#[tauri::command]
fn get_account_balance(db_state: State<'_, Mutex<Option<Database>>>, account_id: i64) -> Result<f64, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    calculate_account_balance_internal(db, account_id)
}

/// Deposit to account
#[tauri::command]
fn deposit_account(
    db_state: State<'_, Mutex<Option<Database>>>,
    account_id: i64,
    amount: f64,
    currency: String,
    rate: f64,
    transaction_date: String,
    is_full: bool,
    notes: Option<String>,
) -> Result<AccountTransaction, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let final_amount = if is_full {
        // Get current balance and deposit all of it
        let current_balance = calculate_account_balance_internal(db, account_id)?;
        if current_balance <= 0.0 {
            return Err("Account has no balance to deposit".to_string());
        }
        current_balance
    } else {
        if amount <= 0.0 {
            return Err("Deposit amount must be greater than 0".to_string());
        }
        amount
    };

    let total = final_amount * rate;
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    let is_full_int = if is_full { 1 } else { 0 };

    // Get currency ID from currency name
    let currency_id_sql = "SELECT id FROM currencies WHERE name = ? LIMIT 1";
    let currency_ids = db
        .query(currency_id_sql, one_param(currency.as_str()), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to get currency ID: {}", e))?;
    let currency_id = currency_ids.first().ok_or("Currency not found")?;

    // Insert transaction
    let insert_sql = "INSERT INTO account_transactions (account_id, transaction_type, amount, currency, rate, total, transaction_date, is_full, notes) VALUES (?, 'deposit', ?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, (
        &account_id,
        &final_amount,
        &currency,
        &rate,
        &total,
        &transaction_date,
        &is_full_int,
        &notes_str,
    ))
        .map_err(|e| format!("Failed to insert deposit transaction: {}", e))?;

    // Update account currency balance
    let current_currency_balance = get_account_balance_by_currency_internal(db, account_id, *currency_id)?;
    let new_currency_balance = current_currency_balance + final_amount;
    update_account_currency_balance_internal(db, account_id, *currency_id, new_currency_balance)?;

    // Update account balance
    let new_balance = calculate_account_balance_internal(db, account_id)?;
    let update_balance_sql = "UPDATE accounts SET current_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_balance_sql, (new_balance, account_id))
        .map_err(|e| format!("Failed to update account balance: {}", e))?;

    // Create journal entry: Debit Account, Credit Cash/Source
    let cash_account_sql = "SELECT id FROM accounts WHERE account_type = 'Asset' AND (name LIKE '%Cash%' OR name LIKE '%Bank%') LIMIT 1";
    let cash_accounts = db.query(cash_account_sql, (), |row| Ok(row_get::<i64>(row, 0)?))
        .ok()
        .and_then(|v| v.first().copied());

    if let Some(cash_account) = cash_accounts {
        let journal_lines = vec![
            (account_id, *currency_id, total, 0.0, rate, notes.clone()),
            (cash_account, *currency_id, 0.0, total, rate, notes.clone()),
        ];
        let _ = create_journal_entry_internal(db, &transaction_date, notes.clone(), Some("account_deposit".to_string()), None, journal_lines);
    }

    // Get the created transaction
    let transaction_sql = "SELECT id, account_id, transaction_type, amount, currency, rate, total, transaction_date, is_full, notes, created_at, updated_at FROM account_transactions WHERE account_id = ? AND transaction_type = 'deposit' ORDER BY id DESC LIMIT 1";
    let transactions = db
        .query(transaction_sql, one_param(account_id), |row| {
            Ok(AccountTransaction {
                id: row_get(row, 0)?,
                account_id: row_get(row, 1)?,
                transaction_type: row_get(row, 2)?,
                amount: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                total: row_get(row, 6)?,
                transaction_date: row_get(row, 7)?,
                is_full: row_get::<i64>(row, 8)? != 0,
                notes: row_get(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch transaction: {}", e))?;

    if let Some(transaction) = transactions.first() {
        Ok(transaction.clone())
    } else {
        Err("Failed to retrieve created transaction".to_string())
    }
}

/// Withdraw from account
#[tauri::command]
fn withdraw_account(
    db_state: State<'_, Mutex<Option<Database>>>,
    account_id: i64,
    amount: f64,
    currency: String,
    rate: f64,
    transaction_date: String,
    is_full: bool,
    notes: Option<String>,
) -> Result<AccountTransaction, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let current_balance = calculate_account_balance_internal(db, account_id)?;

    let final_amount = if is_full {
        // Withdraw all available balance
        if current_balance <= 0.0 {
            return Err("Account has no balance to withdraw".to_string());
        }
        current_balance
    } else {
        if amount <= 0.0 {
            return Err("Withdrawal amount must be greater than 0".to_string());
        }
        // Check if sufficient balance
        let withdrawal_total = amount * rate;
        if withdrawal_total > current_balance {
            return Err("Insufficient balance for withdrawal".to_string());
        }
        amount
    };

    let total = final_amount * rate;
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    let is_full_int = if is_full { 1 } else { 0 };

    // Get currency ID from currency name
    let currency_id_sql = "SELECT id FROM currencies WHERE name = ? LIMIT 1";
    let currency_ids = db
        .query(currency_id_sql, one_param(currency.as_str()), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to get currency ID: {}", e))?;
    let currency_id = currency_ids.first().ok_or("Currency not found")?;

    // Insert transaction
    let insert_sql = "INSERT INTO account_transactions (account_id, transaction_type, amount, currency, rate, total, transaction_date, is_full, notes) VALUES (?, 'withdraw', ?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, (
        &account_id,
        &final_amount,
        &currency,
        &rate,
        &total,
        &transaction_date,
        &is_full_int,
        &notes_str,
    ))
        .map_err(|e| format!("Failed to insert withdrawal transaction: {}", e))?;

    // Update account currency balance
    let current_currency_balance = get_account_balance_by_currency_internal(db, account_id, *currency_id)?;
    let new_currency_balance = current_currency_balance - final_amount;
    update_account_currency_balance_internal(db, account_id, *currency_id, new_currency_balance)?;

    // Update account balance
    let new_balance = calculate_account_balance_internal(db, account_id)?;
    let update_balance_sql = "UPDATE accounts SET current_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_balance_sql, (new_balance, account_id))
        .map_err(|e| format!("Failed to update account balance: {}", e))?;

    // Create journal entry: Debit Expense/Cash, Credit Account
    let expense_account_sql = "SELECT id FROM accounts WHERE account_type = 'Expense' LIMIT 1";
    let expense_accounts = db.query(expense_account_sql, (), |row| Ok(row_get::<i64>(row, 0)?))
        .ok()
        .and_then(|v| v.first().copied());

    if let Some(expense_account) = expense_accounts {
        let journal_lines = vec![
            (expense_account, *currency_id, total, 0.0, rate, notes.clone()),
            (account_id, *currency_id, 0.0, total, rate, notes.clone()),
        ];
        let _ = create_journal_entry_internal(db, &transaction_date, notes.clone(), Some("account_withdraw".to_string()), None, journal_lines);
    }

    // Get the created transaction
    let transaction_sql = "SELECT id, account_id, transaction_type, amount, currency, rate, total, transaction_date, is_full, notes, created_at, updated_at FROM account_transactions WHERE account_id = ? AND transaction_type = 'withdraw' ORDER BY id DESC LIMIT 1";
    let transactions = db
        .query(transaction_sql, one_param(account_id), |row| {
            Ok(AccountTransaction {
                id: row_get(row, 0)?,
                account_id: row_get(row, 1)?,
                transaction_type: row_get(row, 2)?,
                amount: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                total: row_get(row, 6)?,
                transaction_date: row_get(row, 7)?,
                is_full: row_get::<i64>(row, 8)? != 0,
                notes: row_get(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch transaction: {}", e))?;

    if let Some(transaction) = transactions.first() {
        Ok(transaction.clone())
    } else {
        Err("Failed to retrieve created transaction".to_string())
    }
}

/// Get account transactions
#[tauri::command]
fn get_account_transactions(
    db_state: State<'_, Mutex<Option<Database>>>,
    account_id: i64,
) -> Result<Vec<AccountTransaction>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, account_id, transaction_type, amount, currency, rate, total, transaction_date, is_full, notes, created_at, updated_at FROM account_transactions WHERE account_id = ? ORDER BY transaction_date DESC, created_at DESC";
    let transactions = db
        .query(sql, one_param(account_id), |row| {
            Ok(AccountTransaction {
                id: row_get(row, 0)?,
                account_id: row_get(row, 1)?,
                transaction_type: row_get(row, 2)?,
                amount: row_get(row, 3)?,
                currency: row_get(row, 4)?,
                rate: row_get(row, 5)?,
                total: row_get(row, 6)?,
                transaction_date: row_get(row, 7)?,
                is_full: row_get::<i64>(row, 8)? != 0,
                notes: row_get(row, 9)?,
                created_at: row_get_string_or_datetime(row, 10)?,
                updated_at: row_get_string_or_datetime(row, 11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch transactions: {}", e))?;

    Ok(transactions)
}

/// Get account balance by currency
#[tauri::command]
fn get_account_balance_by_currency(
    db_state: State<'_, Mutex<Option<Database>>>,
    account_id: i64,
    currency_id: i64,
) -> Result<f64, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT balance FROM account_currency_balances WHERE account_id = ? AND currency_id = ?";
    let balances = db
        .query(sql, (account_id, currency_id), |row| {
            Ok(row_get::<f64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to fetch account balance: {}", e))?;

    Ok(balances.first().copied().unwrap_or(0.0))
}

/// Get all currency balances for an account
#[tauri::command]
fn get_all_account_balances(
    db_state: State<'_, Mutex<Option<Database>>>,
    account_id: i64,
) -> Result<Vec<AccountCurrencyBalance>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, account_id, currency_id, balance, updated_at FROM account_currency_balances WHERE account_id = ?";
    let balances = db
        .query(sql, one_param(account_id), |row| {
            Ok(AccountCurrencyBalance {
                id: row_get(row, 0)?,
                account_id: row_get(row, 1)?,
                currency_id: row_get(row, 2)?,
                balance: row_get(row, 3)?,
                updated_at: row_get_string_or_datetime(row, 4)?,
            })
        })
        .map_err(|e| format!("Failed to fetch account balances: {}", e))?;

    Ok(balances)
}

/// Update account currency balance (internal function)
fn update_account_currency_balance_internal(
    db: &Database,
    account_id: i64,
    currency_id: i64,
    balance: f64,
) -> Result<(), String> {
    let upsert_sql = "
        INSERT INTO account_currency_balances (account_id, currency_id, balance, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
            balance = VALUES(balance),
            updated_at = CURRENT_TIMESTAMP
    ";
    db.execute(upsert_sql, (
        &account_id,
        &currency_id,
        &balance,
    ))
        .map_err(|e| format!("Failed to update account currency balance: {}", e))?;
    Ok(())
}

/// Internal helper to create journal entry (not exposed as command)
fn create_journal_entry_internal(
    db: &Database,
    entry_date: &str,
    description: Option<String>,
    reference_type: Option<String>,
    reference_id: Option<i64>,
    lines: Vec<(i64, i64, f64, f64, f64, Option<String>)>, // (account_id, currency_id, debit_amount, credit_amount, exchange_rate, description)
) -> Result<i64, String> {
    // Balance validation removed - entries can be saved unbalanced and balanced later with updates

    // Generate entry number
    let entry_number_sql = "SELECT COALESCE(MAX(CAST(SUBSTR(entry_number, 2) AS INTEGER)), 0) + 1 FROM journal_entries WHERE entry_number LIKE 'J%'";
    let entry_numbers = db
        .query(entry_number_sql, (), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to generate entry number: {}", e))?;
    let entry_number = format!("J{:06}", entry_numbers.first().copied().unwrap_or(1));

    let desc_str: Option<&str> = description.as_ref().map(|s| s.as_str());
    let ref_type_str: Option<&str> = reference_type.as_ref().map(|s| s.as_str());

    // Insert journal entry
    let insert_sql = "INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?)";
    db.execute(insert_sql, (
        &entry_number,
        &entry_date,
        &desc_str,
        &ref_type_str,
        &reference_id,
    ))
        .map_err(|e| format!("Failed to insert journal entry: {}", e))?;

    // Get the created entry ID
    let entry_id_sql = "SELECT id FROM journal_entries WHERE entry_number = ?";
    let entry_ids = db
        .query(entry_id_sql, one_param(entry_number.as_str()), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to fetch entry ID: {}", e))?;
    let entry_id = entry_ids.first().ok_or("Failed to retrieve entry ID")?;

    // Insert journal entry lines
    for (account_id, currency_id, debit_amount, credit_amount, exchange_rate, line_desc) in lines {
        let base_amount = if debit_amount > 0.0 {
            debit_amount * exchange_rate
        } else {
            credit_amount * exchange_rate
        };
        let line_desc_str: Option<&str> = line_desc.as_ref().map(|s| s.as_str());

        let insert_line_sql = "INSERT INTO journal_entry_lines (journal_entry_id, account_id, currency_id, debit_amount, credit_amount, exchange_rate, base_amount, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
        db.execute(insert_line_sql, (
            entry_id,
            &account_id,
            &currency_id,
            &debit_amount,
            &credit_amount,
            &exchange_rate,
            &base_amount,
            &line_desc_str,
        ))
            .map_err(|e| format!("Failed to insert journal entry line: {}", e))?;

        // Update account currency balance
        let current_balance = get_account_balance_by_currency_internal(db, account_id, currency_id)?;
        let new_balance = if debit_amount > 0.0 {
            current_balance + debit_amount
        } else {
            current_balance - credit_amount
        };
        update_account_currency_balance_internal(db, account_id, currency_id, new_balance)?;
    }

    Ok(*entry_id)
}

/// Create a journal entry with lines
#[tauri::command]
fn create_journal_entry(
    db_state: State<'_, Mutex<Option<Database>>>,
    entry_date: String,
    description: Option<String>,
    reference_type: Option<String>,
    reference_id: Option<i64>,
    lines: Vec<(i64, i64, f64, f64, f64, Option<String>)>, // (account_id, currency_id, debit_amount, credit_amount, exchange_rate, description)
) -> Result<JournalEntry, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Balance validation removed - entries can be saved unbalanced and balanced later with updates

    // Generate entry number
    let entry_number_sql = "SELECT COALESCE(MAX(CAST(SUBSTR(entry_number, 2) AS INTEGER)), 0) + 1 FROM journal_entries WHERE entry_number LIKE 'J%'";
    let entry_numbers = db
        .query(entry_number_sql, (), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to generate entry number: {}", e))?;
    let entry_number = format!("J{:06}", entry_numbers.first().copied().unwrap_or(1));

    let desc_str: Option<&str> = description.as_ref().map(|s| s.as_str());
    let ref_type_str: Option<&str> = reference_type.as_ref().map(|s| s.as_str());

    // Insert journal entry
    let insert_sql = "INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?)";
    db.execute(insert_sql, (
        &entry_number,
        &entry_date,
        &desc_str,
        &ref_type_str,
        &reference_id,
    ))
        .map_err(|e| format!("Failed to insert journal entry: {}", e))?;

    // Get the created entry ID
    let entry_id_sql = "SELECT id FROM journal_entries WHERE entry_number = ?";
    let entry_ids = db
        .query(entry_id_sql, one_param(entry_number.as_str()), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to fetch entry ID: {}", e))?;
    let entry_id = entry_ids.first().ok_or("Failed to retrieve entry ID")?;

    // Insert journal entry lines
    for (account_id, currency_id, debit_amount, credit_amount, exchange_rate, line_desc) in lines {
        let base_amount = if debit_amount > 0.0 {
            debit_amount * exchange_rate
        } else {
            credit_amount * exchange_rate
        };
        let line_desc_str: Option<&str> = line_desc.as_ref().map(|s| s.as_str());

        let insert_line_sql = "INSERT INTO journal_entry_lines (journal_entry_id, account_id, currency_id, debit_amount, credit_amount, exchange_rate, base_amount, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
        db.execute(insert_line_sql, (
            entry_id,
            &account_id,
            &currency_id,
            &debit_amount,
            &credit_amount,
            &exchange_rate,
            &base_amount,
            &line_desc_str,
        ))
            .map_err(|e| format!("Failed to insert journal entry line: {}", e))?;

        // Update account currency balance
        let current_balance = get_account_balance_by_currency_internal(db, account_id, currency_id)?;
        let new_balance = if debit_amount > 0.0 {
            current_balance + debit_amount
        } else {
            current_balance - credit_amount
        };
        update_account_currency_balance_internal(db, account_id, currency_id, new_balance)?;
    }

    // Get the created entry
    let entry_sql = "SELECT id, entry_number, entry_date, description, reference_type, reference_id, created_at, updated_at FROM journal_entries WHERE id = ?";
    let entries = db
        .query(entry_sql, one_param(entry_id), |row| {
            Ok(JournalEntry {
                id: row_get(row, 0)?,
                entry_number: row_get(row, 1)?,
                entry_date: row_get(row, 2)?,
                description: row_get(row, 3)?,
                reference_type: row_get(row, 4)?,
                reference_id: row_get(row, 5)?,
                created_at: row_get_string_or_datetime(row, 6)?,
                updated_at: row_get_string_or_datetime(row, 7)?,
            })
        })
        .map_err(|e| format!("Failed to fetch journal entry: {}", e))?;

    if let Some(entry) = entries.first() {
        Ok(entry.clone())
    } else {
        Err("Failed to retrieve created journal entry".to_string())
    }
}

/// Internal helper to get account balance by currency
fn get_account_balance_by_currency_internal(
    db: &Database,
    account_id: i64,
    currency_id: i64,
) -> Result<f64, String> {
    let sql = "SELECT balance FROM account_currency_balances WHERE account_id = ? AND currency_id = ?";
    let balances = db
        .query(sql, (account_id, currency_id), |row| {
            Ok(row_get::<f64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to fetch account balance: {}", e))?;
    Ok(balances.first().copied().unwrap_or(0.0))
}

/// Get journal entries with pagination
#[tauri::command]
fn get_journal_entries(
    db_state: State<'_, Mutex<Option<Database>>>,
    page: i64,
    per_page: i64,
) -> Result<PaginatedResponse<JournalEntry>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let offset = (page - 1) * per_page;

    // Get total count
    let count_sql = "SELECT COUNT(*) FROM journal_entries";
    let total: i64 = db
        .query(count_sql, (), |row| {
            Ok(row_get::<i64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to count journal entries: {}", e))?
        .first()
        .copied()
        .unwrap_or(0);

    // Get paginated entries
    let sql = "SELECT id, entry_number, entry_date, description, reference_type, reference_id, created_at, updated_at FROM journal_entries ORDER BY entry_date DESC, id DESC LIMIT ? OFFSET ?";
    let entries = db
        .query(sql, (per_page, offset), |row| {
            Ok(JournalEntry {
                id: row_get(row, 0)?,
                entry_number: row_get(row, 1)?,
                entry_date: row_get(row, 2)?,
                description: row_get(row, 3)?,
                reference_type: row_get(row, 4)?,
                reference_id: row_get(row, 5)?,
                created_at: row_get_string_or_datetime(row, 6)?,
                updated_at: row_get_string_or_datetime(row, 7)?,
            })
        })
        .map_err(|e| format!("Failed to fetch journal entries: {}", e))?;

    let total_pages = (total as f64 / per_page as f64).ceil() as i64;

    Ok(PaginatedResponse {
        items: entries,
        total,
        page,
        per_page,
        total_pages,
    })
}

/// Get a single journal entry with lines
#[tauri::command]
fn get_journal_entry(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<(JournalEntry, Vec<JournalEntryLine>), String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Get entry
    let entry_sql = "SELECT id, entry_number, entry_date, description, reference_type, reference_id, created_at, updated_at FROM journal_entries WHERE id = ?";
    let entries = db
        .query(entry_sql, one_param(id), |row| {
            Ok(JournalEntry {
                id: row_get(row, 0)?,
                entry_number: row_get(row, 1)?,
                entry_date: row_get(row, 2)?,
                description: row_get(row, 3)?,
                reference_type: row_get(row, 4)?,
                reference_id: row_get(row, 5)?,
                created_at: row_get_string_or_datetime(row, 6)?,
                updated_at: row_get_string_or_datetime(row, 7)?,
            })
        })
        .map_err(|e| format!("Failed to fetch journal entry: {}", e))?;

    let entry = entries.first().ok_or("Journal entry not found")?;

    // Get lines
    let lines_sql = "SELECT id, journal_entry_id, account_id, currency_id, debit_amount, credit_amount, exchange_rate, base_amount, description, created_at FROM journal_entry_lines WHERE journal_entry_id = ?";
    let lines = db
        .query(lines_sql, one_param(id), |row| {
            Ok(JournalEntryLine {
                id: row_get(row, 0)?,
                journal_entry_id: row_get(row, 1)?,
                account_id: row_get(row, 2)?,
                currency_id: row_get(row, 3)?,
                debit_amount: row_get(row, 4)?,
                credit_amount: row_get(row, 5)?,
                exchange_rate: row_get(row, 6)?,
                base_amount: row_get(row, 7)?,
                description: row_get(row, 8)?,
                created_at: row_get_string_or_datetime(row, 9)?,
            })
        })
        .map_err(|e| format!("Failed to fetch journal entry lines: {}", e))?;

    Ok((entry.clone(), lines))
}

/// Update a journal entry - add new lines to balance or modify existing lines
#[tauri::command]
fn update_journal_entry(
    db_state: State<'_, Mutex<Option<Database>>>,
    entry_id: i64,
    new_lines: Vec<(i64, i64, f64, f64, f64, Option<String>)>, // (account_id, currency_id, debit_amount, credit_amount, exchange_rate, description)
) -> Result<JournalEntry, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Get existing lines to reverse their account balance changes
    let existing_lines_sql = "SELECT account_id, currency_id, debit_amount, credit_amount FROM journal_entry_lines WHERE journal_entry_id = ?";
    let existing_lines = db
        .query(existing_lines_sql, one_param(entry_id), |row| {
            Ok((
                row_get::<i64>(row, 0)?, // account_id
                row_get::<i64>(row, 1)?, // currency_id
                row_get::<f64>(row, 2)?, // debit_amount
                row_get::<f64>(row, 3)?, // credit_amount
            ))
        })
        .map_err(|e| format!("Failed to fetch existing lines: {}", e))?;

    // Reverse account balance changes from existing lines
    for (account_id, currency_id, old_debit, old_credit) in existing_lines.iter() {
        let current_balance = get_account_balance_by_currency_internal(db, *account_id, *currency_id)?;
        // Reverse: if it was a debit, subtract it; if it was a credit, add it back
        let reversed_balance = if *old_debit > 0.0 {
            current_balance - old_debit
        } else {
            current_balance + old_credit
        };
        update_account_currency_balance_internal(db, *account_id, *currency_id, reversed_balance)?;
    }

    // Delete existing lines
    let delete_lines_sql = "DELETE FROM journal_entry_lines WHERE journal_entry_id = ?";
    db.execute(delete_lines_sql, one_param(entry_id))
        .map_err(|e| format!("Failed to delete existing lines: {}", e))?;

    // Insert new lines and update account balances
    for (account_id, currency_id, debit_amount, credit_amount, exchange_rate, line_desc) in new_lines.iter() {
        let base_amount = if *debit_amount > 0.0 {
            debit_amount * exchange_rate
        } else {
            credit_amount * exchange_rate
        };
        let line_desc_str: Option<&str> = line_desc.as_ref().map(|s| s.as_str());

        // Insert new line
        let insert_line_sql = "INSERT INTO journal_entry_lines (journal_entry_id, account_id, currency_id, debit_amount, credit_amount, exchange_rate, base_amount, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
        db.execute(insert_line_sql, (
            &entry_id,
            account_id,
            currency_id,
            debit_amount,
            credit_amount,
            exchange_rate,
            &base_amount,
            &line_desc_str,
        ))
            .map_err(|e| format!("Failed to insert journal entry line: {}", e))?;

        // Update account currency balance
        let current_balance = get_account_balance_by_currency_internal(db, *account_id, *currency_id)?;
        let new_balance = if *debit_amount > 0.0 {
            current_balance + debit_amount
        } else {
            current_balance - credit_amount
        };
        update_account_currency_balance_internal(db, *account_id, *currency_id, new_balance)?;

        // Create account transaction for new/modified lines
        let entry_sql = "SELECT entry_date FROM journal_entries WHERE id = ?";
        let entry_dates = db
            .query(entry_sql, one_param(entry_id), |row| {
                Ok(row_get::<String>(row, 0)?)
            })
            .map_err(|e| format!("Failed to fetch entry date: {}", e))?;
        
        if let Some(entry_date) = entry_dates.first() {
            let transaction_type = if *debit_amount > 0.0 { "deposit" } else { "withdraw" };
            let amount = if *debit_amount > 0.0 { *debit_amount } else { *credit_amount };
            let currency_name_sql = "SELECT name FROM currencies WHERE id = ?";
            let currency_names = db
                .query(currency_name_sql, one_param(currency_id), |row| {
                    Ok(row_get::<String>(row, 0)?)
                })
                .ok()
                .and_then(|v| v.first().cloned());
            
            if let Some(currency_name) = currency_names {
                let total = base_amount;
                let insert_transaction_sql = "INSERT INTO account_transactions (account_id, transaction_type, amount, currency, rate, total, transaction_date, is_full, notes) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)";
                let notes_str: Option<&str> = line_desc.as_ref().map(|s| s.as_str());
                let _ = db.execute(insert_transaction_sql, (
                    account_id,
                    &transaction_type,
                    &amount,
                    &currency_name,
                    exchange_rate,
                    &total,
                    entry_date,
                    &notes_str,
                ));
            }
        }
    }

    // Update entry timestamp
    let update_entry_sql = "UPDATE journal_entries SET updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_entry_sql, one_param(entry_id))
        .map_err(|e| format!("Failed to update journal entry: {}", e))?;

    // Get the updated entry
    let entry_sql = "SELECT id, entry_number, entry_date, description, reference_type, reference_id, created_at, updated_at FROM journal_entries WHERE id = ?";
    let entries = db
        .query(entry_sql, one_param(entry_id), |row| {
            Ok(JournalEntry {
                id: row_get(row, 0)?,
                entry_number: row_get(row, 1)?,
                entry_date: row_get(row, 2)?,
                description: row_get(row, 3)?,
                reference_type: row_get(row, 4)?,
                reference_id: row_get(row, 5)?,
                created_at: row_get_string_or_datetime(row, 6)?,
                updated_at: row_get_string_or_datetime(row, 7)?,
            })
        })
        .map_err(|e| format!("Failed to fetch updated journal entry: {}", e))?;

    if let Some(entry) = entries.first() {
        Ok(entry.clone())
    } else {
        Err("Failed to retrieve updated journal entry".to_string())
    }
}

/// Create exchange rate
#[tauri::command]
fn create_exchange_rate(
    db_state: State<'_, Mutex<Option<Database>>>,
    from_currency_id: i64,
    to_currency_id: i64,
    rate: f64,
    date: String,
) -> Result<CurrencyExchangeRate, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let insert_sql = "INSERT INTO currency_exchange_rates (from_currency_id, to_currency_id, rate, date) VALUES (?, ?, ?, ?)";
    db.execute(insert_sql, (
        &from_currency_id,
        &to_currency_id,
        &rate,
        &date,
    ))
        .map_err(|e| format!("Failed to insert exchange rate: {}", e))?;

    // Get the created rate
    let rate_sql = "SELECT id, from_currency_id, to_currency_id, rate, date, created_at FROM currency_exchange_rates WHERE from_currency_id = ? AND to_currency_id = ? AND date = ? ORDER BY id DESC LIMIT 1";
    let rates = db
        .query(rate_sql, (from_currency_id, to_currency_id, date.as_str()), |row| {
            Ok(CurrencyExchangeRate {
                id: row_get(row, 0)?,
                from_currency_id: row_get(row, 1)?,
                to_currency_id: row_get(row, 2)?,
                rate: row_get(row, 3)?,
                date: row_get(row, 4)?,
                created_at: row_get_string_or_datetime(row, 5)?,
            })
        })
        .map_err(|e| format!("Failed to fetch exchange rate: {}", e))?;

    if let Some(rate) = rates.first() {
        Ok(rate.clone())
    } else {
        Err("Failed to retrieve created exchange rate".to_string())
    }
}

/// Get exchange rate for a specific date (or latest)
#[tauri::command]
fn get_exchange_rate(
    db_state: State<'_, Mutex<Option<Database>>>,
    from_currency_id: i64,
    to_currency_id: i64,
    date: Option<String>,
) -> Result<f64, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let rates = if let Some(d) = date {
        let sql = "SELECT rate FROM currency_exchange_rates WHERE from_currency_id = ? AND to_currency_id = ? AND date <= ? ORDER BY date DESC LIMIT 1";
        db.query(sql, (from_currency_id, to_currency_id, d.as_str()), |row| {
            Ok(row_get::<f64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to fetch exchange rate: {}", e))?
    } else {
        let sql = "SELECT rate FROM currency_exchange_rates WHERE from_currency_id = ? AND to_currency_id = ? ORDER BY date DESC LIMIT 1";
        db.query(sql, (from_currency_id, to_currency_id), |row| {
            Ok(row_get::<f64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to fetch exchange rate: {}", e))?
    };

    Ok(rates.first().copied().unwrap_or(1.0))
}

/// Get exchange rate history
#[tauri::command]
fn get_exchange_rate_history(
    db_state: State<'_, Mutex<Option<Database>>>,
    from_currency_id: i64,
    to_currency_id: i64,
) -> Result<Vec<CurrencyExchangeRate>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, from_currency_id, to_currency_id, rate, date, created_at FROM currency_exchange_rates WHERE from_currency_id = ? AND to_currency_id = ? ORDER BY date DESC";
    let rates = db
        .query(sql, (from_currency_id, to_currency_id), |row| {
            Ok(CurrencyExchangeRate {
                id: row_get(row, 0)?,
                from_currency_id: row_get(row, 1)?,
                to_currency_id: row_get(row, 2)?,
                rate: row_get(row, 3)?,
                date: row_get(row, 4)?,
                created_at: row_get_string_or_datetime(row, 5)?,
            })
        })
        .map_err(|e| format!("Failed to fetch exchange rate history: {}", e))?;

    Ok(rates)
}

/// Reconcile account balance - compare journal entries vs account balance
#[tauri::command]
fn reconcile_account_balance(
    db_state: State<'_, Mutex<Option<Database>>>,
    account_id: i64,
    currency_id: i64,
) -> Result<serde_json::Value, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Get account currency balance
    let account_balance = get_account_balance_by_currency_internal(db, account_id, currency_id)?;

    // Calculate balance from journal entries
    let journal_debits_sql = "SELECT COALESCE(SUM(debit_amount), 0) FROM journal_entry_lines WHERE account_id = ? AND currency_id = ?";
    let journal_debits: f64 = db
        .query(journal_debits_sql, (account_id, currency_id), |row| {
            Ok(row_get::<f64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to calculate journal debits: {}", e))?
        .first()
        .copied()
        .unwrap_or(0.0);

    let journal_credits_sql = "SELECT COALESCE(SUM(credit_amount), 0) FROM journal_entry_lines WHERE account_id = ? AND currency_id = ?";
    let journal_credits: f64 = db
        .query(journal_credits_sql, (account_id, currency_id), |row| {
            Ok(row_get::<f64>(row, 0)?)
        })
        .map_err(|e| format!("Failed to calculate journal credits: {}", e))?
        .first()
        .copied()
        .unwrap_or(0.0);

    let journal_balance = journal_debits - journal_credits;
    let difference = account_balance - journal_balance;

    Ok(serde_json::json!({
        "account_id": account_id,
        "currency_id": currency_id,
        "account_balance": account_balance,
        "journal_debits": journal_debits,
        "journal_credits": journal_credits,
        "journal_balance": journal_balance,
        "difference": difference,
        "is_balanced": difference.abs() < 0.01
    }))
}

/// Migrate existing data to new schema
#[tauri::command]
fn migrate_existing_data(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Get base currency
    let base_currency_sql = "SELECT id FROM currencies WHERE base = 1 LIMIT 1";
    let base_currencies = db.query(base_currency_sql, (), |row| Ok(row_get::<i64>(row, 0)?))
        .map_err(|e| format!("Failed to get base currency: {}", e))?;
    let base_currency_id = base_currencies.first().copied().unwrap_or_else(|| {
        db.query("SELECT id FROM currencies LIMIT 1", (), |row| Ok(row_get::<i64>(row, 0)?))
            .ok()
            .and_then(|v| v.first().copied())
            .unwrap_or(1)
    });

    // Migrate existing account balances to account_currency_balances
    let accounts_sql = "SELECT id, currency_id, current_balance FROM accounts";
    let accounts = db
        .query(accounts_sql, (), |row| {
            Ok((row_get::<i64>(row, 0)?, row_get::<Option<i64>>(row, 1)?, row_get::<f64>(row, 2)?))
        })
        .map_err(|e| format!("Failed to fetch accounts: {}", e))?;

    let mut migrated_count = 0;
    for (account_id, currency_id, balance) in accounts {
        let currency = currency_id.unwrap_or(base_currency_id);
        if balance != 0.0 {
            update_account_currency_balance_internal(db, account_id, currency, balance)?;
            migrated_count += 1;
        }
    }

    // Migrate existing sales to have base currency
    let update_sales_sql = "UPDATE sales SET currency_id = ?, exchange_rate = 1, base_amount = total_amount WHERE currency_id IS NULL";
    db.execute(update_sales_sql, one_param(base_currency_id))
        .map_err(|e| format!("Failed to migrate sales: {}", e))?;

    Ok(format!("Migration completed. Migrated {} account balances.", migrated_count))
}

// ---- Thermal receipt print (ESC/POS) ----
const RECEIPT_WIDTH: usize = 48;

fn truncate_receipt(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", s.chars().take(max - 1).collect::<String>())
    }
}

#[derive(Debug, serde::Deserialize)]
struct ThermalReceiptItem {
    name: String,
    quantity: f64,
    unit_price: f64,
    line_total: f64,
}

#[derive(Debug, serde::Deserialize)]
struct ThermalReceiptPayload {
    company_name: Option<String>,
    sale_id: i64,
    sale_date: String,
    total_amount: f64,
    paid_amount: f64,
    order_discount_amount: f64,
    notes: Option<String>,
    customer_name: String,
    items: Vec<ThermalReceiptItem>,
    currency_label: String,
}

#[tauri::command]
fn print_sale_receipt_thermal(
    payload: ThermalReceiptPayload,
    printer_ip: String,
    printer_port: Option<u16>,
) -> Result<(), String> {
    use escpos::driver::NetworkDriver;
    use escpos::printer::Printer;
    use escpos::utils::{JustifyMode, Protocol};
    use std::time::Duration;

    let port = printer_port.unwrap_or(9100);
    let driver = NetworkDriver::open(printer_ip.as_str(), port, Some(Duration::from_secs(5)))
        .map_err(|e| format!("Printer not reachable: {}", e))?;

    let mut printer = Printer::new(driver, Protocol::default(), None);

    printer
        .init()
        .map_err(|e| format!("Printer init failed: {}", e))?;

    if let Some(ref name) = payload.company_name {
        printer
            .justify(JustifyMode::CENTER)
            .map_err(|e| format!("Printer error: {}", e))?
            .writeln(&truncate_receipt(name, RECEIPT_WIDTH))
            .map_err(|e| format!("Printer error: {}", e))?;
    }
    printer
        .feed()
        .map_err(|e| format!("Printer error: {}", e))?;

    printer
        .justify(JustifyMode::LEFT)
        .map_err(|e| format!("Printer error: {}", e))?
        .writeln(&truncate_receipt(&payload.sale_date, RECEIPT_WIDTH))
        .map_err(|e| format!("Printer error: {}", e))?
        .writeln(&format!("Sale #{}", payload.sale_id))
        .map_err(|e| format!("Printer error: {}", e))?
        .writeln(&truncate_receipt(&payload.customer_name, RECEIPT_WIDTH))
        .map_err(|e| format!("Printer error: {}", e))?
        .writeln("--------------------------------")
        .map_err(|e| format!("Printer error: {}", e))?;

    for item in &payload.items {
        printer
            .writeln(&truncate_receipt(&item.name, RECEIPT_WIDTH))
            .map_err(|e| format!("Printer error: {}", e))?;
        let line = format!(
            "  {} x {} = {}",
            item.quantity,
            format!("{:.2}", item.unit_price),
            format!("{:.2}", item.line_total)
        );
        printer
            .writeln(&line)
            .map_err(|e| format!("Printer error: {}", e))?;
    }

    printer
        .writeln("--------------------------------")
        .map_err(|e| format!("Printer error: {}", e))?;

    let subtotal = payload.items.iter().map(|i| i.line_total).sum::<f64>();
    let currency = if payload.currency_label.is_empty() {
        ""
    } else {
        payload.currency_label.as_str()
    };
    printer
        .writeln(&format!("Subtotal: {:.2} {}", subtotal, currency))
        .map_err(|e| format!("Printer error: {}", e))?;
    if payload.order_discount_amount > 0.0 {
        printer
            .writeln(&format!(
                "Discount: {:.2} {}",
                payload.order_discount_amount, currency
            ))
            .map_err(|e| format!("Printer error: {}", e))?;
    }
    printer
        .writeln(&format!("Total: {:.2} {}", payload.total_amount, currency))
        .map_err(|e| format!("Printer error: {}", e))?
        .writeln(&format!("Paid: {:.2} {}", payload.paid_amount, currency))
        .map_err(|e| format!("Printer error: {}", e))?;
    let remaining = payload.total_amount - payload.paid_amount;
    if remaining > 0.0 {
        printer
            .writeln(&format!("Remaining: {:.2} {}", remaining, currency))
            .map_err(|e| format!("Printer error: {}", e))?;
    }

    printer
        .feed()
        .map_err(|e| format!("Printer error: {}", e))?
        .justify(JustifyMode::CENTER)
        .map_err(|e| format!("Printer error: {}", e))?
        .writeln("Thank you / متشکرم")
        .map_err(|e| format!("Printer error: {}", e))?
        .print_cut()
        .map_err(|e| format!("Printer error: {}", e))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load environment variables at startup
    load_env();
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_keychain::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // Start the AI server in a background thread with its own runtime
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                // Create a new Tokio runtime for the server
                match tokio::runtime::Runtime::new() {
                    Ok(rt) => {
                        rt.block_on(async {
                            match server::start_server(app_handle).await {
                                Ok(_) => {
                                    println!("✅ AI server started successfully");
                                }
                                Err(e) => {
                                    eprintln!("❌ Failed to start AI server: {}", e);
                                    eprintln!("   The server will not be available at http://127.0.0.1:5021/ai.html");
                                }
                            }
                        });
                    }
                    Err(e) => {
                        eprintln!("❌ Failed to create Tokio runtime for AI server: {}", e);
                    }
                }
            });
            Ok(())
        })
        .manage(Mutex::new(None::<Database>))
        .invoke_handler(tauri::generate_handler![
            get_env_config,
            save_env_config,
            db_create,
            db_open,
            db_close,
            db_is_open,
            db_execute,
            db_query,
            get_database_path,
            backup_database,
            get_backups_dir,
            save_backup_to_path,
            create_daily_backup,
            restore_database,
            init_users_table,
            register_user,
            login_user,
            get_users,
            init_currencies_table,
            create_currency,
            get_currencies,
            update_currency,
            delete_currency,
            init_suppliers_table,
            create_supplier,
            get_suppliers,
            update_supplier,
            delete_supplier,
            init_products_table,
            create_product,
            get_products,
            update_product,
            delete_product,
            init_purchases_table,
            create_purchase,
            get_purchases,
            get_purchase,
            update_purchase,
            delete_purchase,
            create_purchase_item,
            get_purchase_items,
            update_purchase_item,
            delete_purchase_item,
            get_purchase_additional_costs,
            init_unit_groups_table,
            get_unit_groups,
            create_unit_group,
            init_units_table,
            create_unit,
            get_units,
            update_unit,
            delete_unit,
            init_customers_table,
            create_customer,
            get_customers,
            update_customer,
            delete_customer,
            init_sales_table,
            create_sale,
            get_sales,
            get_sale,
            update_sale,
            delete_sale,
            create_sale_item,
            get_sale_items,
            get_product_batches,
            get_product_stock,
            get_stock_by_batches,
            update_sale_item,
            delete_sale_item,
            create_sale_payment,
            get_sale_payments,
            delete_sale_payment,
            get_sale_additional_costs,
            init_services_table,
            init_sale_discount_codes_table,
            validate_discount_code,
            get_discount_codes,
            create_discount_code,
            update_discount_code,
            delete_discount_code,
            create_service,
            get_services,
            get_service,
            update_service,
            delete_service,
            init_expense_types_table,
            create_expense_type,
            get_expense_types,
            update_expense_type,
            delete_expense_type,
            init_expenses_table,
            create_expense,
            get_expenses,
            get_expense,
            update_expense,
            delete_expense,
            init_employees_table,
            create_employee,
            get_employees,
            get_employee,
            update_employee,
            delete_employee,
            init_salaries_table,
            create_salary,
            get_salaries,
            get_salaries_by_employee,
            get_salary,
            update_salary,
            delete_salary,
            init_deductions_table,
            create_deduction,
            get_deductions,
            get_deductions_by_employee,
            get_deductions_by_employee_year_month,
            get_deduction,
            update_deduction,
            delete_deduction,
            init_company_settings_table,
            get_company_settings,
            update_company_settings,
            init_accounts_table,
            init_account_transactions_table,
            create_account,
            get_accounts,
            get_account,
            update_account,
            delete_account,
            deposit_account,
            withdraw_account,
            get_account_transactions,
            get_account_balance,
            init_coa_categories_table,
            init_standard_coa_categories,
            create_coa_category,
            get_coa_categories,
            get_coa_category_tree,
            update_coa_category,
            delete_coa_category,
            init_account_currency_balances_table,
            get_account_balance_by_currency,
            get_all_account_balances,
            init_journal_entries_table,
            init_journal_entry_lines_table,
            create_journal_entry,
            get_journal_entries,
            get_journal_entry,
            update_journal_entry,
            init_currency_exchange_rates_table,
            create_exchange_rate,
            get_exchange_rate,
            get_exchange_rate_history,
            reconcile_account_balance,
            migrate_existing_data,
            init_purchase_payments_table,
            create_purchase_payment,
            get_purchase_payments,
            get_purchase_payments_by_purchase,
            update_purchase_payment,
            delete_purchase_payment,
            get_machine_id,
            store_license_key,
            get_license_key,
            get_license_expiry,
            store_license_expiry,
            validate_license_key,
            check_license_with_server,
            check_license_key_with_server,
            register_license_on_server,
            refresh_license_expiry_from_server,
            hash_password,
            verify_password,
            store_puter_credentials,
            get_puter_credentials,
            print_sale_receipt_thermal
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
