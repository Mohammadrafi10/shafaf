mod db;
mod license;
mod server;

use db::Database;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

// Load environment variables at startup
fn load_env() {
    let _ = dotenv::dotenv();
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
/// Get database path using standard OS data directory
fn get_db_path(app: &AppHandle, _db_name: &str) -> Result<PathBuf, String> {
    // Get standard data directory based on OS
    let data_dir = if cfg!(target_os = "android") {
        // Android: Use app's private data directory
        // Tauri provides the app data directory via app.path()
        app.path()
            .app_data_dir()
            .map_err(|e| format!("Failed to get Android app data directory: {}", e))?
    } else if cfg!(windows) {
        // Windows: Use AppData\Local\<app_name>
        std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                // Fallback to current directory if LOCALAPPDATA is not set
                PathBuf::from(".")
            })
            .join("finance-app")
    } else if cfg!(target_os = "macos") {
        // macOS: Use ~/Library/Application Support/<app_name>
        std::env::var("HOME")
            .map(|home| PathBuf::from(home).join("Library").join("Application Support").join("tauri-app"))
            .unwrap_or_else(|_| PathBuf::from("."))
    } else {
        // Linux: Use ~/.local/share/<app_name> or XDG_DATA_HOME
        std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                std::env::var("HOME")
                    .map(|home| PathBuf::from(home).join(".local").join("share"))
                    .unwrap_or_else(|_| PathBuf::from("."))
            })
            .join("finance-app")
    };
    
    // Create data directory if it doesn't exist
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;
    
    // Database file path
    let db_path = data_dir.join("db.sqlite");
    
    Ok(db_path)
}

/// Get the current database path
#[tauri::command]
fn get_database_path(app: AppHandle) -> Result<String, String> {
    let db_path = get_db_path(&app, "")?;
    Ok(db_path.to_string_lossy().to_string())
}

/// Backup database - returns the database path for frontend to handle download
#[tauri::command]
fn backup_database(app: AppHandle) -> Result<String, String> {
    let db_path = get_db_path(&app, "")?;
    
    if !db_path.exists() {
        return Err("Database file does not exist".to_string());
    }
    
    // Return the database path - frontend will use dialog plugin to save
    Ok(db_path.to_string_lossy().to_string())
}

/// Copy the database to a user-selected path (e.g. from save dialog). Backend has full fs access.
#[tauri::command]
fn save_backup_to_path(app: AppHandle, dest_path: String) -> Result<String, String> {
    let db_path = get_db_path(&app, "")?;
    if !db_path.exists() {
        return Err("Database file does not exist".to_string());
    }
    let dest = std::path::Path::new(&dest_path);
    fs::copy(&db_path, dest).map_err(|e: io::Error| format!("Failed to save backup: {}", e))?;
    Ok(dest_path)
}

/// Create a daily backup in the app data folder (backups subfolder). Called by the frontend scheduler after login.
#[tauri::command]
fn create_daily_backup(app: AppHandle) -> Result<String, String> {
    let db_path = get_db_path(&app, "")?;

    if !db_path.exists() {
        return Err("Database file does not exist".to_string());
    }

    let data_dir = db_path
        .parent()
        .ok_or_else(|| "Invalid database path".to_string())?;
    let backups_dir = data_dir.join("backups");
    fs::create_dir_all(&backups_dir).map_err(|e: io::Error| format!("Failed to create backups dir: {}", e))?;

    let date_str = chrono::Local::now().format("%Y-%m-%d").to_string();
    let backup_name = format!("db-backup-{}.sqlite", date_str);
    let backup_path = backups_dir.join(&backup_name);

    fs::copy(&db_path, &backup_path).map_err(|e: io::Error| format!("Failed to copy database: {}", e))?;

    Ok(backup_path.to_string_lossy().to_string())
}

/// Create a new SQLite database file (creates database automatically on open)
#[tauri::command]
fn db_create(app: AppHandle, _db_name: String) -> Result<String, String> {
    let db_path = get_db_path(&app, &_db_name)?;
    let db = Database::new(db_path.clone());
    db.open()
        .map_err(|e| format!("Failed to create database: {}", e))?;
    Ok(format!("Database created at: {:?}", db_path))
}

/// Open database (creates it automatically if it doesn't exist)
#[tauri::command]
fn db_open(app: AppHandle, _db_name: String) -> Result<String, String> {
    let db_path = get_db_path(&app, "")?;

    let db = Database::new(db_path.clone());
    db.open()
        .map_err(|e| format!("Failed to open database: {}", e))?;

    // Update existing database state
    let db_state: State<'_, Mutex<Option<Database>>> = app.state();
    let mut db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    *db_guard = Some(db);

    if db_path.exists() {
        Ok(format!("Database opened: {:?}", db_path))
    } else {
        Ok(format!("Database created and opened: {:?}", db_path))
    }
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

/// Execute a SQL query (INSERT, UPDATE, DELETE, CREATE TABLE, etc.)
#[tauri::command]
fn db_execute(
    db_state: State<'_, Mutex<Option<Database>>>,
    sql: String,
    params: Vec<serde_json::Value>,
) -> Result<ExecuteResult, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Convert JSON values to SQL parameters using rusqlite::params
    let rows_affected = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow::anyhow!("SQL prepare error: {}", e))?;
        
        // Convert params to rusqlite compatible format
        let rusqlite_params: Vec<rusqlite::types::Value> = params
            .iter()
            .map(|v| {
                match v {
                    serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                    serde_json::Value::Number(n) => {
                        if n.is_i64() {
                            rusqlite::types::Value::Integer(n.as_i64().unwrap())
                        } else if n.is_u64() {
                            rusqlite::types::Value::Integer(n.as_u64().unwrap() as i64)
                        } else {
                            rusqlite::types::Value::Real(n.as_f64().unwrap())
                        }
                    }
                    serde_json::Value::Bool(b) => rusqlite::types::Value::Integer(if *b { 1 } else { 0 }),
                    serde_json::Value::Null => rusqlite::types::Value::Null,
                    _ => rusqlite::types::Value::Text(v.to_string()),
                }
            })
            .collect();

        let rows_affected = stmt.execute(rusqlite::params_from_iter(rusqlite_params.iter()))
            .map_err(|e| anyhow::anyhow!("SQL execution error: {}", e))?;
        
        Ok(rows_affected)
    })
    .map_err(|e| format!("Database error: {}", e))?;

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

    // Get column names and execute query
    let result = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow::anyhow!("SQL prepare error: {}", e))?;
        
        let column_count = stmt.column_count();
        let columns: Vec<String> = (0..column_count)
            .map(|i| stmt.column_name(i).unwrap_or("").to_string())
            .collect();

        // Convert params to rusqlite compatible format
        let rusqlite_params: Vec<rusqlite::types::Value> = params
            .iter()
            .map(|v| {
                match v {
                    serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                    serde_json::Value::Number(n) => {
                        if n.is_i64() {
                            rusqlite::types::Value::Integer(n.as_i64().unwrap())
                        } else if n.is_u64() {
                            rusqlite::types::Value::Integer(n.as_u64().unwrap() as i64)
                        } else {
                            rusqlite::types::Value::Real(n.as_f64().unwrap())
                        }
                    }
                    serde_json::Value::Bool(b) => rusqlite::types::Value::Integer(if *b { 1 } else { 0 }),
                    serde_json::Value::Null => rusqlite::types::Value::Null,
                    _ => rusqlite::types::Value::Text(v.to_string()),
                }
            })
            .collect();

        // Execute query and get rows
        let rows = stmt
            .query_map(rusqlite::params_from_iter(rusqlite_params.iter()), |row| {
                let mut values = Vec::new();
                for i in 0..column_count {
                    let value = {
                        // Try to get value based on column type
                        let col_type = row.get_ref(i)?.data_type();
                        match col_type {
                            rusqlite::types::Type::Integer => {
                                let val = row.get::<_, i64>(i)?;
                                serde_json::Value::Number(serde_json::Number::from(val))
                            },
                            rusqlite::types::Type::Real => {
                                let val = row.get::<_, f64>(i)?;
                                serde_json::Value::Number(serde_json::Number::from_f64(val).unwrap_or(serde_json::Number::from(0)))
                            },
                            rusqlite::types::Type::Text => {
                                let val = row.get::<_, String>(i)?;
                                serde_json::Value::String(val)
                            },
                            rusqlite::types::Type::Blob => {
                                let blob = row.get_ref(i)?.as_blob()?;
                                serde_json::Value::String(format!("[BLOB:{} bytes]", blob.len()))
                            },
                            rusqlite::types::Type::Null => serde_json::Value::Null,
                        }
                    };
                    values.push(value);
                }
                Ok(values)
            })
            .map_err(|e| anyhow::anyhow!("SQL query error: {}", e))?;

        let mut result_rows = Vec::new();
        for row in rows {
            result_rows.push(row.map_err(|e| anyhow::anyhow!("Row processing error: {}", e))?);
        }

        Ok((columns, result_rows))
    })
    .map_err(|e| format!("Database error: {}", e))?;

    Ok(QueryResult {
        columns: result.0,
        rows: result.1,
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
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginResult {
    pub success: bool,
    pub user: Option<User>,
    pub message: String,
}

/// Initialize users table schema
#[tauri::command]
fn init_users_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            full_name TEXT,
            phone TEXT,
            role TEXT NOT NULL DEFAULT 'user',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create users table: {}", e))?;

    // Add new columns if they don't exist (for existing databases)
    // Note: SQLite doesn't support NOT NULL DEFAULT in ALTER TABLE, so we add nullable columns and update them
    let alter_queries = vec![
        "ALTER TABLE users ADD COLUMN full_name TEXT",
        "ALTER TABLE users ADD COLUMN phone TEXT",
        "ALTER TABLE users ADD COLUMN role TEXT",
        "ALTER TABLE users ADD COLUMN is_active INTEGER",
    ];

    for alter_sql in alter_queries {
        let _ = db.execute(alter_sql, &[]);
    }

    // Update existing rows to set default values for new columns
    let update_role_sql = "UPDATE users SET role = 'user' WHERE role IS NULL";
    let _ = db.execute(update_role_sql, &[]);
    
    let update_active_sql = "UPDATE users SET is_active = 1 WHERE is_active IS NULL";
    let _ = db.execute(update_active_sql, &[]);

    Ok("Users table initialized successfully".to_string())
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
        .query(check_sql, &[&username as &dyn rusqlite::ToSql, &email as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
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
    db.execute(insert_sql, &[&username as &dyn rusqlite::ToSql, &email as &dyn rusqlite::ToSql, &password_hash as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to insert user: {}", e))?;

    // Get the created user
    let user_sql = "SELECT id, username, email, full_name, phone, role, is_active, created_at, updated_at FROM users WHERE username = ?";
    let users = db
        .query(user_sql, &[&username as &dyn rusqlite::ToSql], |row| {
            Ok(User {
                id: row.get(0)?,
                username: row.get(1)?,
                email: row.get(2)?,
                full_name: row.get(3)?,
                phone: row.get(4)?,
                role: row.get(5)?,
                is_active: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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
    let user_sql = "SELECT id, username, email, password_hash, full_name, phone, role, is_active, created_at, updated_at FROM users WHERE username = ? OR email = ?";
    let users = db
        .query(user_sql, &[&username as &dyn rusqlite::ToSql, &username as &dyn rusqlite::ToSql], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<i64>>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
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

    let (id, db_username, email, password_hash, full_name, phone, role, is_active, created_at, updated_at) = &users[0];

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
    let total: i64 = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&count_sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();

        let count: i64 = stmt.query_row(rusqlite::params_from_iter(rusqlite_params.iter()), |row| row.get(0))
             .map_err(|e| anyhow::anyhow!("{}", e))?;
        Ok(count)
    }).map_err(|e| format!("Failed to count users: {}", e))?;

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

    let sql = format!("SELECT id, username, email, full_name, phone, role, is_active, created_at, updated_at FROM users {} {} LIMIT ? OFFSET ?", where_clause, order_clause);
    
    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));

    let users = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                serde_json::Value::Number(n) => rusqlite::types::Value::Integer(n.as_i64().unwrap_or(0)),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();

        let rows = stmt.query_map(rusqlite::params_from_iter(rusqlite_params.iter()), |row| {
             Ok(User {
                id: row.get(0)?,
                username: row.get(1)?,
                email: row.get(2)?,
                full_name: row.get(3)?,
                phone: row.get(4)?,
                role: row.get(5)?,
                is_active: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        }).map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut results = Vec::new();
        for row in rows {
            results.push(row.map_err(|e| anyhow::anyhow!("{}", e))?);
        }
        Ok(results)
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

/// Validate license key
#[tauri::command]
fn validate_license_key(entered_key: String) -> Result<bool, String> {
    license::validate_license_key(&entered_key)
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

/// Initialize currencies table schema
#[tauri::command]
fn init_currencies_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS currencies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            base INTEGER NOT NULL DEFAULT 0,
            rate REAL NOT NULL DEFAULT 1.0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create currencies table: {}", e))?;

    // Add rate column if it doesn't exist (for existing databases)
    let alter_sql = "ALTER TABLE currencies ADD COLUMN rate REAL NOT NULL DEFAULT 1.0";
    let _ = db.execute(alter_sql, &[]);

    Ok("Currencies table initialized successfully".to_string())
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
        db.execute(update_sql, &[])
            .map_err(|e| format!("Failed to update base currencies: {}", e))?;
    }

    // Insert new currency
    let insert_sql = "INSERT INTO currencies (name, base, rate) VALUES (?, ?, ?)";
    let base_int = if base { 1 } else { 0 };
    db.execute(insert_sql, &[&name as &dyn rusqlite::ToSql, &base_int as &dyn rusqlite::ToSql, &rate as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to insert currency: {}", e))?;

    // Get the created currency
    let currency_sql = "SELECT id, name, base, rate, created_at, updated_at FROM currencies WHERE name = ?";
    let currencies = db
        .query(currency_sql, &[&name as &dyn rusqlite::ToSql], |row| {
            Ok(Currency {
                id: row.get(0)?,
                name: row.get(1)?,
                base: row.get::<_, i64>(2)? != 0,
                rate: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
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
        .query(sql, &[], |row| {
            Ok(Currency {
                id: row.get(0)?,
                name: row.get(1)?,
                base: row.get::<_, i64>(2)? != 0,
                rate: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
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
        db.execute(update_sql, &[&id as &dyn rusqlite::ToSql])
            .map_err(|e| format!("Failed to update base currencies: {}", e))?;
    }

    // Update currency
    let base_int = if base { 1 } else { 0 };
    let update_sql = "UPDATE currencies SET name = ?, base = ?, rate = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sql, &[&name as &dyn rusqlite::ToSql, &base_int as &dyn rusqlite::ToSql, &rate as &dyn rusqlite::ToSql, &id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to update currency: {}", e))?;

    // Get the updated currency
    let currency_sql = "SELECT id, name, base, rate, created_at, updated_at FROM currencies WHERE id = ?";
    let currencies = db
        .query(currency_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Currency {
                id: row.get(0)?,
                name: row.get(1)?,
                base: row.get::<_, i64>(2)? != 0,
                rate: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
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
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
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

/// Initialize suppliers table schema
#[tauri::command]
fn init_suppliers_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            phone TEXT NOT NULL,
            address TEXT NOT NULL,
            email TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create suppliers table: {}", e))?;

    Ok("Suppliers table initialized successfully".to_string())
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
    db.execute(insert_sql, &[
        &full_name as &dyn rusqlite::ToSql,
        &phone as &dyn rusqlite::ToSql,
        &address as &dyn rusqlite::ToSql,
        &email_str as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert supplier: {}", e))?;

    // Get the created supplier
    let supplier_sql = "SELECT id, full_name, phone, address, email, notes, created_at, updated_at FROM suppliers WHERE full_name = ? AND phone = ? ORDER BY id DESC LIMIT 1";
    let suppliers = db
        .query(supplier_sql, &[&full_name as &dyn rusqlite::ToSql, &phone as &dyn rusqlite::ToSql], |row| {
            Ok(Supplier {
                id: row.get(0)?,
                full_name: row.get(1)?,
                phone: row.get(2)?,
                address: row.get(3)?,
                email: row.get::<_, Option<String>>(4)?,
                notes: row.get::<_, Option<String>>(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
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
    let total: i64 = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&count_sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();
        let count: i64 = stmt.query_row(rusqlite::params_from_iter(rusqlite_params.iter()), |row| row.get(0))
            .map_err(|e| anyhow::anyhow!("{}", e))?;
        Ok(count)
    }).map_err(|e| format!("Failed to count suppliers: {}", e))?;

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

    let suppliers = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                serde_json::Value::Number(n) => rusqlite::types::Value::Integer(n.as_i64().unwrap_or(0)),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();

        let rows = stmt.query_map(rusqlite::params_from_iter(rusqlite_params.iter()), |row| {
             Ok(Supplier {
                id: row.get(0)?,
                full_name: row.get(1)?,
                phone: row.get(2)?,
                address: row.get(3)?,
                email: row.get::<_, Option<String>>(4)?,
                notes: row.get::<_, Option<String>>(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        }).map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| anyhow::anyhow!("{}", e))?);
        }
        Ok(result)
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
    db.execute(update_sql, &[
        &full_name as &dyn rusqlite::ToSql,
        &phone as &dyn rusqlite::ToSql,
        &address as &dyn rusqlite::ToSql,
        &email_str as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update supplier: {}", e))?;

    // Get the updated supplier
    let supplier_sql = "SELECT id, full_name, phone, address, email, notes, created_at, updated_at FROM suppliers WHERE id = ?";
    let suppliers = db
        .query(supplier_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Supplier {
                id: row.get(0)?,
                full_name: row.get(1)?,
                phone: row.get(2)?,
                address: row.get(3)?,
                email: row.get::<_, Option<String>>(4)?,
                notes: row.get::<_, Option<String>>(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
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
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
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

/// Initialize customers table schema
#[tauri::command]
fn init_customers_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            phone TEXT NOT NULL,
            address TEXT NOT NULL,
            email TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create customers table: {}", e))?;

    Ok("Customers table initialized successfully".to_string())
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
    db.execute(insert_sql, &[
        &full_name as &dyn rusqlite::ToSql,
        &phone as &dyn rusqlite::ToSql,
        &address as &dyn rusqlite::ToSql,
        &email_str as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert customer: {}", e))?;

    // Get the created customer
    let customer_sql = "SELECT id, full_name, phone, address, email, notes, created_at, updated_at FROM customers WHERE full_name = ? AND phone = ? ORDER BY id DESC LIMIT 1";
    let customers = db
        .query(customer_sql, &[&full_name as &dyn rusqlite::ToSql, &phone as &dyn rusqlite::ToSql], |row| {
            Ok(Customer {
                id: row.get(0)?,
                full_name: row.get(1)?,
                phone: row.get(2)?,
                address: row.get(3)?,
                email: row.get::<_, Option<String>>(4)?,
                notes: row.get::<_, Option<String>>(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
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
    let total: i64 = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&count_sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();
        let count: i64 = stmt.query_row(rusqlite::params_from_iter(rusqlite_params.iter()), |row| row.get(0))
            .map_err(|e| anyhow::anyhow!("{}", e))?;
        Ok(count)
    }).map_err(|e| format!("Failed to count customers: {}", e))?;

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

    let customers = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                serde_json::Value::Number(n) => rusqlite::types::Value::Integer(n.as_i64().unwrap_or(0)),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();

        let rows = stmt.query_map(rusqlite::params_from_iter(rusqlite_params.iter()), |row| {
             Ok(Customer {
                id: row.get(0)?,
                full_name: row.get(1)?,
                phone: row.get(2)?,
                address: row.get(3)?,
                email: row.get::<_, Option<String>>(4)?,
                notes: row.get::<_, Option<String>>(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        }).map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| anyhow::anyhow!("{}", e))?);
        }
        Ok(result)
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
    db.execute(update_sql, &[
        &full_name as &dyn rusqlite::ToSql,
        &phone as &dyn rusqlite::ToSql,
        &address as &dyn rusqlite::ToSql,
        &email_str as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update customer: {}", e))?;

    // Get the updated customer
    let customer_sql = "SELECT id, full_name, phone, address, email, notes, created_at, updated_at FROM customers WHERE id = ?";
    let customers = db
        .query(customer_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Customer {
                id: row.get(0)?,
                full_name: row.get(1)?,
                phone: row.get(2)?,
                address: row.get(3)?,
                email: row.get::<_, Option<String>>(4)?,
                notes: row.get::<_, Option<String>>(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
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
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
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

/// Initialize unit_groups table schema
#[tauri::command]
fn init_unit_groups_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS unit_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create unit_groups table: {}", e))?;

    Ok("Unit groups table initialized successfully".to_string())
}

/// Get all unit groups
#[tauri::command]
fn get_unit_groups(db_state: State<'_, Mutex<Option<Database>>>) -> Result<Vec<UnitGroup>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, name, created_at, updated_at FROM unit_groups ORDER BY name ASC";
    let groups = db
        .query(sql, &[], |row| {
            Ok(UnitGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
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
    db.execute(insert_sql, &[&name as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to insert unit group: {}", e))?;

    let group_sql = "SELECT id, name, created_at, updated_at FROM unit_groups WHERE name = ?";
    let groups = db
        .query(group_sql, &[&name as &dyn rusqlite::ToSql], |row| {
            Ok(UnitGroup {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
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

/// Initialize units table schema
#[tauri::command]
fn init_units_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS units (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            group_id INTEGER REFERENCES unit_groups(id),
            ratio REAL NOT NULL DEFAULT 1.0,
            is_base INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create units table: {}", e))?;

    // Add new columns for existing databases
    let alter_sqls = vec![
        "ALTER TABLE units ADD COLUMN group_id INTEGER",
        "ALTER TABLE units ADD COLUMN ratio REAL NOT NULL DEFAULT 1.0",
        "ALTER TABLE units ADD COLUMN is_base INTEGER NOT NULL DEFAULT 0",
    ];
    for alter_sql in alter_sqls {
        let _ = db.execute(alter_sql, &[]);
    }

    Ok("Units table initialized successfully".to_string())
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
    db.execute(
        insert_sql,
        &[
            &name as &dyn rusqlite::ToSql,
            &group_id as &dyn rusqlite::ToSql,
            &ratio as &dyn rusqlite::ToSql,
            &is_base_int as &dyn rusqlite::ToSql,
        ],
    )
    .map_err(|e| format!("Failed to insert unit: {}", e))?;

    let unit_sql = "SELECT u.id, u.name, u.created_at, u.updated_at, u.group_id, u.ratio, u.is_base, g.name FROM units u LEFT JOIN unit_groups g ON u.group_id = g.id WHERE u.name = ? ORDER BY u.id DESC LIMIT 1";
    let units = db
        .query(unit_sql, &[&name as &dyn rusqlite::ToSql], |row| {
            Ok(Unit {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                group_id: row.get(4)?,
                ratio: row.get(5)?,
                is_base: row.get::<_, i32>(6)? != 0,
                group_name: row.get(7)?,
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
        .query(sql, &[], |row| {
            Ok(Unit {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                group_id: row.get(4)?,
                ratio: row.get(5)?,
                is_base: row.get::<_, i32>(6)? != 0,
                group_name: row.get(7)?,
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
    db.execute(
        update_sql,
        &[
            &name as &dyn rusqlite::ToSql,
            &group_id as &dyn rusqlite::ToSql,
            &ratio as &dyn rusqlite::ToSql,
            &is_base_int as &dyn rusqlite::ToSql,
            &id as &dyn rusqlite::ToSql,
        ],
    )
    .map_err(|e| format!("Failed to update unit: {}", e))?;

    let unit_sql = "SELECT u.id, u.name, u.created_at, u.updated_at, u.group_id, u.ratio, u.is_base, g.name FROM units u LEFT JOIN unit_groups g ON u.group_id = g.id WHERE u.id = ?";
    let units = db
        .query(unit_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Unit {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
                group_id: row.get(4)?,
                ratio: row.get(5)?,
                is_base: row.get::<_, i32>(6)? != 0,
                group_name: row.get(7)?,
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
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
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

/// Initialize products table schema
#[tauri::command]
fn init_products_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            price REAL,
            currency_id INTEGER,
            supplier_id INTEGER,
            stock_quantity REAL,
            unit TEXT,
            image_path TEXT,
            bar_code TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (currency_id) REFERENCES currencies(id),
            FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create products table: {}", e))?;

    // Add new columns if they don't exist (for existing databases)
    let alter_sqls = vec![
        "ALTER TABLE products ADD COLUMN image_path TEXT",
        "ALTER TABLE products ADD COLUMN bar_code TEXT",
    ];
    
    for alter_sql in alter_sqls {
        let _ = db.execute(alter_sql, &[]);
    }

    Ok("Products table initialized successfully".to_string())
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
    db.execute(insert_sql, &[
        &name as &dyn rusqlite::ToSql,
        &description_str as &dyn rusqlite::ToSql,
        &price as &dyn rusqlite::ToSql,
        &currency_id as &dyn rusqlite::ToSql,
        &supplier_id as &dyn rusqlite::ToSql,
        &stock_quantity as &dyn rusqlite::ToSql,
        &unit_str as &dyn rusqlite::ToSql,
        &image_path_str as &dyn rusqlite::ToSql,
        &bar_code_str as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert product: {}", e))?;

    // Get the created product
    let product_sql = "SELECT id, name, description, price, currency_id, supplier_id, stock_quantity, unit, image_path, bar_code, created_at, updated_at FROM products WHERE name = ? ORDER BY id DESC LIMIT 1";
    let products = db
        .query(product_sql, &[&name as &dyn rusqlite::ToSql], |row| {
            Ok(Product {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get::<_, Option<String>>(2)?,
                price: row.get::<_, Option<f64>>(3)?,
                currency_id: row.get::<_, Option<i64>>(4)?,
                supplier_id: row.get::<_, Option<i64>>(5)?,
                stock_quantity: row.get::<_, Option<f64>>(6)?,
                unit: row.get::<_, Option<String>>(7)?,
                image_path: row.get::<_, Option<String>>(8)?,
                bar_code: row.get::<_, Option<String>>(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
            where_clause = "WHERE (name LIKE ?)".to_string();
            params.push(serde_json::Value::String(search_term.clone()));
        }
    }

    let count_sql = format!("SELECT COUNT(*) FROM products {}", where_clause);
    let total: i64 = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&count_sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();
        let count: i64 = stmt.query_row(rusqlite::params_from_iter(rusqlite_params.iter()), |row| row.get(0))
            .map_err(|e| anyhow::anyhow!("{}", e))?;
        Ok(count)
    }).map_err(|e| format!("Failed to count products: {}", e))?;

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

    let products = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
             match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                serde_json::Value::Number(n) => rusqlite::types::Value::Integer(n.as_i64().unwrap_or(0)),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();

        let rows = stmt.query_map(rusqlite::params_from_iter(rusqlite_params.iter()), |row| {
             Ok(Product {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get::<_, Option<String>>(2)?,
                price: row.get::<_, Option<f64>>(3)?,
                currency_id: row.get::<_, Option<i64>>(4)?,
                supplier_id: row.get::<_, Option<i64>>(5)?,
                stock_quantity: row.get::<_, Option<f64>>(6)?,
                unit: row.get::<_, Option<String>>(7)?,
                image_path: row.get::<_, Option<String>>(8)?,
                bar_code: row.get::<_, Option<String>>(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        }).map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| anyhow::anyhow!("{}", e))?);
        }
        Ok(result)
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
    db.execute(update_sql, &[
        &name as &dyn rusqlite::ToSql,
        &description_str as &dyn rusqlite::ToSql,
        &price as &dyn rusqlite::ToSql,
        &currency_id as &dyn rusqlite::ToSql,
        &supplier_id as &dyn rusqlite::ToSql,
        &stock_quantity as &dyn rusqlite::ToSql,
        &unit_str as &dyn rusqlite::ToSql,
        &image_path_str as &dyn rusqlite::ToSql,
        &bar_code_str as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update product: {}", e))?;

    // Get the updated product
    let product_sql = "SELECT id, name, description, price, currency_id, supplier_id, stock_quantity, unit, image_path, bar_code, created_at, updated_at FROM products WHERE id = ?";
    let products = db
        .query(product_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Product {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get::<_, Option<String>>(2)?,
                price: row.get::<_, Option<f64>>(3)?,
                currency_id: row.get::<_, Option<i64>>(4)?,
                supplier_id: row.get::<_, Option<i64>>(5)?,
                stock_quantity: row.get::<_, Option<f64>>(6)?,
                unit: row.get::<_, Option<String>>(7)?,
                image_path: row.get::<_, Option<String>>(8)?,
                bar_code: row.get::<_, Option<String>>(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
        .query(purchase_check_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get(0)?)
        })
        .map_err(|e| format!("Failed to check purchase items: {}", e))?
        .first()
        .cloned()
        .unwrap_or(0);

    // Check if product is used in sale_items
    let sale_check_sql = "SELECT COUNT(*) FROM sale_items WHERE product_id = ?";
    let sale_count: i64 = db
        .query(sale_check_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get(0)?)
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
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
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

/// Initialize purchases table schema
#[tauri::command]
fn init_purchases_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS purchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            supplier_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            notes TEXT,
            currency_id INTEGER,
            total_amount REAL NOT NULL DEFAULT 0,
            additional_cost REAL NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
            FOREIGN KEY (currency_id) REFERENCES currencies(id)
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create purchases table: {}", e))?;

    // Add additional_cost column if it doesn't exist (for existing databases)
    let alter_sql = "ALTER TABLE purchases ADD COLUMN additional_cost REAL NOT NULL DEFAULT 0";
    let _ = db.execute(alter_sql, &[]);
    
    // Add currency_id column if it doesn't exist (for existing databases)
    let alter_currency_sql = "ALTER TABLE purchases ADD COLUMN currency_id INTEGER";
    let _ = db.execute(alter_currency_sql, &[]);
    
    // Add batch_number column if it doesn't exist (for existing databases)
    let alter_batch_sql = "ALTER TABLE purchases ADD COLUMN batch_number TEXT";
    let _ = db.execute(alter_batch_sql, &[]);

    let create_items_table_sql = "
        CREATE TABLE IF NOT EXISTS purchase_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            purchase_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            unit_id INTEGER NOT NULL,
            per_price REAL NOT NULL,
            amount REAL NOT NULL,
            total REAL NOT NULL,
            per_unit REAL,
            cost_price REAL,
            wholesale_price REAL,
            retail_price REAL,
            expiry_date TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (unit_id) REFERENCES units(id)
        )
    ";

    db.execute(create_items_table_sql, &[])
        .map_err(|e| format!("Failed to create purchase_items table: {}", e))?;
    
    // Add new columns to purchase_items if they don't exist (for existing databases)
    let alter_per_unit_sql = "ALTER TABLE purchase_items ADD COLUMN per_unit REAL";
    let _ = db.execute(alter_per_unit_sql, &[]);
    
    let alter_cost_price_sql = "ALTER TABLE purchase_items ADD COLUMN cost_price REAL";
    let _ = db.execute(alter_cost_price_sql, &[]);
    
    let alter_wholesale_price_sql = "ALTER TABLE purchase_items ADD COLUMN wholesale_price REAL";
    let _ = db.execute(alter_wholesale_price_sql, &[]);
    
    let alter_retail_price_sql = "ALTER TABLE purchase_items ADD COLUMN retail_price REAL";
    let _ = db.execute(alter_retail_price_sql, &[]);
    
    // Note: selling_price column will remain in old databases but won't be used
    // SQLite doesn't support DROP COLUMN, so we'll just ignore it
    
    let alter_expiry_date_sql = "ALTER TABLE purchase_items ADD COLUMN expiry_date TEXT";
    let _ = db.execute(alter_expiry_date_sql, &[]);

    // Create purchase_additional_costs table
    let create_additional_costs_table_sql = "
        CREATE TABLE IF NOT EXISTS purchase_additional_costs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            purchase_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            amount REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
        )
    ";

    db.execute(create_additional_costs_table_sql, &[])
        .map_err(|e| format!("Failed to create purchase_additional_costs table: {}", e))?;

    Ok("Purchases and purchase_items tables initialized successfully".to_string())
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
    let batch_number_sql = "SELECT COALESCE(MAX(CAST(SUBSTR(batch_number, 7) AS INTEGER)), 0) + 1 FROM purchases WHERE batch_number LIKE 'BATCH-%'";
    let batch_numbers = db
        .query(batch_number_sql, &[], |row| {
            Ok(row.get::<_, i64>(0)?)
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
    db.execute(insert_sql, &[
        &supplier_id as &dyn rusqlite::ToSql,
        &date as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
        &currency_id as &dyn rusqlite::ToSql,
        &total_amount as &dyn rusqlite::ToSql,
        &batch_number as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert purchase: {}", e))?;

    // Get the created purchase ID
    let purchase_id_sql = "SELECT id FROM purchases WHERE supplier_id = ? AND date = ? ORDER BY id DESC LIMIT 1";
    let purchase_ids = db
        .query(purchase_id_sql, &[&supplier_id as &dyn rusqlite::ToSql, &date as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
        })
        .map_err(|e| format!("Failed to fetch purchase ID: {}", e))?;

    let purchase_id = purchase_ids.first().ok_or("Failed to retrieve purchase ID")?;

    // Insert purchase items
    for (product_id, unit_id, per_price, amount, per_unit, cost_price, wholesale_price, retail_price, expiry_date) in items {
        let total = per_price * amount;
        let insert_item_sql = "INSERT INTO purchase_items (purchase_id, product_id, unit_id, per_price, amount, total, per_unit, cost_price, wholesale_price, retail_price, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        db.execute(insert_item_sql, &[
            purchase_id as &dyn rusqlite::ToSql,
            &product_id as &dyn rusqlite::ToSql,
            &unit_id as &dyn rusqlite::ToSql,
            &per_price as &dyn rusqlite::ToSql,
            &amount as &dyn rusqlite::ToSql,
            &total as &dyn rusqlite::ToSql,
            &per_unit as &dyn rusqlite::ToSql,
            &cost_price as &dyn rusqlite::ToSql,
            &wholesale_price as &dyn rusqlite::ToSql,
            &retail_price as &dyn rusqlite::ToSql,
            &expiry_date as &dyn rusqlite::ToSql,
        ])
            .map_err(|e| format!("Failed to insert purchase item: {}", e))?;
    }

    // Insert additional costs
    for (name, amount) in additional_costs {
        let insert_cost_sql = "INSERT INTO purchase_additional_costs (purchase_id, name, amount) VALUES (?, ?, ?)";
        db.execute(insert_cost_sql, &[
            purchase_id as &dyn rusqlite::ToSql,
            &name as &dyn rusqlite::ToSql,
            &amount as &dyn rusqlite::ToSql,
        ])
            .map_err(|e| format!("Failed to insert purchase additional cost: {}", e))?;
    }

    // Get the created purchase (calculate additional_cost from the table for backward compatibility)
    let purchase_sql = "SELECT id, supplier_id, date, notes, currency_id, total_amount, batch_number, created_at, updated_at FROM purchases WHERE id = ?";
    let purchases = db
        .query(purchase_sql, &[purchase_id as &dyn rusqlite::ToSql], |row| {
            Ok(Purchase {
                id: row.get(0)?,
                supplier_id: row.get(1)?,
                date: row.get(2)?,
                notes: row.get(3)?,
                currency_id: row.get(4)?,
                total_amount: row.get(5)?,
                additional_cost: additional_costs_total, // Sum of all additional costs
                batch_number: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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
    let total: i64 = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&count_sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();
        let count: i64 = stmt.query_row(rusqlite::params_from_iter(rusqlite_params.iter()), |row| row.get(0))
            .map_err(|e| anyhow::anyhow!("{}", e))?;
        Ok(count)
    }).map_err(|e| format!("Failed to count purchases: {}", e))?;

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

    let purchases = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                serde_json::Value::Number(n) => rusqlite::types::Value::Integer(n.as_i64().unwrap_or(0)),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();

        let rows = stmt.query_map(rusqlite::params_from_iter(rusqlite_params.iter()), |row| {
            Ok(Purchase {
                id: row.get(0)?,
                supplier_id: row.get(1)?,
                date: row.get(2)?,
                notes: row.get(3)?,
                currency_id: row.get(4)?,
                total_amount: row.get(5)?,
                additional_cost: 0.0, // Will be calculated from purchase_additional_costs table
                batch_number: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        }).map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut result = Vec::new();
        for row in rows {
            let mut purchase = row.map_err(|e| anyhow::anyhow!("{}", e))?;
            // Calculate additional_cost from purchase_additional_costs table
            let additional_costs_sql = "SELECT COALESCE(SUM(amount), 0) FROM purchase_additional_costs WHERE purchase_id = ?";
            let additional_cost: f64 = conn.query_row(additional_costs_sql, &[&purchase.id as &dyn rusqlite::ToSql], |row| {
                Ok(row.get::<_, f64>(0)?)
            }).unwrap_or(0.0);
            purchase.additional_cost = additional_cost;
            result.push(purchase);
        }
        Ok(result)
    }).map_err(|e| format!("Failed to fetch purchases: {}", e))?;

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
        .query(purchase_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Purchase {
                id: row.get(0)?,
                supplier_id: row.get(1)?,
                date: row.get(2)?,
                notes: row.get(3)?,
                currency_id: row.get(4)?,
                total_amount: row.get(5)?,
                additional_cost: 0.0, // Will be calculated from purchase_additional_costs table
                batch_number: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch purchase: {}", e))?;

    let mut purchase = purchases.first().ok_or("Purchase not found")?.clone();

    // Calculate additional_cost from purchase_additional_costs table
    let additional_costs_sql = "SELECT COALESCE(SUM(amount), 0) FROM purchase_additional_costs WHERE purchase_id = ?";
    let additional_cost_results: Vec<f64> = db
        .query(additional_costs_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, f64>(0)?)
        })
        .map_err(|e| format!("Failed to calculate additional cost: {}", e))?;
    let additional_cost = additional_cost_results.first().copied().unwrap_or(0.0);
    purchase.additional_cost = additional_cost;

    // Get purchase items
    let items_sql = "SELECT id, purchase_id, product_id, unit_id, per_price, amount, total, per_unit, cost_price, wholesale_price, retail_price, expiry_date, created_at FROM purchase_items WHERE purchase_id = ?";
    let items = db
        .query(items_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(PurchaseItem {
                id: row.get(0)?,
                purchase_id: row.get(1)?,
                product_id: row.get(2)?,
                unit_id: row.get(3)?,
                per_price: row.get(4)?,
                amount: row.get(5)?,
                total: row.get(6)?,
                per_unit: row.get(7)?,
                cost_price: row.get(8)?,
                wholesale_price: row.get(9)?,
                retail_price: row.get(10)?,
                expiry_date: row.get(11)?,
                created_at: row.get(12)?,
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
    db.execute(update_sql, &[
        &supplier_id as &dyn rusqlite::ToSql,
        &date as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
        &currency_id as &dyn rusqlite::ToSql,
        &total_amount as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update purchase: {}", e))?;

    // Delete existing items
    let delete_items_sql = "DELETE FROM purchase_items WHERE purchase_id = ?";
    db.execute(delete_items_sql, &[&id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to delete purchase items: {}", e))?;

    // Delete existing additional costs
    let delete_costs_sql = "DELETE FROM purchase_additional_costs WHERE purchase_id = ?";
    db.execute(delete_costs_sql, &[&id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to delete purchase additional costs: {}", e))?;

    // Insert new items
    for (product_id, unit_id, per_price, amount, per_unit, cost_price, wholesale_price, retail_price, expiry_date) in items {
        let total = per_price * amount;
        let insert_item_sql = "INSERT INTO purchase_items (purchase_id, product_id, unit_id, per_price, amount, total, per_unit, cost_price, wholesale_price, retail_price, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        db.execute(insert_item_sql, &[
            &id as &dyn rusqlite::ToSql,
            &product_id as &dyn rusqlite::ToSql,
            &unit_id as &dyn rusqlite::ToSql,
            &per_price as &dyn rusqlite::ToSql,
            &amount as &dyn rusqlite::ToSql,
            &total as &dyn rusqlite::ToSql,
            &per_unit as &dyn rusqlite::ToSql,
            &cost_price as &dyn rusqlite::ToSql,
            &wholesale_price as &dyn rusqlite::ToSql,
            &retail_price as &dyn rusqlite::ToSql,
            &expiry_date as &dyn rusqlite::ToSql,
        ])
            .map_err(|e| format!("Failed to insert purchase item: {}", e))?;
    }

    // Insert additional costs
    for (name, amount) in additional_costs {
        let insert_cost_sql = "INSERT INTO purchase_additional_costs (purchase_id, name, amount) VALUES (?, ?, ?)";
        db.execute(insert_cost_sql, &[
            &id as &dyn rusqlite::ToSql,
            &name as &dyn rusqlite::ToSql,
            &amount as &dyn rusqlite::ToSql,
        ])
            .map_err(|e| format!("Failed to insert purchase additional cost: {}", e))?;
    }

    // Get the updated purchase (calculate additional_cost from the table for backward compatibility)
    let purchase_sql = "SELECT id, supplier_id, date, notes, currency_id, total_amount, batch_number, created_at, updated_at FROM purchases WHERE id = ?";
    let purchases = db
        .query(purchase_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Purchase {
                id: row.get(0)?,
                supplier_id: row.get(1)?,
                date: row.get(2)?,
                notes: row.get(3)?,
                currency_id: row.get(4)?,
                total_amount: row.get(5)?,
                additional_cost: additional_costs_total, // Sum of all additional costs
                batch_number: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
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
    db.execute(insert_sql, &[
        &purchase_id as &dyn rusqlite::ToSql,
        &product_id as &dyn rusqlite::ToSql,
        &unit_id as &dyn rusqlite::ToSql,
        &per_price as &dyn rusqlite::ToSql,
        &amount as &dyn rusqlite::ToSql,
        &total as &dyn rusqlite::ToSql,
        &None::<f64> as &dyn rusqlite::ToSql,
        &None::<f64> as &dyn rusqlite::ToSql,
        &None::<f64> as &dyn rusqlite::ToSql,
        &None::<f64> as &dyn rusqlite::ToSql,
        &None::<String> as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert purchase item: {}", e))?;

    // Update purchase total (items total + additional_cost)
    let update_purchase_sql = "UPDATE purchases SET total_amount = (SELECT COALESCE(SUM(total), 0) FROM purchase_items WHERE purchase_id = ?) + COALESCE((SELECT additional_cost FROM purchases WHERE id = ?), 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_purchase_sql, &[&purchase_id as &dyn rusqlite::ToSql, &purchase_id as &dyn rusqlite::ToSql, &purchase_id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to update purchase total: {}", e))?;

    // Get the created item
    let item_sql = "SELECT id, purchase_id, product_id, unit_id, per_price, amount, total, per_unit, cost_price, wholesale_price, retail_price, expiry_date, created_at FROM purchase_items WHERE purchase_id = ? AND product_id = ? ORDER BY id DESC LIMIT 1";
    let items = db
        .query(item_sql, &[&purchase_id as &dyn rusqlite::ToSql, &product_id as &dyn rusqlite::ToSql], |row| {
            Ok(PurchaseItem {
                id: row.get(0)?,
                purchase_id: row.get(1)?,
                product_id: row.get(2)?,
                unit_id: row.get(3)?,
                per_price: row.get(4)?,
                amount: row.get(5)?,
                total: row.get(6)?,
                per_unit: row.get(7)?,
                cost_price: row.get(8)?,
                wholesale_price: row.get(9)?,
                retail_price: row.get(10)?,
                expiry_date: row.get(11)?,
                created_at: row.get(12)?,
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
        .query(sql, &[&purchase_id as &dyn rusqlite::ToSql], |row| {
            Ok(PurchaseItem {
                id: row.get(0)?,
                purchase_id: row.get(1)?,
                product_id: row.get(2)?,
                unit_id: row.get(3)?,
                per_price: row.get(4)?,
                amount: row.get(5)?,
                total: row.get(6)?,
                per_unit: row.get(7)?,
                cost_price: row.get(8)?,
                wholesale_price: row.get(9)?,
                retail_price: row.get(10)?,
                expiry_date: row.get(11)?,
                created_at: row.get(12)?,
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
        .query(sql, &[&purchase_id as &dyn rusqlite::ToSql], |row| {
            Ok(PurchaseAdditionalCost {
                id: row.get(0)?,
                purchase_id: row.get(1)?,
                name: row.get(2)?,
                amount: row.get(3)?,
                created_at: row.get(4)?,
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
    db.execute(update_sql, &[
        &product_id as &dyn rusqlite::ToSql,
        &unit_id as &dyn rusqlite::ToSql,
        &per_price as &dyn rusqlite::ToSql,
        &amount as &dyn rusqlite::ToSql,
        &total as &dyn rusqlite::ToSql,
        &None::<f64> as &dyn rusqlite::ToSql,
        &None::<f64> as &dyn rusqlite::ToSql,
        &None::<f64> as &dyn rusqlite::ToSql,
        &None::<f64> as &dyn rusqlite::ToSql,
        &None::<String> as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update purchase item: {}", e))?;

    // Get purchase_id to update purchase total
    let purchase_id_sql = "SELECT purchase_id FROM purchase_items WHERE id = ?";
    let purchase_ids = db
        .query(purchase_id_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
        })
        .map_err(|e| format!("Failed to fetch purchase_id: {}", e))?;

    if let Some(purchase_id) = purchase_ids.first() {
        // Update purchase total (items total + additional_cost)
        let update_purchase_sql = "UPDATE purchases SET total_amount = (SELECT COALESCE(SUM(total), 0) FROM purchase_items WHERE purchase_id = ?) + COALESCE((SELECT additional_cost FROM purchases WHERE id = ?), 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
        db.execute(update_purchase_sql, &[purchase_id as &dyn rusqlite::ToSql, purchase_id as &dyn rusqlite::ToSql, purchase_id as &dyn rusqlite::ToSql])
            .map_err(|e| format!("Failed to update purchase total: {}", e))?;
    }

    // Get the updated item
    let item_sql = "SELECT id, purchase_id, product_id, unit_id, per_price, amount, total, per_unit, cost_price, wholesale_price, retail_price, expiry_date, created_at FROM purchase_items WHERE id = ?";
    let items = db
        .query(item_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(PurchaseItem {
                id: row.get(0)?,
                purchase_id: row.get(1)?,
                product_id: row.get(2)?,
                unit_id: row.get(3)?,
                per_price: row.get(4)?,
                amount: row.get(5)?,
                total: row.get(6)?,
                per_unit: row.get(7)?,
                cost_price: row.get(8)?,
                wholesale_price: row.get(9)?,
                retail_price: row.get(10)?,
                expiry_date: row.get(11)?,
                created_at: row.get(12)?,
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
        .query(purchase_id_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
        })
        .map_err(|e| format!("Failed to fetch purchase_id: {}", e))?;

    let purchase_id = purchase_ids.first().ok_or("Purchase item not found")?;

    let delete_sql = "DELETE FROM purchase_items WHERE id = ?";
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to delete purchase item: {}", e))?;

    // Update purchase total (items total + additional_cost)
    let update_purchase_sql = "UPDATE purchases SET total_amount = (SELECT COALESCE(SUM(total), 0) FROM purchase_items WHERE purchase_id = ?) + COALESCE((SELECT additional_cost FROM purchases WHERE id = ?), 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_purchase_sql, &[purchase_id as &dyn rusqlite::ToSql, purchase_id as &dyn rusqlite::ToSql, purchase_id as &dyn rusqlite::ToSql])
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

/// Initialize purchase payments table schema
#[tauri::command]
fn init_purchase_payments_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS purchase_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            purchase_id INTEGER NOT NULL,
            account_id INTEGER,
            amount REAL NOT NULL,
            currency TEXT NOT NULL,
            rate REAL NOT NULL,
            total REAL NOT NULL,
            date TEXT NOT NULL,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
            FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create purchase_payments table: {}", e))?;

    // Add account_id column if it doesn't exist (for existing databases)
    let _ = db.execute("ALTER TABLE purchase_payments ADD COLUMN account_id INTEGER", &[]);

    Ok("Purchase payments table initialized successfully".to_string())
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
    db.execute(insert_sql, &[
        &purchase_id as &dyn rusqlite::ToSql,
        &account_id as &dyn rusqlite::ToSql,
        &amount as &dyn rusqlite::ToSql,
        &currency as &dyn rusqlite::ToSql,
        &rate as &dyn rusqlite::ToSql,
        &total as &dyn rusqlite::ToSql,
        &date as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert purchase payment: {}", e))?;

    // If account_id is provided, withdraw the payment amount from the account
    if let Some(aid) = account_id {
        // Get currency_id from currency name
        let currency_sql = "SELECT id FROM currencies WHERE name = ? LIMIT 1";
        let currency_ids = db
            .query(currency_sql, &[&currency as &dyn rusqlite::ToSql], |row| {
                Ok(row.get::<_, i64>(0)?)
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
            db.execute(insert_transaction_sql, &[
                &aid as &dyn rusqlite::ToSql,
                &amount as &dyn rusqlite::ToSql,
                &currency as &dyn rusqlite::ToSql,
                &rate as &dyn rusqlite::ToSql,
                &total as &dyn rusqlite::ToSql,
                &date as &dyn rusqlite::ToSql,
                &is_full_int as &dyn rusqlite::ToSql,
                &payment_notes_str as &dyn rusqlite::ToSql,
            ])
            .map_err(|e| format!("Failed to create account transaction: {}", e))?;
            
            // Subtract the payment amount from the balance
            let new_balance = current_balance - amount;
            
            // Update account currency balance
            update_account_currency_balance_internal(db, aid, *currency_id, new_balance)?;
            
            // Update account's current_balance
            let new_account_balance = calculate_account_balance_internal(db, aid)?;
            let update_balance_sql = "UPDATE accounts SET current_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
            db.execute(update_balance_sql, &[
                &new_account_balance as &dyn rusqlite::ToSql,
                &aid as &dyn rusqlite::ToSql,
            ])
            .map_err(|e| format!("Failed to update account balance: {}", e))?;
        }
    }

    // Get the created payment
    let payment_sql = "SELECT id, purchase_id, account_id, amount, currency, rate, total, date, notes, created_at FROM purchase_payments WHERE purchase_id = ? ORDER BY id DESC LIMIT 1";
    let payments = db
        .query(payment_sql, &[&purchase_id as &dyn rusqlite::ToSql], |row| {
            Ok(PurchasePayment {
                id: row.get(0)?,
                purchase_id: row.get(1)?,
                account_id: row.get(2)?,
                amount: row.get(3)?,
                currency: row.get(4)?,
                rate: row.get(5)?,
                total: row.get(6)?,
                date: row.get(7)?,
                notes: row.get(8)?,
                created_at: row.get(9)?,
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
    let total: i64 = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&count_sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();
        let count: i64 = stmt.query_row(rusqlite::params_from_iter(rusqlite_params.iter()), |row| row.get(0))
            .map_err(|e| anyhow::anyhow!("{}", e))?;
        Ok(count)
    }).map_err(|e| format!("Failed to count purchase payments: {}", e))?;

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
    let payments = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let mut rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();
        rusqlite_params.push(rusqlite::types::Value::Integer(per_page));
        rusqlite_params.push(rusqlite::types::Value::Integer(offset));
        
        let mut rows = stmt.query(rusqlite::params_from_iter(rusqlite_params.iter()))
            .map_err(|e| anyhow::anyhow!("{}", e))?;
        
        let mut payments = Vec::new();
        while let Some(row) = rows.next().map_err(|e| anyhow::anyhow!("{}", e))? {
            payments.push(PurchasePayment {
                id: row.get(0)?,
                purchase_id: row.get(1)?,
                account_id: row.get(2)?,
                amount: row.get(3)?,
                currency: row.get(4)?,
                rate: row.get(5)?,
                total: row.get(6)?,
                date: row.get(7)?,
                notes: row.get(8)?,
                created_at: row.get(9)?,
            });
        }
        Ok(payments)
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
        .query(sql, &[&purchase_id as &dyn rusqlite::ToSql], |row| {
            Ok(PurchasePayment {
                id: row.get(0)?,
                purchase_id: row.get(1)?,
                account_id: row.get(2)?,
                amount: row.get(3)?,
                currency: row.get(4)?,
                rate: row.get(5)?,
                total: row.get(6)?,
                date: row.get(7)?,
                notes: row.get(8)?,
                created_at: row.get(9)?,
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
    db.execute(update_sql, &[
        &amount as &dyn rusqlite::ToSql,
        &currency as &dyn rusqlite::ToSql,
        &rate as &dyn rusqlite::ToSql,
        &total as &dyn rusqlite::ToSql,
        &date as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update purchase payment: {}", e))?;

    // Get the updated payment
    let payment_sql = "SELECT id, purchase_id, account_id, amount, currency, rate, total, date, notes, created_at FROM purchase_payments WHERE id = ?";
    let payments = db
        .query(payment_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(PurchasePayment {
                id: row.get(0)?,
                purchase_id: row.get(1)?,
                account_id: row.get(2)?,
                amount: row.get(3)?,
                currency: row.get(4)?,
                rate: row.get(5)?,
                total: row.get(6)?,
                date: row.get(7)?,
                notes: row.get(8)?,
                created_at: row.get(9)?,
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
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
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

/// Initialize sales table schema
#[tauri::command]
fn init_sales_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            notes TEXT,
            currency_id INTEGER,
            exchange_rate REAL NOT NULL DEFAULT 1,
            total_amount REAL NOT NULL DEFAULT 0,
            base_amount REAL NOT NULL DEFAULT 0,
            paid_amount REAL NOT NULL DEFAULT 0,
            additional_cost REAL NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers(id),
            FOREIGN KEY (currency_id) REFERENCES currencies(id)
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create sales table: {}", e))?;

    // Add new columns if they don't exist (for existing databases)
    let alter_queries = vec![
        "ALTER TABLE sales ADD COLUMN additional_cost REAL NOT NULL DEFAULT 0",
        "ALTER TABLE sales ADD COLUMN currency_id INTEGER",
        "ALTER TABLE sales ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1",
        "ALTER TABLE sales ADD COLUMN base_amount REAL NOT NULL DEFAULT 0",
    ];

    for alter_sql in alter_queries {
        let _ = db.execute(alter_sql, &[]);
    }

    let create_items_table_sql = "
        CREATE TABLE IF NOT EXISTS sale_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            unit_id INTEGER NOT NULL,
            per_price REAL NOT NULL,
            amount REAL NOT NULL,
            total REAL NOT NULL,
            purchase_item_id INTEGER,
            sale_type TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id),
            FOREIGN KEY (unit_id) REFERENCES units(id),
            FOREIGN KEY (purchase_item_id) REFERENCES purchase_items(id)
        )
    ";

    db.execute(create_items_table_sql, &[])
        .map_err(|e| format!("Failed to create sale_items table: {}", e))?;

    // Add new columns if they don't exist (for existing databases)
    let alter_sale_items_queries = vec![
        "ALTER TABLE sale_items ADD COLUMN purchase_item_id INTEGER",
        "ALTER TABLE sale_items ADD COLUMN sale_type TEXT",
    ];

    for alter_sql in alter_sale_items_queries {
        let _ = db.execute(alter_sql, &[]);
    }

    let create_payments_table_sql = "
        CREATE TABLE IF NOT EXISTS sale_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER NOT NULL,
            account_id INTEGER,
            currency_id INTEGER,
            exchange_rate REAL NOT NULL DEFAULT 1,
            amount REAL NOT NULL,
            base_amount REAL NOT NULL DEFAULT 0,
            date TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
            FOREIGN KEY (account_id) REFERENCES accounts(id),
            FOREIGN KEY (currency_id) REFERENCES currencies(id)
        )
    ";

    db.execute(create_payments_table_sql, &[])
        .map_err(|e| format!("Failed to create sale_payments table: {}", e))?;

    // Add new columns if they don't exist (for existing databases)
    let alter_payment_queries = vec![
        "ALTER TABLE sale_payments ADD COLUMN account_id INTEGER",
        "ALTER TABLE sale_payments ADD COLUMN currency_id INTEGER",
        "ALTER TABLE sale_payments ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1",
        "ALTER TABLE sale_payments ADD COLUMN base_amount REAL NOT NULL DEFAULT 0",
    ];

    for alter_sql in alter_payment_queries {
        let _ = db.execute(alter_sql, &[]);
    }

    let create_additional_costs_table_sql = "
        CREATE TABLE IF NOT EXISTS sale_additional_costs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            amount REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
        )
    ";

    db.execute(create_additional_costs_table_sql, &[])
        .map_err(|e| format!("Failed to create sale_additional_costs table: {}", e))?;

    Ok("Sales, sale_items, sale_payments, and sale_additional_costs tables initialized successfully".to_string())
}

/// Create a new sale with items
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
    items: Vec<(i64, i64, f64, f64, Option<i64>, Option<String>)>, // (product_id, unit_id, per_price, amount, purchase_item_id, sale_type)
) -> Result<Sale, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Calculate total amount from items + additional costs
    let items_total: f64 = items.iter().map(|(_, _, per_price, amount, _, _)| per_price * amount).sum();
    let additional_costs_total: f64 = additional_costs.iter().map(|(_, amount)| amount).sum();
    let total_amount = items_total + additional_costs_total;
    let base_amount = total_amount * exchange_rate;

    // Insert sale (keep additional_cost column for backward compatibility - sum of all additional costs)
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    let insert_sql = "INSERT INTO sales (customer_id, date, notes, currency_id, exchange_rate, total_amount, base_amount, paid_amount, additional_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, &[
        &customer_id as &dyn rusqlite::ToSql,
        &date as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
        &currency_id as &dyn rusqlite::ToSql,
        &exchange_rate as &dyn rusqlite::ToSql,
        &total_amount as &dyn rusqlite::ToSql,
        &base_amount as &dyn rusqlite::ToSql,
        &paid_amount as &dyn rusqlite::ToSql,
        &additional_costs_total as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert sale: {}", e))?;

    // Get the created sale ID
    let sale_id_sql = "SELECT id FROM sales WHERE customer_id = ? AND date = ? ORDER BY id DESC LIMIT 1";
    let sale_ids = db
        .query(sale_id_sql, &[&customer_id as &dyn rusqlite::ToSql, &date as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
        })
        .map_err(|e| format!("Failed to fetch sale ID: {}", e))?;

    let sale_id = sale_ids.first().ok_or("Failed to retrieve sale ID")?;

    // Get base currency ID (first currency marked as base, or first currency)
    let base_currency_sql = "SELECT id FROM currencies WHERE base = 1 LIMIT 1";
    let base_currencies = db.query(base_currency_sql, &[], |row| Ok(row.get::<_, i64>(0)?))
        .map_err(|e| format!("Failed to get base currency: {}", e))?;
    let base_currency_id = base_currencies.first().copied().unwrap_or_else(|| {
        // Fallback to first currency if no base currency set
        db.query("SELECT id FROM currencies LIMIT 1", &[], |row| Ok(row.get::<_, i64>(0)?))
            .ok()
            .and_then(|v| v.first().copied())
            .unwrap_or(1)
    });

    // Create journal entry for sale: Debit Accounts Receivable, Credit Sales Revenue
    // Note: This assumes accounts exist for AR and Sales Revenue - in production, these should be configurable
    let ar_account_sql = "SELECT id FROM accounts WHERE account_type = 'Asset' AND name LIKE '%Receivable%' LIMIT 1";
    let ar_accounts = db.query(ar_account_sql, &[], |row| Ok(row.get::<_, i64>(0)?))
        .ok()
        .and_then(|v| v.first().copied());
    
    let revenue_account_sql = "SELECT id FROM accounts WHERE account_type = 'Revenue' LIMIT 1";
    let revenue_accounts = db.query(revenue_account_sql, &[], |row| Ok(row.get::<_, i64>(0)?))
        .ok()
        .and_then(|v| v.first().copied());

    // Only create journal entry if accounts exist
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
        db.execute(insert_payment_sql, &[
            sale_id as &dyn rusqlite::ToSql,
            &payment_currency_id as &dyn rusqlite::ToSql,
            &exchange_rate as &dyn rusqlite::ToSql,
            &paid_amount as &dyn rusqlite::ToSql,
            &payment_base_amount as &dyn rusqlite::ToSql,
            &date as &dyn rusqlite::ToSql,
        ])
            .map_err(|e| format!("Failed to insert initial payment: {}", e))?;
    }

    // Insert sale items
    for (product_id, unit_id, per_price, amount, purchase_item_id, sale_type) in items {
        let total = per_price * amount;
        let insert_item_sql = "INSERT INTO sale_items (sale_id, product_id, unit_id, per_price, amount, total, purchase_item_id, sale_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
        db.execute(insert_item_sql, &[
            sale_id as &dyn rusqlite::ToSql,
            &product_id as &dyn rusqlite::ToSql,
            &unit_id as &dyn rusqlite::ToSql,
            &per_price as &dyn rusqlite::ToSql,
            &amount as &dyn rusqlite::ToSql,
            &total as &dyn rusqlite::ToSql,
            &purchase_item_id as &dyn rusqlite::ToSql,
            &sale_type as &dyn rusqlite::ToSql,
        ])
            .map_err(|e| format!("Failed to insert sale item: {}", e))?;
    }

    // Insert additional costs
    for (name, amount) in additional_costs {
        let insert_cost_sql = "INSERT INTO sale_additional_costs (sale_id, name, amount) VALUES (?, ?, ?)";
        db.execute(insert_cost_sql, &[
            sale_id as &dyn rusqlite::ToSql,
            &name as &dyn rusqlite::ToSql,
            &amount as &dyn rusqlite::ToSql,
        ])
            .map_err(|e| format!("Failed to insert sale additional cost: {}", e))?;
    }

    // Get the created sale
    let sale_sql = "SELECT id, customer_id, date, notes, currency_id, exchange_rate, total_amount, base_amount, paid_amount, additional_cost, created_at, updated_at FROM sales WHERE id = ?";
    let sales = db
        .query(sale_sql, &[sale_id as &dyn rusqlite::ToSql], |row| {
            Ok(Sale {
                id: row.get(0)?,
                customer_id: row.get(1)?,
                date: row.get(2)?,
                notes: row.get(3)?,
                currency_id: row.get(4)?,
                exchange_rate: row.get(5)?,
                total_amount: row.get(6)?,
                base_amount: row.get(7)?,
                paid_amount: row.get(8)?,
                additional_cost: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
            where_clause = "WHERE (CAST(s.date AS TEXT) LIKE ? OR s.notes LIKE ? OR s.customer_id IN (SELECT id FROM customers WHERE full_name LIKE ? OR phone LIKE ?))".to_string();
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term));
        }
    }

    // Get total count
    let count_sql = format!("SELECT COUNT(*) FROM sales s {}", where_clause);
    let total: i64 = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&count_sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();
        let count: i64 = stmt.query_row(rusqlite::params_from_iter(rusqlite_params.iter()), |row| row.get(0))
            .map_err(|e| anyhow::anyhow!("{}", e))?;
        Ok(count)
    }).map_err(|e| format!("Failed to count sales: {}", e))?;

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

    let sql = format!("SELECT s.id, s.customer_id, s.date, s.notes, s.currency_id, s.exchange_rate, s.total_amount, s.base_amount, s.paid_amount, s.additional_cost, s.created_at, s.updated_at FROM sales s {} {} LIMIT ? OFFSET ?", where_clause, order_clause);
    
    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));

    let sales = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                serde_json::Value::Number(n) => rusqlite::types::Value::Integer(n.as_i64().unwrap_or(0)),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();

        let rows = stmt.query_map(rusqlite::params_from_iter(rusqlite_params.iter()), |row| {
            Ok(Sale {
                id: row.get(0)?,
                customer_id: row.get(1)?,
                date: row.get(2)?,
                notes: row.get::<_, Option<String>>(3)?,
                currency_id: row.get(4)?,
                exchange_rate: row.get(5)?,
                total_amount: row.get(6)?,
                base_amount: row.get(7)?,
                paid_amount: row.get(8)?,
                additional_cost: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        }).map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| anyhow::anyhow!("{}", e))?);
        }
        Ok(result)
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

/// Get a single sale with its items
#[tauri::command]
fn get_sale(db_state: State<'_, Mutex<Option<Database>>>, id: i64) -> Result<(Sale, Vec<SaleItem>), String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Get sale
    let sale_sql = "SELECT id, customer_id, date, notes, currency_id, exchange_rate, total_amount, base_amount, paid_amount, additional_cost, created_at, updated_at FROM sales WHERE id = ?";
    let sales = db
        .query(sale_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Sale {
                id: row.get(0)?,
                customer_id: row.get(1)?,
                date: row.get(2)?,
                notes: row.get(3)?,
                currency_id: row.get(4)?,
                exchange_rate: row.get(5)?,
                total_amount: row.get(6)?,
                base_amount: row.get(7)?,
                paid_amount: row.get(8)?,
                additional_cost: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        })
        .map_err(|e| format!("Failed to fetch sale: {}", e))?;

    let sale = sales.first().ok_or("Sale not found")?;

    // Get sale items
    let items_sql = "SELECT id, sale_id, product_id, unit_id, per_price, amount, total, purchase_item_id, sale_type, created_at FROM sale_items WHERE sale_id = ?";
    let items = db
        .query(items_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(SaleItem {
                id: row.get(0)?,
                sale_id: row.get(1)?,
                product_id: row.get(2)?,
                unit_id: row.get(3)?,
                per_price: row.get(4)?,
                amount: row.get(5)?,
                total: row.get(6)?,
                purchase_item_id: row.get(7)?,
                sale_type: row.get(8)?,
                created_at: row.get(9)?,
            })
        })
        .map_err(|e| format!("Failed to fetch sale items: {}", e))?;

    Ok((sale.clone(), items))
}

/// Get sale additional costs
#[tauri::command]
fn get_sale_additional_costs(db_state: State<'_, Mutex<Option<Database>>>, sale_id: i64) -> Result<Vec<SaleAdditionalCost>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, sale_id, name, amount, created_at FROM sale_additional_costs WHERE sale_id = ? ORDER BY id";
    let costs = db
        .query(sql, &[&sale_id as &dyn rusqlite::ToSql], |row| {
            Ok(SaleAdditionalCost {
                id: row.get(0)?,
                sale_id: row.get(1)?,
                name: row.get(2)?,
                amount: row.get(3)?,
                created_at: row.get(4)?,
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
    items: Vec<(i64, i64, f64, f64, Option<i64>, Option<String>)>, // (product_id, unit_id, per_price, amount, purchase_item_id, sale_type)
) -> Result<Sale, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Calculate total amount from items + additional costs
    let items_total: f64 = items.iter().map(|(_, _, per_price, amount, _, _)| per_price * amount).sum();
    let additional_costs_total: f64 = additional_costs.iter().map(|(_, amount)| amount).sum();
    let total_amount = items_total + additional_costs_total;
    let base_amount = total_amount * exchange_rate;

    // Update sale (excluding paid_amount, keep additional_cost column for backward compatibility)
    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    let update_sql = "UPDATE sales SET customer_id = ?, date = ?, notes = ?, currency_id = ?, exchange_rate = ?, total_amount = ?, base_amount = ?, additional_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sql, &[
        &customer_id as &dyn rusqlite::ToSql,
        &date as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
        &currency_id as &dyn rusqlite::ToSql,
        &exchange_rate as &dyn rusqlite::ToSql,
        &total_amount as &dyn rusqlite::ToSql,
        &base_amount as &dyn rusqlite::ToSql,
        &additional_costs_total as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update sale: {}", e))?;

    // Delete existing items
    let delete_items_sql = "DELETE FROM sale_items WHERE sale_id = ?";
    db.execute(delete_items_sql, &[&id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to delete sale items: {}", e))?;

    // Insert new items
    for (product_id, unit_id, per_price, amount, purchase_item_id, sale_type) in items {
        let total = per_price * amount;
        let insert_item_sql = "INSERT INTO sale_items (sale_id, product_id, unit_id, per_price, amount, total, purchase_item_id, sale_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
        db.execute(insert_item_sql, &[
            &id as &dyn rusqlite::ToSql,
            &product_id as &dyn rusqlite::ToSql,
            &unit_id as &dyn rusqlite::ToSql,
            &per_price as &dyn rusqlite::ToSql,
            &amount as &dyn rusqlite::ToSql,
            &total as &dyn rusqlite::ToSql,
            &purchase_item_id as &dyn rusqlite::ToSql,
            &sale_type as &dyn rusqlite::ToSql,
        ])
            .map_err(|e| format!("Failed to insert sale item: {}", e))?;
    }

    // Delete existing additional costs
    let delete_costs_sql = "DELETE FROM sale_additional_costs WHERE sale_id = ?";
    db.execute(delete_costs_sql, &[&id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to delete sale additional costs: {}", e))?;

    // Insert new additional costs
    for (name, amount) in additional_costs {
        let insert_cost_sql = "INSERT INTO sale_additional_costs (sale_id, name, amount) VALUES (?, ?, ?)";
        db.execute(insert_cost_sql, &[
            &id as &dyn rusqlite::ToSql,
            &name as &dyn rusqlite::ToSql,
            &amount as &dyn rusqlite::ToSql,
        ])
            .map_err(|e| format!("Failed to insert sale additional cost: {}", e))?;
    }

    // Get the updated sale
    let sale_sql = "SELECT id, customer_id, date, notes, currency_id, exchange_rate, total_amount, base_amount, paid_amount, additional_cost, created_at, updated_at FROM sales WHERE id = ?";
    let sales = db
        .query(sale_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Sale {
                id: row.get(0)?,
                customer_id: row.get(1)?,
                date: row.get(2)?,
                notes: row.get(3)?,
                currency_id: row.get(4)?,
                exchange_rate: row.get(5)?,
                total_amount: row.get(6)?,
                base_amount: row.get(7)?,
                paid_amount: row.get(8)?,
                additional_cost: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
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
) -> Result<SaleItem, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let total = per_price * amount;

    let insert_sql = "INSERT INTO sale_items (sale_id, product_id, unit_id, per_price, amount, total, purchase_item_id, sale_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, &[
        &sale_id as &dyn rusqlite::ToSql,
        &product_id as &dyn rusqlite::ToSql,
        &unit_id as &dyn rusqlite::ToSql,
        &per_price as &dyn rusqlite::ToSql,
        &amount as &dyn rusqlite::ToSql,
        &total as &dyn rusqlite::ToSql,
        &purchase_item_id as &dyn rusqlite::ToSql,
        &sale_type as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert sale item: {}", e))?;

    // Update sale total (items total + additional_cost)
    let update_sale_sql = "UPDATE sales SET total_amount = (SELECT COALESCE(SUM(total), 0) FROM sale_items WHERE sale_id = ?) + COALESCE((SELECT additional_cost FROM sales WHERE id = ?), 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sale_sql, &[&sale_id as &dyn rusqlite::ToSql, &sale_id as &dyn rusqlite::ToSql, &sale_id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to update sale total: {}", e))?;

    // Get the created item
    let item_sql = "SELECT id, sale_id, product_id, unit_id, per_price, amount, total, purchase_item_id, sale_type, created_at FROM sale_items WHERE sale_id = ? AND product_id = ? ORDER BY id DESC LIMIT 1";
    let items = db
        .query(item_sql, &[&sale_id as &dyn rusqlite::ToSql, &product_id as &dyn rusqlite::ToSql], |row| {
            Ok(SaleItem {
                id: row.get(0)?,
                sale_id: row.get(1)?,
                product_id: row.get(2)?,
                unit_id: row.get(3)?,
                per_price: row.get(4)?,
                amount: row.get(5)?,
                total: row.get(6)?,
                purchase_item_id: row.get(7)?,
                sale_type: row.get(8)?,
                created_at: row.get(9)?,
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

    let sql = "SELECT id, sale_id, product_id, unit_id, per_price, amount, total, purchase_item_id, sale_type, created_at FROM sale_items WHERE sale_id = ? ORDER BY id";
    let items = db
        .query(sql, &[&sale_id as &dyn rusqlite::ToSql], |row| {
            Ok(SaleItem {
                id: row.get(0)?,
                sale_id: row.get(1)?,
                product_id: row.get(2)?,
                unit_id: row.get(3)?,
                per_price: row.get(4)?,
                amount: row.get(5)?,
                total: row.get(6)?,
                purchase_item_id: row.get(7)?,
                sale_type: row.get(8)?,
                created_at: row.get(9)?,
            })
        })
        .map_err(|e| format!("Failed to fetch sale items: {}", e))?;

    Ok(items)
}

/// Get all batches for a product (from purchase_items)
#[tauri::command]
fn get_product_batches(db_state: State<'_, Mutex<Option<Database>>>, product_id: i64) -> Result<Vec<ProductBatch>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Query purchase_items with purchase info and calculate remaining quantity
    let sql = "
        SELECT 
            pi.id as purchase_item_id,
            pi.purchase_id,
            p.batch_number,
            p.date as purchase_date,
            pi.expiry_date,
            pi.per_price,
            pi.per_unit,
            pi.wholesale_price,
            pi.retail_price,
            pi.amount,
            (pi.amount - COALESCE(SUM(si.amount), 0)) as remaining_quantity
        FROM purchase_items pi
        INNER JOIN purchases p ON pi.purchase_id = p.id
        LEFT JOIN sale_items si ON si.purchase_item_id = pi.id
        WHERE pi.product_id = ?
        GROUP BY pi.id, pi.purchase_id, p.batch_number, p.date, pi.expiry_date, pi.per_price, pi.per_unit, pi.wholesale_price, pi.retail_price, pi.amount
        HAVING remaining_quantity > 0
        ORDER BY p.date ASC, pi.id ASC
    ";

    let batches = db
        .query(sql, &[&product_id as &dyn rusqlite::ToSql], |row| {
            Ok(ProductBatch {
                purchase_item_id: row.get(0)?,
                purchase_id: row.get(1)?,
                batch_number: row.get(2)?,
                purchase_date: row.get(3)?,
                expiry_date: row.get(4)?,
                per_price: row.get(5)?,
                per_unit: row.get(6)?,
                wholesale_price: row.get(7)?,
                retail_price: row.get(8)?,
                amount: row.get(9)?,
                remaining_quantity: row.get(10)?,
            })
        })
        .map_err(|e| format!("Failed to fetch product batches: {}", e))?;

    Ok(batches)
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
) -> Result<SaleItem, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let total = per_price * amount;

    let update_sql = "UPDATE sale_items SET product_id = ?, unit_id = ?, per_price = ?, amount = ?, total = ?, purchase_item_id = ?, sale_type = ? WHERE id = ?";
    db.execute(update_sql, &[
        &product_id as &dyn rusqlite::ToSql,
        &unit_id as &dyn rusqlite::ToSql,
        &per_price as &dyn rusqlite::ToSql,
        &amount as &dyn rusqlite::ToSql,
        &total as &dyn rusqlite::ToSql,
        &purchase_item_id as &dyn rusqlite::ToSql,
        &sale_type as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update sale item: {}", e))?;

    // Get sale_id to update sale total
    let sale_id_sql = "SELECT sale_id FROM sale_items WHERE id = ?";
    let sale_ids = db
        .query(sale_id_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
        })
        .map_err(|e| format!("Failed to fetch sale_id: {}", e))?;

    if let Some(sale_id) = sale_ids.first() {
        // Update sale total (items total + additional_cost)
        let update_sale_sql = "UPDATE sales SET total_amount = (SELECT COALESCE(SUM(total), 0) FROM sale_items WHERE sale_id = ?) + COALESCE((SELECT additional_cost FROM sales WHERE id = ?), 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
        db.execute(update_sale_sql, &[sale_id as &dyn rusqlite::ToSql, sale_id as &dyn rusqlite::ToSql, sale_id as &dyn rusqlite::ToSql])
            .map_err(|e| format!("Failed to update sale total: {}", e))?;
    }

    // Get the updated item
    let item_sql = "SELECT id, sale_id, product_id, unit_id, per_price, amount, total, purchase_item_id, sale_type, created_at FROM sale_items WHERE id = ?";
    let items = db
        .query(item_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(SaleItem {
                id: row.get(0)?,
                sale_id: row.get(1)?,
                product_id: row.get(2)?,
                unit_id: row.get(3)?,
                per_price: row.get(4)?,
                amount: row.get(5)?,
                total: row.get(6)?,
                purchase_item_id: row.get(7)?,
                sale_type: row.get(8)?,
                created_at: row.get(9)?,
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
        .query(sale_id_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
        })
        .map_err(|e| format!("Failed to fetch sale_id: {}", e))?;

    let sale_id = sale_ids.first().ok_or("Sale item not found")?;

    let delete_sql = "DELETE FROM sale_items WHERE id = ?";
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to delete sale item: {}", e))?;

    // Update sale total (items total + additional_cost)
    let update_sale_sql = "UPDATE sales SET total_amount = (SELECT COALESCE(SUM(total), 0) FROM sale_items WHERE sale_id = ?) + COALESCE((SELECT additional_cost FROM sales WHERE id = ?), 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sale_sql, &[sale_id as &dyn rusqlite::ToSql, sale_id as &dyn rusqlite::ToSql, sale_id as &dyn rusqlite::ToSql])
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
        db.query(sale_currency_sql, &[&sale_id as &dyn rusqlite::ToSql], |row| Ok(row.get::<_, Option<i64>>(0)?))
            .ok()
            .and_then(|v| v.first().and_then(|c| *c))
            .unwrap_or_else(|| {
                // Fallback to base currency
                db.query("SELECT id FROM currencies WHERE base = 1 LIMIT 1", &[], |row| Ok(row.get::<_, i64>(0)?))
                    .ok()
                    .and_then(|v| v.first().copied())
                    .unwrap_or(1)
            })
    });

    let insert_sql = "INSERT INTO sale_payments (sale_id, account_id, currency_id, exchange_rate, amount, base_amount, date) VALUES (?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, &[
        &sale_id as &dyn rusqlite::ToSql,
        &account_id as &dyn rusqlite::ToSql,
        &payment_currency_id as &dyn rusqlite::ToSql,
        &exchange_rate as &dyn rusqlite::ToSql,
        &amount as &dyn rusqlite::ToSql,
        &base_amount as &dyn rusqlite::ToSql,
        &date as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert sale payment: {}", e))?;

    // If account_id is provided, deposit the payment amount to the account
    if let Some(aid) = account_id {
        // Get current balance for the account's currency
        let current_balance = get_account_balance_by_currency_internal(db, aid, payment_currency_id)
            .unwrap_or(0.0);
        
        // Get currency name for transaction record
        let currency_name_sql = "SELECT name FROM currencies WHERE id = ? LIMIT 1";
        let currency_names = db
            .query(currency_name_sql, &[&payment_currency_id as &dyn rusqlite::ToSql], |row| {
                Ok(row.get::<_, String>(0)?)
            })
            .map_err(|e| format!("Failed to find currency name: {}", e))?;
        
        if let Some(currency_name) = currency_names.first() {
            // Create account transaction record for this payment (deposit)
            let payment_notes = Some(format!("Payment for Sale #{}", sale_id));
            let payment_notes_str: Option<&str> = payment_notes.as_ref().map(|s| s.as_str());
            let is_full_int = 0i64;
            
            let insert_transaction_sql = "INSERT INTO account_transactions (account_id, transaction_type, amount, currency, rate, total, transaction_date, is_full, notes) VALUES (?, 'deposit', ?, ?, ?, ?, ?, ?, ?)";
            db.execute(insert_transaction_sql, &[
                &aid as &dyn rusqlite::ToSql,
                &amount as &dyn rusqlite::ToSql,
                currency_name as &dyn rusqlite::ToSql,
                &exchange_rate as &dyn rusqlite::ToSql,
                &base_amount as &dyn rusqlite::ToSql,
                &date as &dyn rusqlite::ToSql,
                &is_full_int as &dyn rusqlite::ToSql,
                &payment_notes_str as &dyn rusqlite::ToSql,
            ])
            .map_err(|e| format!("Failed to create account transaction: {}", e))?;
            
            // Add the payment amount to the balance (deposit)
            let new_balance = current_balance + amount;
            
            // Update account currency balance
            update_account_currency_balance_internal(db, aid, payment_currency_id, new_balance)?;
            
            // Update account's current_balance
            let new_account_balance = calculate_account_balance_internal(db, aid)?;
            let update_balance_sql = "UPDATE accounts SET current_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
            db.execute(update_balance_sql, &[
                &new_account_balance as &dyn rusqlite::ToSql,
                &aid as &dyn rusqlite::ToSql,
            ])
            .map_err(|e| format!("Failed to update account balance: {}", e))?;
        }
    }

    // Update sale paid_amount
    let update_sale_sql = "UPDATE sales SET paid_amount = (SELECT COALESCE(SUM(base_amount), 0) FROM sale_payments WHERE sale_id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sale_sql, &[&sale_id as &dyn rusqlite::ToSql, &sale_id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to update sale paid amount: {}", e))?;

    // Create journal entry for payment: Debit Cash/Bank, Credit Accounts Receivable
    let cash_account_sql = "SELECT id FROM accounts WHERE account_type = 'Asset' AND (name LIKE '%Cash%' OR name LIKE '%Bank%') LIMIT 1";
    let cash_accounts = db.query(cash_account_sql, &[], |row| Ok(row.get::<_, i64>(0)?))
        .ok()
        .and_then(|v| v.first().copied());
    
    let ar_account_sql = "SELECT id FROM accounts WHERE account_type = 'Asset' AND name LIKE '%Receivable%' LIMIT 1";
    let ar_accounts = db.query(ar_account_sql, &[], |row| Ok(row.get::<_, i64>(0)?))
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
        .query(payment_sql, &[&sale_id as &dyn rusqlite::ToSql], |row| {
            Ok(SalePayment {
                id: row.get(0)?,
                sale_id: row.get(1)?,
                account_id: row.get(2)?,
                currency_id: row.get(3)?,
                exchange_rate: row.get(4)?,
                amount: row.get(5)?,
                base_amount: row.get(6)?,
                date: row.get(7)?,
                created_at: row.get(8)?,
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
        .query(sql, &[&sale_id as &dyn rusqlite::ToSql], |row| {
            Ok(SalePayment {
                id: row.get(0)?,
                sale_id: row.get(1)?,
                account_id: row.get(2)?,
                currency_id: row.get(3)?,
                exchange_rate: row.get(4)?,
                amount: row.get(5)?,
                base_amount: row.get(6)?,
                date: row.get(7)?,
                created_at: row.get(8)?,
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
        .query(sale_id_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
        })
        .map_err(|e| format!("Failed to fetch sale_id: {}", e))?;

    let sale_id = sale_ids.first().ok_or("Sale payment not found")?;

    let delete_sql = "DELETE FROM sale_payments WHERE id = ?";
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to delete sale payment: {}", e))?;

    // Update sale paid_amount
    let update_sale_sql = "UPDATE sales SET paid_amount = (SELECT COALESCE(SUM(amount), 0) FROM sale_payments WHERE sale_id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sale_sql, &[sale_id as &dyn rusqlite::ToSql, sale_id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to update sale paid amount: {}", e))?;

    Ok("Sale payment deleted successfully".to_string())
}

// Service Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Service {
    pub id: i64,
    pub customer_id: i64,
    pub date: String,
    pub notes: Option<String>,
    pub currency_id: Option<i64>,
    pub exchange_rate: f64,
    pub total_amount: f64,
    pub base_amount: f64,
    pub paid_amount: f64,
    pub created_at: String,
    pub updated_at: String,
}

// ServiceItem Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServiceItem {
    pub id: i64,
    pub service_id: i64,
    pub name: String,
    pub price: f64,
    pub quantity: f64,
    pub total: f64,
    pub created_at: String,
}

// ServicePayment Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServicePayment {
    pub id: i64,
    pub service_id: i64,
    pub account_id: Option<i64>,
    pub currency_id: Option<i64>,
    pub exchange_rate: f64,
    pub amount: f64,
    pub base_amount: f64,
    pub date: String,
    pub created_at: String,
}

/// Initialize services table schema
#[tauri::command]
fn init_services_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS services (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_id INTEGER NOT NULL,
            date TEXT NOT NULL,
            notes TEXT,
            currency_id INTEGER,
            exchange_rate REAL NOT NULL DEFAULT 1,
            total_amount REAL NOT NULL DEFAULT 0,
            base_amount REAL NOT NULL DEFAULT 0,
            paid_amount REAL NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (customer_id) REFERENCES customers(id),
            FOREIGN KEY (currency_id) REFERENCES currencies(id)
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create services table: {}", e))?;

    let create_items_table_sql = "
        CREATE TABLE IF NOT EXISTS service_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            price REAL NOT NULL,
            quantity REAL NOT NULL DEFAULT 1,
            total REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
        )
    ";

    db.execute(create_items_table_sql, &[])
        .map_err(|e| format!("Failed to create service_items table: {}", e))?;

    let create_payments_table_sql = "
        CREATE TABLE IF NOT EXISTS service_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            service_id INTEGER NOT NULL,
            account_id INTEGER,
            currency_id INTEGER,
            exchange_rate REAL NOT NULL DEFAULT 1,
            amount REAL NOT NULL,
            base_amount REAL NOT NULL DEFAULT 0,
            date TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
            FOREIGN KEY (account_id) REFERENCES accounts(id),
            FOREIGN KEY (currency_id) REFERENCES currencies(id)
        )
    ";

    db.execute(create_payments_table_sql, &[])
        .map_err(|e| format!("Failed to create service_payments table: {}", e))?;

    Ok("Services, service_items, and service_payments tables initialized successfully".to_string())
}

/// Create a new service with items
#[tauri::command]
fn create_service(
    db_state: State<'_, Mutex<Option<Database>>>,
    customer_id: i64,
    date: String,
    notes: Option<String>,
    currency_id: Option<i64>,
    exchange_rate: f64,
    paid_amount: f64,
    items: Vec<(String, f64, f64)>, // (name, price, quantity)
) -> Result<Service, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let items_total: f64 = items.iter().map(|(_, price, qty)| price * qty).sum();
    let total_amount = items_total;
    let base_amount = total_amount * exchange_rate;

    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    let insert_sql = "INSERT INTO services (customer_id, date, notes, currency_id, exchange_rate, total_amount, base_amount, paid_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, &[
        &customer_id as &dyn rusqlite::ToSql,
        &date as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
        &currency_id as &dyn rusqlite::ToSql,
        &exchange_rate as &dyn rusqlite::ToSql,
        &total_amount as &dyn rusqlite::ToSql,
        &base_amount as &dyn rusqlite::ToSql,
        &paid_amount as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert service: {}", e))?;

    let service_id_sql = "SELECT id FROM services WHERE customer_id = ? AND date = ? ORDER BY id DESC LIMIT 1";
    let service_ids = db
        .query(service_id_sql, &[&customer_id as &dyn rusqlite::ToSql, &date as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
        })
        .map_err(|e| format!("Failed to fetch service ID: {}", e))?;

    let service_id = service_ids.first().ok_or("Failed to retrieve service ID")?;

    for (name, price, quantity) in items {
        let total = price * quantity;
        let insert_item_sql = "INSERT INTO service_items (service_id, name, price, quantity, total) VALUES (?, ?, ?, ?, ?)";
        db.execute(insert_item_sql, &[
            service_id as &dyn rusqlite::ToSql,
            &name as &dyn rusqlite::ToSql,
            &price as &dyn rusqlite::ToSql,
            &quantity as &dyn rusqlite::ToSql,
            &total as &dyn rusqlite::ToSql,
        ])
            .map_err(|e| format!("Failed to insert service item: {}", e))?;
    }

    let service_sql = "SELECT id, customer_id, date, notes, currency_id, exchange_rate, total_amount, base_amount, paid_amount, created_at, updated_at FROM services WHERE id = ?";
    let services = db
        .query(service_sql, &[service_id as &dyn rusqlite::ToSql], |row| {
            Ok(Service {
                id: row.get(0)?,
                customer_id: row.get(1)?,
                date: row.get(2)?,
                notes: row.get(3)?,
                currency_id: row.get(4)?,
                exchange_rate: row.get(5)?,
                total_amount: row.get(6)?,
                base_amount: row.get(7)?,
                paid_amount: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|e| format!("Failed to fetch service: {}", e))?;

    if let Some(service) = services.first() {
        Ok(service.clone())
    } else {
        Err("Failed to retrieve created service".to_string())
    }
}

/// Get all services with pagination
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
            where_clause = "WHERE (CAST(s.date AS TEXT) LIKE ? OR s.notes LIKE ? OR s.customer_id IN (SELECT id FROM customers WHERE full_name LIKE ? OR phone LIKE ?))".to_string();
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term.clone()));
            params.push(serde_json::Value::String(search_term));
        }
    }

    let count_sql = format!("SELECT COUNT(*) FROM services s {}", where_clause);
    let total: i64 = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&count_sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();
        let count: i64 = stmt.query_row(rusqlite::params_from_iter(rusqlite_params.iter()), |row| row.get(0))
            .map_err(|e| anyhow::anyhow!("{}", e))?;
        Ok(count)
    }).map_err(|e| format!("Failed to count services: {}", e))?;

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

    let sql = format!("SELECT s.id, s.customer_id, s.date, s.notes, s.currency_id, s.exchange_rate, s.total_amount, s.base_amount, s.paid_amount, s.created_at, s.updated_at FROM services s {} {} LIMIT ? OFFSET ?", where_clause, order_clause);

    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));

    let services = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                serde_json::Value::Number(n) => rusqlite::types::Value::Integer(n.as_i64().unwrap_or(0)),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();

        let rows = stmt.query_map(rusqlite::params_from_iter(rusqlite_params.iter()), |row| {
            Ok(Service {
                id: row.get(0)?,
                customer_id: row.get(1)?,
                date: row.get(2)?,
                notes: row.get(3)?,
                currency_id: row.get(4)?,
                exchange_rate: row.get(5)?,
                total_amount: row.get(6)?,
                base_amount: row.get(7)?,
                paid_amount: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        }).map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| anyhow::anyhow!("{}", e))?);
        }
        Ok(result)
    }).map_err(|e| format!("Failed to fetch services: {}", e))?;

    let total_pages = (total as f64 / per_page as f64).ceil() as i64;
    Ok(PaginatedResponse {
        items: services,
        total,
        page,
        per_page,
        total_pages,
    })
}

/// Get a single service by ID
#[tauri::command]
fn get_service(db_state: State<'_, Mutex<Option<Database>>>, id: i64) -> Result<(Service, Vec<ServiceItem>), String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let service_sql = "SELECT id, customer_id, date, notes, currency_id, exchange_rate, total_amount, base_amount, paid_amount, created_at, updated_at FROM services WHERE id = ?";
    let services = db
        .query(service_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Service {
                id: row.get(0)?,
                customer_id: row.get(1)?,
                date: row.get(2)?,
                notes: row.get(3)?,
                currency_id: row.get(4)?,
                exchange_rate: row.get(5)?,
                total_amount: row.get(6)?,
                base_amount: row.get(7)?,
                paid_amount: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|e| format!("Failed to fetch service: {}", e))?;

    let service = services.first().ok_or("Service not found")?;

    let items_sql = "SELECT id, service_id, name, price, quantity, total, created_at FROM service_items WHERE service_id = ?";
    let items = db
        .query(items_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(ServiceItem {
                id: row.get(0)?,
                service_id: row.get(1)?,
                name: row.get(2)?,
                price: row.get(3)?,
                quantity: row.get(4)?,
                total: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to fetch service items: {}", e))?;

    Ok((service.clone(), items))
}

/// Update a service with items
#[tauri::command]
fn update_service(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    customer_id: i64,
    date: String,
    notes: Option<String>,
    currency_id: Option<i64>,
    exchange_rate: f64,
    paid_amount: f64,
    items: Vec<(String, f64, f64)>,
) -> Result<Service, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let items_total: f64 = items.iter().map(|(_, price, qty)| price * qty).sum();
    let total_amount = items_total;
    let base_amount = total_amount * exchange_rate;

    let notes_str: Option<&str> = notes.as_ref().map(|s| s.as_str());
    let update_sql = "UPDATE services SET customer_id = ?, date = ?, notes = ?, currency_id = ?, exchange_rate = ?, total_amount = ?, base_amount = ?, paid_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sql, &[
        &customer_id as &dyn rusqlite::ToSql,
        &date as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
        &currency_id as &dyn rusqlite::ToSql,
        &exchange_rate as &dyn rusqlite::ToSql,
        &total_amount as &dyn rusqlite::ToSql,
        &base_amount as &dyn rusqlite::ToSql,
        &paid_amount as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update service: {}", e))?;

    let delete_items_sql = "DELETE FROM service_items WHERE service_id = ?";
    db.execute(delete_items_sql, &[&id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to delete service items: {}", e))?;

    for (name, price, quantity) in items {
        let total = price * quantity;
        let insert_item_sql = "INSERT INTO service_items (service_id, name, price, quantity, total) VALUES (?, ?, ?, ?, ?)";
        db.execute(insert_item_sql, &[
            &id as &dyn rusqlite::ToSql,
            &name as &dyn rusqlite::ToSql,
            &price as &dyn rusqlite::ToSql,
            &quantity as &dyn rusqlite::ToSql,
            &total as &dyn rusqlite::ToSql,
        ])
            .map_err(|e| format!("Failed to insert service item: {}", e))?;
    }

    let service_sql = "SELECT id, customer_id, date, notes, currency_id, exchange_rate, total_amount, base_amount, paid_amount, created_at, updated_at FROM services WHERE id = ?";
    let services = db
        .query(service_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Service {
                id: row.get(0)?,
                customer_id: row.get(1)?,
                date: row.get(2)?,
                notes: row.get(3)?,
                currency_id: row.get(4)?,
                exchange_rate: row.get(5)?,
                total_amount: row.get(6)?,
                base_amount: row.get(7)?,
                paid_amount: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        })
        .map_err(|e| format!("Failed to fetch service: {}", e))?;

    if let Some(service) = services.first() {
        Ok(service.clone())
    } else {
        Err("Failed to retrieve updated service".to_string())
    }
}

/// Delete a service
#[tauri::command]
fn delete_service(db_state: State<'_, Mutex<Option<Database>>>, id: i64) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM services WHERE id = ?";
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to delete service: {}", e))?;

    Ok("Service deleted successfully".to_string())
}

/// Get service items for a service
#[tauri::command]
fn get_service_items(db_state: State<'_, Mutex<Option<Database>>>, service_id: i64) -> Result<Vec<ServiceItem>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, service_id, name, price, quantity, total, created_at FROM service_items WHERE service_id = ? ORDER BY id";
    let items = db
        .query(sql, &[&service_id as &dyn rusqlite::ToSql], |row| {
            Ok(ServiceItem {
                id: row.get(0)?,
                service_id: row.get(1)?,
                name: row.get(2)?,
                price: row.get(3)?,
                quantity: row.get(4)?,
                total: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to fetch service items: {}", e))?;

    Ok(items)
}

/// Create a service item
#[tauri::command]
fn create_service_item(
    db_state: State<'_, Mutex<Option<Database>>>,
    service_id: i64,
    name: String,
    price: f64,
    quantity: f64,
) -> Result<ServiceItem, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let total = price * quantity;
    let insert_sql = "INSERT INTO service_items (service_id, name, price, quantity, total) VALUES (?, ?, ?, ?, ?)";
    db.execute(insert_sql, &[
        &service_id as &dyn rusqlite::ToSql,
        &name as &dyn rusqlite::ToSql,
        &price as &dyn rusqlite::ToSql,
        &quantity as &dyn rusqlite::ToSql,
        &total as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert service item: {}", e))?;

    let id_sql = "SELECT id FROM service_items WHERE service_id = ? ORDER BY id DESC LIMIT 1";
    let ids = db.query(id_sql, &[&service_id as &dyn rusqlite::ToSql], |row| Ok(row.get::<_, i64>(0)?))
        .map_err(|e| format!("Failed to get service item id: {}", e))?;
    let new_id = ids.first().ok_or("Failed to get created service item id")?;

    let row_sql = "SELECT id, service_id, name, price, quantity, total, created_at FROM service_items WHERE id = ?";
    let rows = db.query(row_sql, &[new_id as &dyn rusqlite::ToSql], |row| {
        Ok(ServiceItem {
            id: row.get(0)?,
            service_id: row.get(1)?,
            name: row.get(2)?,
            price: row.get(3)?,
            quantity: row.get(4)?,
            total: row.get(5)?,
            created_at: row.get(6)?,
        })
    }).map_err(|e| format!("Failed to fetch service item: {}", e))?;

    if let Some(item) = rows.first() {
        Ok(item.clone())
    } else {
        Err("Failed to retrieve created service item".to_string())
    }
}

/// Update a service item
#[tauri::command]
fn update_service_item(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
    name: String,
    price: f64,
    quantity: f64,
) -> Result<ServiceItem, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let total = price * quantity;
    let update_sql = "UPDATE service_items SET name = ?, price = ?, quantity = ?, total = ? WHERE id = ?";
    db.execute(update_sql, &[
        &name as &dyn rusqlite::ToSql,
        &price as &dyn rusqlite::ToSql,
        &quantity as &dyn rusqlite::ToSql,
        &total as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update service item: {}", e))?;

    let row_sql = "SELECT id, service_id, name, price, quantity, total, created_at FROM service_items WHERE id = ?";
    let rows = db.query(row_sql, &[&id as &dyn rusqlite::ToSql], |row| {
        Ok(ServiceItem {
            id: row.get(0)?,
            service_id: row.get(1)?,
            name: row.get(2)?,
            price: row.get(3)?,
            quantity: row.get(4)?,
            total: row.get(5)?,
            created_at: row.get(6)?,
        })
    }).map_err(|e| format!("Failed to fetch service item: {}", e))?;

    if let Some(item) = rows.first() {
        Ok(item.clone())
    } else {
        Err("Failed to retrieve updated service item".to_string())
    }
}

/// Delete a service item
#[tauri::command]
fn delete_service_item(db_state: State<'_, Mutex<Option<Database>>>, id: i64) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let delete_sql = "DELETE FROM service_items WHERE id = ?";
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to delete service item: {}", e))?;

    Ok("Service item deleted successfully".to_string())
}

/// Create a service payment (with optional account deposit)
#[tauri::command]
fn create_service_payment(
    db_state: State<'_, Mutex<Option<Database>>>,
    service_id: i64,
    account_id: Option<i64>,
    currency_id: Option<i64>,
    exchange_rate: f64,
    amount: f64,
    date: String,
) -> Result<ServicePayment, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let base_amount = amount * exchange_rate;
    let payment_currency_id = currency_id.unwrap_or_else(|| {
        let service_currency_sql = "SELECT currency_id FROM services WHERE id = ?";
        db.query(service_currency_sql, &[&service_id as &dyn rusqlite::ToSql], |row| Ok(row.get::<_, Option<i64>>(0)?))
            .ok()
            .and_then(|v| v.first().and_then(|c| *c))
            .unwrap_or_else(|| {
                db.query("SELECT id FROM currencies WHERE base = 1 LIMIT 1", &[], |row| Ok(row.get::<_, i64>(0)?))
                    .ok()
                    .and_then(|v| v.first().copied())
                    .unwrap_or(1)
            })
    });

    let insert_sql = "INSERT INTO service_payments (service_id, account_id, currency_id, exchange_rate, amount, base_amount, date) VALUES (?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, &[
        &service_id as &dyn rusqlite::ToSql,
        &account_id as &dyn rusqlite::ToSql,
        &payment_currency_id as &dyn rusqlite::ToSql,
        &exchange_rate as &dyn rusqlite::ToSql,
        &amount as &dyn rusqlite::ToSql,
        &base_amount as &dyn rusqlite::ToSql,
        &date as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert service payment: {}", e))?;

    if let Some(aid) = account_id {
        let current_balance = get_account_balance_by_currency_internal(db, aid, payment_currency_id)
            .unwrap_or(0.0);

        let currency_name_sql = "SELECT name FROM currencies WHERE id = ? LIMIT 1";
        let currency_names = db
            .query(currency_name_sql, &[&payment_currency_id as &dyn rusqlite::ToSql], |row| {
                Ok(row.get::<_, String>(0)?)
            })
            .map_err(|e| format!("Failed to find currency name: {}", e))?;

        if let Some(currency_name) = currency_names.first() {
            let payment_notes = Some(format!("Payment for Service #{}", service_id));
            let payment_notes_str: Option<&str> = payment_notes.as_ref().map(|s| s.as_str());
            let is_full_int = 0i64;

            let insert_transaction_sql = "INSERT INTO account_transactions (account_id, transaction_type, amount, currency, rate, total, transaction_date, is_full, notes) VALUES (?, 'deposit', ?, ?, ?, ?, ?, ?, ?)";
            db.execute(insert_transaction_sql, &[
                &aid as &dyn rusqlite::ToSql,
                &amount as &dyn rusqlite::ToSql,
                currency_name as &dyn rusqlite::ToSql,
                &exchange_rate as &dyn rusqlite::ToSql,
                &base_amount as &dyn rusqlite::ToSql,
                &date as &dyn rusqlite::ToSql,
                &is_full_int as &dyn rusqlite::ToSql,
                &payment_notes_str as &dyn rusqlite::ToSql,
            ])
            .map_err(|e| format!("Failed to create account transaction: {}", e))?;

            let new_balance = current_balance + amount;
            update_account_currency_balance_internal(db, aid, payment_currency_id, new_balance)?;

            let new_account_balance = calculate_account_balance_internal(db, aid)?;
            let update_balance_sql = "UPDATE accounts SET current_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
            db.execute(update_balance_sql, &[
                &new_account_balance as &dyn rusqlite::ToSql,
                &aid as &dyn rusqlite::ToSql,
            ])
            .map_err(|e| format!("Failed to update account balance: {}", e))?;
        }
    }

    let update_service_sql = "UPDATE services SET paid_amount = (SELECT COALESCE(SUM(base_amount), 0) FROM service_payments WHERE service_id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_service_sql, &[&service_id as &dyn rusqlite::ToSql, &service_id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to update service paid amount: {}", e))?;

    let payment_sql = "SELECT id, service_id, account_id, currency_id, exchange_rate, amount, base_amount, date, created_at FROM service_payments WHERE service_id = ? ORDER BY id DESC LIMIT 1";
    let payments = db
        .query(payment_sql, &[&service_id as &dyn rusqlite::ToSql], |row| {
            Ok(ServicePayment {
                id: row.get(0)?,
                service_id: row.get(1)?,
                account_id: row.get(2)?,
                currency_id: row.get(3)?,
                exchange_rate: row.get(4)?,
                amount: row.get(5)?,
                base_amount: row.get(6)?,
                date: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch service payment: {}", e))?;

    if let Some(payment) = payments.first() {
        Ok(payment.clone())
    } else {
        Err("Failed to retrieve created service payment".to_string())
    }
}

/// Get payments for a service
#[tauri::command]
fn get_service_payments(db_state: State<'_, Mutex<Option<Database>>>, service_id: i64) -> Result<Vec<ServicePayment>, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, service_id, account_id, currency_id, exchange_rate, amount, base_amount, date, created_at FROM service_payments WHERE service_id = ? ORDER BY date DESC, created_at DESC";
    let payments = db
        .query(sql, &[&service_id as &dyn rusqlite::ToSql], |row| {
            Ok(ServicePayment {
                id: row.get(0)?,
                service_id: row.get(1)?,
                account_id: row.get(2)?,
                currency_id: row.get(3)?,
                exchange_rate: row.get(4)?,
                amount: row.get(5)?,
                base_amount: row.get(6)?,
                date: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| format!("Failed to fetch service payments: {}", e))?;

    Ok(payments)
}

/// Delete a service payment
#[tauri::command]
fn delete_service_payment(
    db_state: State<'_, Mutex<Option<Database>>>,
    id: i64,
) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let service_id_sql = "SELECT service_id FROM service_payments WHERE id = ?";
    let service_ids = db
        .query(service_id_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
        })
        .map_err(|e| format!("Failed to fetch service_id: {}", e))?;

    let service_id = service_ids.first().ok_or("Service payment not found")?;

    let delete_sql = "DELETE FROM service_payments WHERE id = ?";
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to delete service payment: {}", e))?;

    let update_service_sql = "UPDATE services SET paid_amount = (SELECT COALESCE(SUM(amount), 0) FROM service_payments WHERE service_id = ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_service_sql, &[service_id as &dyn rusqlite::ToSql, service_id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to update service paid amount: {}", e))?;

    Ok("Service payment deleted successfully".to_string())
}

// ExpenseType Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpenseType {
    pub id: i64,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize expense_types table schema
#[tauri::command]
fn init_expense_types_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS expense_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create expense_types table: {}", e))?;

    Ok("Expense types table initialized successfully".to_string())
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
    db.execute(insert_sql, &[&name as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to insert expense type: {}", e))?;

    // Get the created expense type
    let expense_type_sql = "SELECT id, name, created_at, updated_at FROM expense_types WHERE name = ?";
    let expense_types = db
        .query(expense_type_sql, &[&name as &dyn rusqlite::ToSql], |row| {
            Ok(ExpenseType {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
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
        .query(sql, &[], |row| {
            Ok(ExpenseType {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
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
    db.execute(update_sql, &[&name as &dyn rusqlite::ToSql, &id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to update expense type: {}", e))?;

    // Get the updated expense type
    let expense_type_sql = "SELECT id, name, created_at, updated_at FROM expense_types WHERE id = ?";
    let expense_types = db
        .query(expense_type_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(ExpenseType {
                id: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                updated_at: row.get(3)?,
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
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to delete expense type: {}", e))?;

    Ok("Expense type deleted successfully".to_string())
}

// Expense Model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Expense {
    pub id: i64,
    pub expense_type_id: i64,
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

/// Initialize expenses table schema
#[tauri::command]
fn init_expenses_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // First ensure expense_types table exists
    let create_expense_types_sql = "
        CREATE TABLE IF NOT EXISTS expense_types (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ";
    db.execute(create_expense_types_sql, &[])
        .map_err(|e| format!("Failed to create expense_types table: {}", e))?;

    // Create expenses table with expense_type_id
    // If table already exists with old schema, we'll handle migration
    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            expense_type_id INTEGER NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL,
            rate REAL NOT NULL DEFAULT 1.0,
            total REAL NOT NULL,
            date TEXT NOT NULL,
            bill_no TEXT,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (expense_type_id) REFERENCES expense_types(id)
        )
    ";
    
    // Try to create the table (will fail silently if it exists)
    let _ = db.execute(create_table_sql, &[]);
    
    // Check if columns exist, if not, try to add them
    let check_column_sql = "PRAGMA table_info(expenses)";
    if let Ok(columns) = db.query(check_column_sql, &[], |row| {
        Ok(row.get::<_, String>(1)?)
    }) {
        let has_expense_type_id = columns.iter().any(|c| c == "expense_type_id");
        let has_bill_no = columns.iter().any(|c| c == "bill_no");
        let has_description = columns.iter().any(|c| c == "description");
        let has_name = columns.iter().any(|c| c == "name");
        
        if !has_expense_type_id && has_name {
            // Old schema detected - add expense_type_id column
            // Note: SQLite doesn't support adding NOT NULL columns to existing tables easily
            // So we'll add it as nullable first, then the app should handle migration
            let add_column_sql = "ALTER TABLE expenses ADD COLUMN expense_type_id INTEGER";
            let _ = db.execute(add_column_sql, &[]);
        }
        
        if !has_bill_no {
            let add_column_sql = "ALTER TABLE expenses ADD COLUMN bill_no TEXT";
            let _ = db.execute(add_column_sql, &[]);
        }
        
        if !has_description {
            let add_column_sql = "ALTER TABLE expenses ADD COLUMN description TEXT";
            let _ = db.execute(add_column_sql, &[]);
        }
    }

    Ok("Expenses table initialized successfully".to_string())
}

/// Create a new expense
#[tauri::command]
fn create_expense(
    db_state: State<'_, Mutex<Option<Database>>>,
    expense_type_id: i64,
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

    // Insert new expense
    let insert_sql = "INSERT INTO expenses (expense_type_id, amount, currency, rate, total, date, bill_no, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, &[
        &expense_type_id as &dyn rusqlite::ToSql,
        &amount as &dyn rusqlite::ToSql,
        &currency as &dyn rusqlite::ToSql,
        &rate as &dyn rusqlite::ToSql,
        &total as &dyn rusqlite::ToSql,
        &date as &dyn rusqlite::ToSql,
        &bill_no as &dyn rusqlite::ToSql,
        &description as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert expense: {}", e))?;

    // Get the created expense
    let expense_sql = "SELECT id, expense_type_id, amount, currency, rate, total, date, bill_no, description, created_at, updated_at FROM expenses WHERE expense_type_id = ? AND date = ? ORDER BY id DESC LIMIT 1";
    let expenses = db
        .query(expense_sql, &[&expense_type_id as &dyn rusqlite::ToSql, &date as &dyn rusqlite::ToSql], |row| {
            Ok(Expense {
                id: row.get(0)?,
                expense_type_id: row.get(1)?,
                amount: row.get(2)?,
                currency: row.get(3)?,
                rate: row.get(4)?,
                total: row.get(5)?,
                date: row.get(6)?,
                bill_no: row.get(7)?,
                description: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
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
    let total: i64 = db.with_connection(|conn| {
         let mut stmt = conn.prepare(&count_sql).map_err(|e| anyhow::anyhow!("{}", e))?;
         let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();
         let count: i64 = stmt.query_row(rusqlite::params_from_iter(rusqlite_params.iter()), |row| row.get(0))
             .map_err(|e| anyhow::anyhow!("{}", e))?;
         Ok(count)
    }).map_err(|e| format!("Failed to count expenses: {}", e))?;

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

    let sql = format!("SELECT id, expense_type_id, amount, currency, rate, total, date, bill_no, description, created_at, updated_at FROM expenses {} {} LIMIT ? OFFSET ?", where_clause, order_clause);
    
    params.push(serde_json::Value::Number(serde_json::Number::from(per_page)));
    params.push(serde_json::Value::Number(serde_json::Number::from(offset)));

    let expenses = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
             match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                serde_json::Value::Number(n) => rusqlite::types::Value::Integer(n.as_i64().unwrap_or(0)),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();

        let rows = stmt.query_map(rusqlite::params_from_iter(rusqlite_params.iter()), |row| {
             Ok(Expense {
                id: row.get(0)?,
                expense_type_id: row.get(1)?,
                amount: row.get(2)?,
                currency: row.get(3)?,
                rate: row.get(4)?,
                total: row.get(5)?,
                date: row.get(6)?,
                bill_no: row.get(7)?,
                description: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
            })
        }).map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| anyhow::anyhow!("{}", e))?);
        }
        Ok(result)
    }).map_err(|e| format!("Failed to fetch expenses: {}", e))?;

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

    let expense_sql = "SELECT id, expense_type_id, amount, currency, rate, total, date, bill_no, description, created_at, updated_at FROM expenses WHERE id = ?";
    let expenses = db
        .query(expense_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Expense {
                id: row.get(0)?,
                expense_type_id: row.get(1)?,
                amount: row.get(2)?,
                currency: row.get(3)?,
                rate: row.get(4)?,
                total: row.get(5)?,
                date: row.get(6)?,
                bill_no: row.get(7)?,
                description: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
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

    // Update expense
    let update_sql = "UPDATE expenses SET expense_type_id = ?, amount = ?, currency = ?, rate = ?, total = ?, date = ?, bill_no = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sql, &[
        &expense_type_id as &dyn rusqlite::ToSql,
        &amount as &dyn rusqlite::ToSql,
        &currency as &dyn rusqlite::ToSql,
        &rate as &dyn rusqlite::ToSql,
        &total as &dyn rusqlite::ToSql,
        &date as &dyn rusqlite::ToSql,
        &bill_no as &dyn rusqlite::ToSql,
        &description as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update expense: {}", e))?;

    // Get the updated expense
    let expense_sql = "SELECT id, expense_type_id, amount, currency, rate, total, date, bill_no, description, created_at, updated_at FROM expenses WHERE id = ?";
    let expenses = db
        .query(expense_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Expense {
                id: row.get(0)?,
                expense_type_id: row.get(1)?,
                amount: row.get(2)?,
                currency: row.get(3)?,
                rate: row.get(4)?,
                total: row.get(5)?,
                date: row.get(6)?,
                bill_no: row.get(7)?,
                description: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
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
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
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

/// Initialize employees table schema
#[tauri::command]
fn init_employees_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS employees (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            full_name TEXT NOT NULL,
            phone TEXT NOT NULL,
            email TEXT,
            address TEXT NOT NULL,
            position TEXT,
            hire_date TEXT,
            base_salary REAL,
            photo_path TEXT,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create employees table: {}", e))?;

    Ok("Employees table initialized successfully".to_string())
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
    
    db.execute(insert_sql, &[
        &full_name as &dyn rusqlite::ToSql,
        &phone as &dyn rusqlite::ToSql,
        &email_str as &dyn rusqlite::ToSql,
        &address as &dyn rusqlite::ToSql,
        &position_str as &dyn rusqlite::ToSql,
        &hire_date_str as &dyn rusqlite::ToSql,
        &base_salary as &dyn rusqlite::ToSql,
        &photo_path_str as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert employee: {}", e))?;

    // Get the created employee
    let employee_sql = "SELECT id, full_name, phone, email, address, position, hire_date, base_salary, photo_path, notes, created_at, updated_at FROM employees WHERE full_name = ? AND phone = ? ORDER BY id DESC LIMIT 1";
    let employees = db
        .query(employee_sql, &[&full_name as &dyn rusqlite::ToSql, &phone as &dyn rusqlite::ToSql], |row| {
            Ok(Employee {
                id: row.get(0)?,
                full_name: row.get(1)?,
                phone: row.get(2)?,
                email: row.get::<_, Option<String>>(3)?,
                address: row.get(4)?,
                position: row.get::<_, Option<String>>(5)?,
                hire_date: row.get::<_, Option<String>>(6)?,
                base_salary: row.get::<_, Option<f64>>(7)?,
                photo_path: row.get::<_, Option<String>>(8)?,
                notes: row.get::<_, Option<String>>(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
    // We need to use db_query logic here or similar. 
    // Since we are inside the lib, we can access db.query directly if we construct params correctly.
    // But db.query uses `rusqlite::ToSql`. `params` above are `serde_json::Value`.
    // Let's reuse the logic from `db_query` or just implement it here cleanly.
    
    // We'll reimplement a simple query wrapper here for the count since strict ownership is annoying
    let total: i64 = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&count_sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        
        // Convert json params to sqlite params
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                _ => rusqlite::types::Value::Null, // simplified for search which is only string
            }
        }).collect();

        let count: i64 = stmt.query_row(rusqlite::params_from_iter(rusqlite_params.iter()), |row| row.get(0))
             .map_err(|e| anyhow::anyhow!("{}", e))?;
        Ok(count)
    }).map_err(|e| format!("Failed to count employees: {}", e))?;

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

    let employees = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                serde_json::Value::Number(n) => rusqlite::types::Value::Integer(n.as_i64().unwrap_or(0)),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();

        let rows = stmt.query_map(rusqlite::params_from_iter(rusqlite_params.iter()), |row| {
             Ok(Employee {
                id: row.get(0)?,
                full_name: row.get(1)?,
                phone: row.get(2)?,
                email: row.get::<_, Option<String>>(3)?,
                address: row.get(4)?,
                position: row.get::<_, Option<String>>(5)?,
                hire_date: row.get::<_, Option<String>>(6)?,
                base_salary: row.get::<_, Option<f64>>(7)?,
                photo_path: row.get::<_, Option<String>>(8)?,
                notes: row.get::<_, Option<String>>(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
            })
        }).map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| anyhow::anyhow!("{}", e))?);
        }
        Ok(result)
    }).map_err(|e| format!("Failed to fetch employees: {}", e))?;

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
        .query(sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Employee {
                id: row.get(0)?,
                full_name: row.get(1)?,
                phone: row.get(2)?,
                email: row.get::<_, Option<String>>(3)?,
                address: row.get(4)?,
                position: row.get::<_, Option<String>>(5)?,
                hire_date: row.get::<_, Option<String>>(6)?,
                base_salary: row.get::<_, Option<f64>>(7)?,
                photo_path: row.get::<_, Option<String>>(8)?,
                notes: row.get::<_, Option<String>>(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
    
    db.execute(update_sql, &[
        &full_name as &dyn rusqlite::ToSql,
        &phone as &dyn rusqlite::ToSql,
        &email_str as &dyn rusqlite::ToSql,
        &address as &dyn rusqlite::ToSql,
        &position_str as &dyn rusqlite::ToSql,
        &hire_date_str as &dyn rusqlite::ToSql,
        &base_salary as &dyn rusqlite::ToSql,
        &photo_path_str as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update employee: {}", e))?;

    // Get the updated employee
    let employee_sql = "SELECT id, full_name, phone, email, address, position, hire_date, base_salary, photo_path, notes, created_at, updated_at FROM employees WHERE id = ?";
    let employees = db
        .query(employee_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Employee {
                id: row.get(0)?,
                full_name: row.get(1)?,
                phone: row.get(2)?,
                email: row.get::<_, Option<String>>(3)?,
                address: row.get(4)?,
                position: row.get::<_, Option<String>>(5)?,
                hire_date: row.get::<_, Option<String>>(6)?,
                base_salary: row.get::<_, Option<f64>>(7)?,
                photo_path: row.get::<_, Option<String>>(8)?,
                notes: row.get::<_, Option<String>>(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
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

/// Initialize salaries table schema
#[tauri::command]
fn init_salaries_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Create table if it doesn't exist
    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS salaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            year INTEGER NOT NULL,
            month TEXT NOT NULL,
            amount REAL NOT NULL,
            deductions REAL NOT NULL DEFAULT 0,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
            UNIQUE(employee_id, year, month)
        )
    ";
    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create salaries table: {}", e))?;

    // Check if deductions column exists, if not add it
    let check_column_sql = "PRAGMA table_info(salaries)";
    if let Ok(columns) = db.query(check_column_sql, &[], |row| {
        Ok(row.get::<_, String>(1)?)
    }) {
        let has_deductions = columns.iter().any(|c| c == "deductions");
        if !has_deductions {
            // Add deductions column
            let add_column_sql = "ALTER TABLE salaries ADD COLUMN deductions REAL NOT NULL DEFAULT 0";
            let _ = db.execute(add_column_sql, &[]);
        }
    }

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create salaries table: {}", e))?;

    Ok("Salaries table initialized successfully".to_string())
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
    
    db.execute(insert_sql, &[
        &employee_id as &dyn rusqlite::ToSql,
        &year as &dyn rusqlite::ToSql,
        &month as &dyn rusqlite::ToSql,
        &amount as &dyn rusqlite::ToSql,
        &deductions as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert salary: {}", e))?;

    // Get the created salary
    let salary_sql = "SELECT id, employee_id, year, month, amount, deductions, notes, created_at, updated_at FROM salaries WHERE employee_id = ? AND year = ? AND month = ? ORDER BY id DESC LIMIT 1";
    let salaries = db
        .query(salary_sql, &[&employee_id as &dyn rusqlite::ToSql, &year as &dyn rusqlite::ToSql, &month as &dyn rusqlite::ToSql], |row| {
            Ok(Salary {
                id: row.get(0)?,
                employee_id: row.get(1)?,
                year: row.get(2)?,
                month: row.get(3)?,
                amount: row.get(4)?,
                deductions: row.get(5)?,
                notes: row.get::<_, Option<String>>(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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
    let total: i64 = db.with_connection(|conn| {
         let mut stmt = conn.prepare(&count_sql).map_err(|e| anyhow::anyhow!("{}", e))?;
         let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();
         let count: i64 = stmt.query_row(rusqlite::params_from_iter(rusqlite_params.iter()), |row| row.get(0))
             .map_err(|e| anyhow::anyhow!("{}", e))?;
         Ok(count)
    }).map_err(|e| format!("Failed to count salaries: {}", e))?;

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

    let salaries = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
             match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                serde_json::Value::Number(n) => rusqlite::types::Value::Integer(n.as_i64().unwrap_or(0)),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();

        let rows = stmt.query_map(rusqlite::params_from_iter(rusqlite_params.iter()), |row| {
             Ok(Salary {
                id: row.get(0)?,
                employee_id: row.get(1)?,
                year: row.get(2)?,
                month: row.get(3)?,
                amount: row.get(4)?,
                deductions: row.get(5)?,
                notes: row.get::<_, Option<String>>(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        }).map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| anyhow::anyhow!("{}", e))?);
        }
        Ok(result)
    }).map_err(|e| format!("Failed to fetch salaries: {}", e))?;

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
        .query(sql, &[&employee_id as &dyn rusqlite::ToSql], |row| {
            Ok(Salary {
                id: row.get(0)?,
                employee_id: row.get(1)?,
                year: row.get(2)?,
                month: row.get(3)?,
                amount: row.get(4)?,
                deductions: row.get(5)?,
                notes: row.get::<_, Option<String>>(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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
        .query(sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Salary {
                id: row.get(0)?,
                employee_id: row.get(1)?,
                year: row.get(2)?,
                month: row.get(3)?,
                amount: row.get(4)?,
                deductions: row.get(5)?,
                notes: row.get::<_, Option<String>>(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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
    
    db.execute(update_sql, &[
        &employee_id as &dyn rusqlite::ToSql,
        &year as &dyn rusqlite::ToSql,
        &month as &dyn rusqlite::ToSql,
        &amount as &dyn rusqlite::ToSql,
        &deductions as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update salary: {}", e))?;

    // Get the updated salary
    let salary_sql = "SELECT id, employee_id, year, month, amount, COALESCE(deductions, 0) as deductions, notes, created_at, updated_at FROM salaries WHERE id = ?";
    let salaries = db
        .query(salary_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Salary {
                id: row.get(0)?,
                employee_id: row.get(1)?,
                year: row.get(2)?,
                month: row.get(3)?,
                amount: row.get(4)?,
                deductions: row.get(5)?,
                notes: row.get::<_, Option<String>>(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
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

/// Initialize deductions table schema
#[tauri::command]
fn init_deductions_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Create table if it doesn't exist
    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS deductions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employee_id INTEGER NOT NULL,
            year INTEGER NOT NULL DEFAULT 1403,
            month TEXT NOT NULL DEFAULT 'حمل',
            currency TEXT NOT NULL,
            rate REAL NOT NULL DEFAULT 1.0,
            amount REAL NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create deductions table: {}", e))?;

    // Check if year column exists, if not add it
    let check_column_sql = "PRAGMA table_info(deductions)";
    if let Ok(columns) = db.query(check_column_sql, &[], |row| {
        Ok(row.get::<_, String>(1)?)
    }) {
        let has_year = columns.iter().any(|c| c == "year");
        if !has_year {
            // Add year column
            let add_year_sql = "ALTER TABLE deductions ADD COLUMN year INTEGER NOT NULL DEFAULT 1403";
            let _ = db.execute(add_year_sql, &[]);
        }
        
        let has_month = columns.iter().any(|c| c == "month");
        if !has_month {
            // Add month column
            let add_month_sql = "ALTER TABLE deductions ADD COLUMN month TEXT NOT NULL DEFAULT 'حمل'";
            let _ = db.execute(add_month_sql, &[]);
        }
    }

    Ok("Deductions table initialized successfully".to_string())
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
    db.execute(insert_sql, &[
        &employee_id as &dyn rusqlite::ToSql,
        &year as &dyn rusqlite::ToSql,
        &month as &dyn rusqlite::ToSql,
        &currency as &dyn rusqlite::ToSql,
        &rate as &dyn rusqlite::ToSql,
        &amount as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert deduction: {}", e))?;

    // Get the created deduction
    let deduction_sql = "SELECT id, employee_id, year, month, currency, rate, amount, created_at, updated_at FROM deductions WHERE employee_id = ? AND year = ? AND month = ? AND currency = ? AND rate = ? AND amount = ? ORDER BY id DESC LIMIT 1";
    let deductions = db
        .query(deduction_sql, &[
            &employee_id as &dyn rusqlite::ToSql,
            &year as &dyn rusqlite::ToSql,
            &month as &dyn rusqlite::ToSql,
            &currency as &dyn rusqlite::ToSql,
            &rate as &dyn rusqlite::ToSql,
            &amount as &dyn rusqlite::ToSql,
        ], |row| {
            Ok(Deduction {
                id: row.get(0)?,
                employee_id: row.get(1)?,
                year: row.get(2)?,
                month: row.get(3)?,
                currency: row.get(4)?,
                rate: row.get(5)?,
                amount: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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
    let total: i64 = db.with_connection(|conn| {
         let mut stmt = conn.prepare(&count_sql).map_err(|e| anyhow::anyhow!("{}", e))?;
         let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
            match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();
         let count: i64 = stmt.query_row(rusqlite::params_from_iter(rusqlite_params.iter()), |row| row.get(0))
             .map_err(|e| anyhow::anyhow!("{}", e))?;
         Ok(count)
    }).map_err(|e| format!("Failed to count deductions: {}", e))?;

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

    let deductions = db.with_connection(|conn| {
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow::anyhow!("{}", e))?;
        let rusqlite_params: Vec<rusqlite::types::Value> = params.iter().map(|v| {
             match v {
                serde_json::Value::String(s) => rusqlite::types::Value::Text(s.clone()),
                serde_json::Value::Number(n) => rusqlite::types::Value::Integer(n.as_i64().unwrap_or(0)),
                _ => rusqlite::types::Value::Null,
            }
        }).collect();

        let rows = stmt.query_map(rusqlite::params_from_iter(rusqlite_params.iter()), |row| {
             Ok(Deduction {
                id: row.get(0)?,
                employee_id: row.get(1)?,
                year: row.get(2)?,
                month: row.get(3)?,
                currency: row.get(4)?,
                rate: row.get(5)?,
                amount: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        }).map_err(|e| anyhow::anyhow!("{}", e))?;

        let mut result = Vec::new();
        for row in rows {
            result.push(row.map_err(|e| anyhow::anyhow!("{}", e))?);
        }
        Ok(result)
    }).map_err(|e| format!("Failed to fetch deductions: {}", e))?;

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
        .query(sql, &[&employee_id as &dyn rusqlite::ToSql], |row| {
            Ok(Deduction {
                id: row.get(0)?,
                employee_id: row.get(1)?,
                year: row.get(2)?,
                month: row.get(3)?,
                currency: row.get(4)?,
                rate: row.get(5)?,
                amount: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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
        .query(sql, &[
            &employee_id as &dyn rusqlite::ToSql,
            &year as &dyn rusqlite::ToSql,
            &month as &dyn rusqlite::ToSql,
        ], |row| {
            Ok(Deduction {
                id: row.get(0)?,
                employee_id: row.get(1)?,
                year: row.get(2)?,
                month: row.get(3)?,
                currency: row.get(4)?,
                rate: row.get(5)?,
                amount: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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
        .query(sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Deduction {
                id: row.get(0)?,
                employee_id: row.get(1)?,
                year: row.get(2)?,
                month: row.get(3)?,
                currency: row.get(4)?,
                rate: row.get(5)?,
                amount: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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
    db.execute(update_sql, &[
        &employee_id as &dyn rusqlite::ToSql,
        &currency as &dyn rusqlite::ToSql,
        &rate as &dyn rusqlite::ToSql,
        &amount as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update deduction: {}", e))?;

    // Get the updated deduction
    let deduction_sql = "SELECT id, employee_id, COALESCE(year, 1403) as year, COALESCE(month, 'حمل') as month, currency, rate, amount, created_at, updated_at FROM deductions WHERE id = ?";
    let deductions = db
        .query(deduction_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Deduction {
                id: row.get(0)?,
                employee_id: row.get(1)?,
                year: row.get(2)?,
                month: row.get(3)?,
                currency: row.get(4)?,
                rate: row.get(5)?,
                amount: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
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
    pub created_at: String,
    pub updated_at: String,
}

/// Initialize company_settings table schema
#[tauri::command]
fn init_company_settings_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // First, check if font column exists, if not add it
    let check_column_sql = "PRAGMA table_info(company_settings)";
    let columns = db.query(check_column_sql, &[], |row| {
        Ok(row.get::<_, String>(1)?)
    }).unwrap_or_else(|_| vec![]);
    
    let has_font_column = columns.iter().any(|col| col == "font");
    
    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS company_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            logo TEXT,
            phone TEXT,
            address TEXT,
            font TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create company_settings table: {}", e))?;

    // Add font column if it doesn't exist (for existing databases)
    if !has_font_column {
        db.execute("ALTER TABLE company_settings ADD COLUMN font TEXT", &[])
            .map_err(|e| format!("Failed to add font column: {}", e))?;
    }

    // Insert default row if table is empty
    let count_sql = "SELECT COUNT(*) FROM company_settings";
    let counts = db.query(count_sql, &[], |row| Ok(row.get::<_, i64>(0)?))
        .unwrap_or_else(|_| vec![]);
    let count: i64 = counts.first().copied().unwrap_or(0);
    
    if count == 0 {
        let insert_sql = "INSERT INTO company_settings (name, logo, phone, address, font) VALUES (?, ?, ?, ?, ?)";
        db.execute(insert_sql, &[
            &"شرکت" as &dyn rusqlite::ToSql,
            &None::<String> as &dyn rusqlite::ToSql,
            &None::<String> as &dyn rusqlite::ToSql,
            &None::<String> as &dyn rusqlite::ToSql,
            &None::<String> as &dyn rusqlite::ToSql,
        ])
        .map_err(|e| format!("Failed to insert default company settings: {}", e))?;
    }

    Ok("Company settings table initialized successfully".to_string())
}

/// Get company settings (only one row should exist)
#[tauri::command]
fn get_company_settings(db_state: State<'_, Mutex<Option<Database>>>) -> Result<CompanySettings, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let sql = "SELECT id, name, logo, phone, address, font, created_at, updated_at FROM company_settings ORDER BY id LIMIT 1";
    let settings_list = db
        .query(sql, &[], |row| {
            Ok(CompanySettings {
                id: row.get(0)?,
                name: row.get(1)?,
                logo: row.get(2)?,
                phone: row.get(3)?,
                address: row.get(4)?,
                font: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
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
) -> Result<CompanySettings, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    // Check if settings exist
    let count_sql = "SELECT COUNT(*) FROM company_settings";
    let counts = db.query(count_sql, &[], |row| Ok(row.get::<_, i64>(0)?))
        .unwrap_or_else(|_| vec![]);
    let count: i64 = counts.first().copied().unwrap_or(0);

    if count == 0 {
        // Insert new settings
        let insert_sql = "INSERT INTO company_settings (name, logo, phone, address, font) VALUES (?, ?, ?, ?, ?)";
        db.execute(insert_sql, &[
            &name as &dyn rusqlite::ToSql,
            &logo as &dyn rusqlite::ToSql,
            &phone as &dyn rusqlite::ToSql,
            &address as &dyn rusqlite::ToSql,
            &font as &dyn rusqlite::ToSql,
        ])
        .map_err(|e| format!("Failed to insert company settings: {}", e))?;
    } else {
        // Update existing settings (update first row)
        let update_sql = "UPDATE company_settings SET name = ?, logo = ?, phone = ?, address = ?, font = ?, updated_at = CURRENT_TIMESTAMP WHERE id = (SELECT id FROM company_settings ORDER BY id LIMIT 1)";
        db.execute(update_sql, &[
            &name as &dyn rusqlite::ToSql,
            &logo as &dyn rusqlite::ToSql,
            &phone as &dyn rusqlite::ToSql,
            &address as &dyn rusqlite::ToSql,
            &font as &dyn rusqlite::ToSql,
        ])
        .map_err(|e| format!("Failed to update company settings: {}", e))?;
    }

    // Get the updated settings (reuse the same db reference)
    let get_sql = "SELECT id, name, logo, phone, address, font, created_at, updated_at FROM company_settings ORDER BY id LIMIT 1";
    let settings_list = db
        .query(get_sql, &[], |row| {
            Ok(CompanySettings {
                id: row.get(0)?,
                name: row.get(1)?,
                logo: row.get(2)?,
                phone: row.get(3)?,
                address: row.get(4)?,
                font: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
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

/// Initialize COA categories table schema
#[tauri::command]
fn init_coa_categories_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS coa_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            parent_id INTEGER,
            name TEXT NOT NULL,
            code TEXT NOT NULL UNIQUE,
            category_type TEXT NOT NULL,
            level INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (parent_id) REFERENCES coa_categories(id) ON DELETE SET NULL
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create coa_categories table: {}", e))?;

    Ok("COA categories table initialized successfully".to_string())
}

/// Initialize account currency balances table schema
#[tauri::command]
fn init_account_currency_balances_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS account_currency_balances (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            currency_id INTEGER NOT NULL,
            balance REAL NOT NULL DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
            FOREIGN KEY (currency_id) REFERENCES currencies(id),
            UNIQUE(account_id, currency_id)
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create account_currency_balances table: {}", e))?;

    Ok("Account currency balances table initialized successfully".to_string())
}

/// Initialize journal entries table schema
#[tauri::command]
fn init_journal_entries_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS journal_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_number TEXT NOT NULL UNIQUE,
            entry_date TEXT NOT NULL,
            description TEXT,
            reference_type TEXT,
            reference_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create journal_entries table: {}", e))?;

    Ok("Journal entries table initialized successfully".to_string())
}

/// Initialize journal entry lines table schema
#[tauri::command]
fn init_journal_entry_lines_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS journal_entry_lines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            journal_entry_id INTEGER NOT NULL,
            account_id INTEGER NOT NULL,
            currency_id INTEGER NOT NULL,
            debit_amount REAL NOT NULL DEFAULT 0,
            credit_amount REAL NOT NULL DEFAULT 0,
            exchange_rate REAL NOT NULL DEFAULT 1,
            base_amount REAL NOT NULL DEFAULT 0,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
            FOREIGN KEY (account_id) REFERENCES accounts(id),
            FOREIGN KEY (currency_id) REFERENCES currencies(id)
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create journal_entry_lines table: {}", e))?;

    Ok("Journal entry lines table initialized successfully".to_string())
}

/// Initialize currency exchange rates table schema
#[tauri::command]
fn init_currency_exchange_rates_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS currency_exchange_rates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_currency_id INTEGER NOT NULL,
            to_currency_id INTEGER NOT NULL,
            rate REAL NOT NULL,
            date TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (from_currency_id) REFERENCES currencies(id),
            FOREIGN KEY (to_currency_id) REFERENCES currencies(id)
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create currency_exchange_rates table: {}", e))?;

    Ok("Currency exchange rates table initialized successfully".to_string())
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
            .query(parent_level_sql, &[&pid as &dyn rusqlite::ToSql], |row| {
                Ok(row.get::<_, i64>(0)?)
            })
            .map_err(|e| format!("Failed to fetch parent level: {}", e))?;
        parent_levels.first().copied().unwrap_or(0) + 1
    } else {
        0
    };

    let insert_sql = "INSERT INTO coa_categories (parent_id, name, code, category_type, level) VALUES (?, ?, ?, ?, ?)";
    db.execute(insert_sql, &[
        &parent_id as &dyn rusqlite::ToSql,
        &name as &dyn rusqlite::ToSql,
        &code as &dyn rusqlite::ToSql,
        &category_type as &dyn rusqlite::ToSql,
        &level as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert COA category: {}", e))?;

    // Get the created category
    let category_sql = "SELECT id, parent_id, name, code, category_type, level, created_at, updated_at FROM coa_categories WHERE code = ? ORDER BY id DESC LIMIT 1";
    let categories = db
        .query(category_sql, &[&code as &dyn rusqlite::ToSql], |row| {
            Ok(CoaCategory {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                code: row.get(3)?,
                category_type: row.get(4)?,
                level: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
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
        .query(sql, &[], |row| {
            Ok(CoaCategory {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                code: row.get(3)?,
                category_type: row.get(4)?,
                level: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
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
            .query(parent_level_sql, &[&pid as &dyn rusqlite::ToSql], |row| {
                Ok(row.get::<_, i64>(0)?)
            })
            .map_err(|e| format!("Failed to fetch parent level: {}", e))?;
        parent_levels.first().copied().unwrap_or(0) + 1
    } else {
        0
    };

    let update_sql = "UPDATE coa_categories SET parent_id = ?, name = ?, code = ?, category_type = ?, level = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_sql, &[
        &parent_id as &dyn rusqlite::ToSql,
        &name as &dyn rusqlite::ToSql,
        &code as &dyn rusqlite::ToSql,
        &category_type as &dyn rusqlite::ToSql,
        &level as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update COA category: {}", e))?;

    // Get the updated category
    let category_sql = "SELECT id, parent_id, name, code, category_type, level, created_at, updated_at FROM coa_categories WHERE id = ?";
    let categories = db
        .query(category_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(CoaCategory {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                code: row.get(3)?,
                category_type: row.get(4)?,
                level: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
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
        .query(children_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
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
        .query(accounts_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
        })
        .map_err(|e| format!("Failed to check accounts: {}", e))?
        .first()
        .copied()
        .unwrap_or(0);

    if accounts_count > 0 {
        return Err("Cannot delete category with assigned accounts".to_string());
    }

    let delete_sql = "DELETE FROM coa_categories WHERE id = ?";
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
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
        .query(check_sql, &[], |row| Ok(row.get::<_, i64>(0)?))
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
        db.execute(insert_sql, &[
            &parent_id as &dyn rusqlite::ToSql,
            &name as &dyn rusqlite::ToSql,
            &code as &dyn rusqlite::ToSql,
            &category_type as &dyn rusqlite::ToSql,
            &level as &dyn rusqlite::ToSql,
        ])
        .map_err(|e| format!("Failed to insert COA category {}: {}", code, e))?;

        let get_id_sql = "SELECT id FROM coa_categories WHERE code = ? ORDER BY id DESC LIMIT 1";
        let ids: Vec<i64> = db
            .query(get_id_sql, &[&code as &dyn rusqlite::ToSql], |row| Ok(row.get::<_, i64>(0)?))
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

/// Initialize accounts table schema
#[tauri::command]
fn init_accounts_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            currency_id INTEGER,
            coa_category_id INTEGER,
            account_code TEXT UNIQUE,
            account_type TEXT,
            initial_balance REAL NOT NULL DEFAULT 0,
            current_balance REAL NOT NULL DEFAULT 0,
            is_active INTEGER NOT NULL DEFAULT 1,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (currency_id) REFERENCES currencies(id),
            FOREIGN KEY (coa_category_id) REFERENCES coa_categories(id)
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create accounts table: {}", e))?;

    // Add new columns if they don't exist (for existing databases)
    let alter_queries = vec![
        "ALTER TABLE accounts ADD COLUMN coa_category_id INTEGER",
        "ALTER TABLE accounts ADD COLUMN account_code TEXT UNIQUE",
        "ALTER TABLE accounts ADD COLUMN account_type TEXT",
        "ALTER TABLE accounts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1",
    ];

    for alter_sql in alter_queries {
        let _ = db.execute(alter_sql, &[]);
    }

    Ok("Accounts table initialized successfully".to_string())
}

/// Initialize account transactions table schema
#[tauri::command]
fn init_account_transactions_table(db_state: State<'_, Mutex<Option<Database>>>) -> Result<String, String> {
    let db_guard = db_state.lock().map_err(|e| format!("Lock error: {}", e))?;
    let db = db_guard.as_ref().ok_or("No database is currently open")?;

    let create_table_sql = "
        CREATE TABLE IF NOT EXISTS account_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            transaction_type TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT NOT NULL,
            rate REAL NOT NULL,
            total REAL NOT NULL,
            transaction_date TEXT NOT NULL,
            is_full INTEGER NOT NULL DEFAULT 0,
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
        )
    ";

    db.execute(create_table_sql, &[])
        .map_err(|e| format!("Failed to create account_transactions table: {}", e))?;

    Ok("Account transactions table initialized successfully".to_string())
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
    db.execute(insert_sql, &[
        &name as &dyn rusqlite::ToSql,
        &currency_id as &dyn rusqlite::ToSql,
        &coa_category_id as &dyn rusqlite::ToSql,
        &code_str as &dyn rusqlite::ToSql,
        &type_str as &dyn rusqlite::ToSql,
        &initial_balance as &dyn rusqlite::ToSql,
        &initial_balance as &dyn rusqlite::ToSql,
        &is_active_int as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert account: {}", e))?;

    // Get the created account ID first
    let account_id_sql = "SELECT id FROM accounts WHERE name = ? ORDER BY id DESC LIMIT 1";
    let account_ids = db
        .query(account_id_sql, &[&name as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
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
        .query(account_sql, &[&name as &dyn rusqlite::ToSql], |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                currency_id: row.get(2)?,
                coa_category_id: row.get(3)?,
                account_code: row.get(4)?,
                account_type: row.get(5)?,
                initial_balance: row.get(6)?,
                current_balance: row.get(7)?,
                is_active: row.get::<_, i64>(8)? != 0,
                notes: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
        .query(sql, &[], |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                currency_id: row.get(2)?,
                coa_category_id: row.get(3)?,
                account_code: row.get(4)?,
                account_type: row.get(5)?,
                initial_balance: row.get(6)?,
                current_balance: row.get(7)?,
                is_active: row.get::<_, i64>(8)? != 0,
                notes: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
        .query(sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                currency_id: row.get(2)?,
                coa_category_id: row.get(3)?,
                account_code: row.get(4)?,
                account_type: row.get(5)?,
                initial_balance: row.get(6)?,
                current_balance: row.get(7)?,
                is_active: row.get::<_, i64>(8)? != 0,
                notes: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
    db.execute(update_sql, &[
        &name as &dyn rusqlite::ToSql,
        &currency_id as &dyn rusqlite::ToSql,
        &coa_category_id as &dyn rusqlite::ToSql,
        &code_str as &dyn rusqlite::ToSql,
        &type_str as &dyn rusqlite::ToSql,
        &initial_balance as &dyn rusqlite::ToSql,
        &is_active_int as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
        &id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to update account: {}", e))?;

    // Recalculate current balance
    let balance = calculate_account_balance_internal(db, id)?;
    let update_balance_sql = "UPDATE accounts SET current_balance = ? WHERE id = ?";
    db.execute(update_balance_sql, &[&balance as &dyn rusqlite::ToSql, &id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to update account balance: {}", e))?;

    // Get the updated account directly
    let account_sql = "SELECT id, name, currency_id, coa_category_id, account_code, account_type, initial_balance, current_balance, is_active, notes, created_at, updated_at FROM accounts WHERE id = ?";
    let accounts = db
        .query(account_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(Account {
                id: row.get(0)?,
                name: row.get(1)?,
                currency_id: row.get(2)?,
                coa_category_id: row.get(3)?,
                account_code: row.get(4)?,
                account_type: row.get(5)?,
                initial_balance: row.get(6)?,
                current_balance: row.get(7)?,
                is_active: row.get::<_, i64>(8)? != 0,
                notes: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
    db.execute(delete_sql, &[&id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to delete account: {}", e))?;

    Ok("Account deleted successfully".to_string())
}

/// Calculate account balance (internal helper)
fn calculate_account_balance_internal(db: &Database, account_id: i64) -> Result<f64, String> {
    // Get initial balance
    let initial_balance_sql = "SELECT initial_balance FROM accounts WHERE id = ?";
    let initial_balances = db
        .query(initial_balance_sql, &[&account_id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, f64>(0)?)
        })
        .map_err(|e| format!("Failed to fetch initial balance: {}", e))?;

    let initial_balance = initial_balances.first().copied().unwrap_or(0.0);

    // Calculate sum of deposits
    let deposits_sql = "SELECT COALESCE(SUM(total), 0) FROM account_transactions WHERE account_id = ? AND transaction_type = 'deposit'";
    let deposits = db
        .query(deposits_sql, &[&account_id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, f64>(0)?)
        })
        .map_err(|e| format!("Failed to calculate deposits: {}", e))?;

    let total_deposits = deposits.first().copied().unwrap_or(0.0);

    // Calculate sum of withdrawals
    let withdrawals_sql = "SELECT COALESCE(SUM(total), 0) FROM account_transactions WHERE account_id = ? AND transaction_type = 'withdraw'";
    let withdrawals = db
        .query(withdrawals_sql, &[&account_id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, f64>(0)?)
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
        .query(currency_id_sql, &[&currency as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
        })
        .map_err(|e| format!("Failed to get currency ID: {}", e))?;
    let currency_id = currency_ids.first().ok_or("Currency not found")?;

    // Insert transaction
    let insert_sql = "INSERT INTO account_transactions (account_id, transaction_type, amount, currency, rate, total, transaction_date, is_full, notes) VALUES (?, 'deposit', ?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, &[
        &account_id as &dyn rusqlite::ToSql,
        &final_amount as &dyn rusqlite::ToSql,
        &currency as &dyn rusqlite::ToSql,
        &rate as &dyn rusqlite::ToSql,
        &total as &dyn rusqlite::ToSql,
        &transaction_date as &dyn rusqlite::ToSql,
        &is_full_int as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert deposit transaction: {}", e))?;

    // Update account currency balance
    let current_currency_balance = get_account_balance_by_currency_internal(db, account_id, *currency_id)?;
    let new_currency_balance = current_currency_balance + final_amount;
    update_account_currency_balance_internal(db, account_id, *currency_id, new_currency_balance)?;

    // Update account balance
    let new_balance = calculate_account_balance_internal(db, account_id)?;
    let update_balance_sql = "UPDATE accounts SET current_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_balance_sql, &[&new_balance as &dyn rusqlite::ToSql, &account_id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to update account balance: {}", e))?;

    // Create journal entry: Debit Account, Credit Cash/Source
    let cash_account_sql = "SELECT id FROM accounts WHERE account_type = 'Asset' AND (name LIKE '%Cash%' OR name LIKE '%Bank%') LIMIT 1";
    let cash_accounts = db.query(cash_account_sql, &[], |row| Ok(row.get::<_, i64>(0)?))
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
        .query(transaction_sql, &[&account_id as &dyn rusqlite::ToSql], |row| {
            Ok(AccountTransaction {
                id: row.get(0)?,
                account_id: row.get(1)?,
                transaction_type: row.get(2)?,
                amount: row.get(3)?,
                currency: row.get(4)?,
                rate: row.get(5)?,
                total: row.get(6)?,
                transaction_date: row.get(7)?,
                is_full: row.get::<_, i64>(8)? != 0,
                notes: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
        .query(currency_id_sql, &[&currency as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
        })
        .map_err(|e| format!("Failed to get currency ID: {}", e))?;
    let currency_id = currency_ids.first().ok_or("Currency not found")?;

    // Insert transaction
    let insert_sql = "INSERT INTO account_transactions (account_id, transaction_type, amount, currency, rate, total, transaction_date, is_full, notes) VALUES (?, 'withdraw', ?, ?, ?, ?, ?, ?, ?)";
    db.execute(insert_sql, &[
        &account_id as &dyn rusqlite::ToSql,
        &final_amount as &dyn rusqlite::ToSql,
        &currency as &dyn rusqlite::ToSql,
        &rate as &dyn rusqlite::ToSql,
        &total as &dyn rusqlite::ToSql,
        &transaction_date as &dyn rusqlite::ToSql,
        &is_full_int as &dyn rusqlite::ToSql,
        &notes_str as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert withdrawal transaction: {}", e))?;

    // Update account currency balance
    let current_currency_balance = get_account_balance_by_currency_internal(db, account_id, *currency_id)?;
    let new_currency_balance = current_currency_balance - final_amount;
    update_account_currency_balance_internal(db, account_id, *currency_id, new_currency_balance)?;

    // Update account balance
    let new_balance = calculate_account_balance_internal(db, account_id)?;
    let update_balance_sql = "UPDATE accounts SET current_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_balance_sql, &[&new_balance as &dyn rusqlite::ToSql, &account_id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to update account balance: {}", e))?;

    // Create journal entry: Debit Expense/Cash, Credit Account
    let expense_account_sql = "SELECT id FROM accounts WHERE account_type = 'Expense' LIMIT 1";
    let expense_accounts = db.query(expense_account_sql, &[], |row| Ok(row.get::<_, i64>(0)?))
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
        .query(transaction_sql, &[&account_id as &dyn rusqlite::ToSql], |row| {
            Ok(AccountTransaction {
                id: row.get(0)?,
                account_id: row.get(1)?,
                transaction_type: row.get(2)?,
                amount: row.get(3)?,
                currency: row.get(4)?,
                rate: row.get(5)?,
                total: row.get(6)?,
                transaction_date: row.get(7)?,
                is_full: row.get::<_, i64>(8)? != 0,
                notes: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
        .query(sql, &[&account_id as &dyn rusqlite::ToSql], |row| {
            Ok(AccountTransaction {
                id: row.get(0)?,
                account_id: row.get(1)?,
                transaction_type: row.get(2)?,
                amount: row.get(3)?,
                currency: row.get(4)?,
                rate: row.get(5)?,
                total: row.get(6)?,
                transaction_date: row.get(7)?,
                is_full: row.get::<_, i64>(8)? != 0,
                notes: row.get(9)?,
                created_at: row.get(10)?,
                updated_at: row.get(11)?,
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
        .query(sql, &[&account_id as &dyn rusqlite::ToSql, &currency_id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, f64>(0)?)
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
        .query(sql, &[&account_id as &dyn rusqlite::ToSql], |row| {
            Ok(AccountCurrencyBalance {
                id: row.get(0)?,
                account_id: row.get(1)?,
                currency_id: row.get(2)?,
                balance: row.get(3)?,
                updated_at: row.get(4)?,
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
        ON CONFLICT(account_id, currency_id) DO UPDATE SET
            balance = excluded.balance,
            updated_at = CURRENT_TIMESTAMP
    ";
    db.execute(upsert_sql, &[
        &account_id as &dyn rusqlite::ToSql,
        &currency_id as &dyn rusqlite::ToSql,
        &balance as &dyn rusqlite::ToSql,
    ])
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
        .query(entry_number_sql, &[], |row| {
            Ok(row.get::<_, i64>(0)?)
        })
        .map_err(|e| format!("Failed to generate entry number: {}", e))?;
    let entry_number = format!("J{:06}", entry_numbers.first().copied().unwrap_or(1));

    let desc_str: Option<&str> = description.as_ref().map(|s| s.as_str());
    let ref_type_str: Option<&str> = reference_type.as_ref().map(|s| s.as_str());

    // Insert journal entry
    let insert_sql = "INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?)";
    db.execute(insert_sql, &[
        &entry_number as &dyn rusqlite::ToSql,
        &entry_date as &dyn rusqlite::ToSql,
        &desc_str as &dyn rusqlite::ToSql,
        &ref_type_str as &dyn rusqlite::ToSql,
        &reference_id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert journal entry: {}", e))?;

    // Get the created entry ID
    let entry_id_sql = "SELECT id FROM journal_entries WHERE entry_number = ?";
    let entry_ids = db
        .query(entry_id_sql, &[&entry_number as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
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
        db.execute(insert_line_sql, &[
            entry_id as &dyn rusqlite::ToSql,
            &account_id as &dyn rusqlite::ToSql,
            &currency_id as &dyn rusqlite::ToSql,
            &debit_amount as &dyn rusqlite::ToSql,
            &credit_amount as &dyn rusqlite::ToSql,
            &exchange_rate as &dyn rusqlite::ToSql,
            &base_amount as &dyn rusqlite::ToSql,
            &line_desc_str as &dyn rusqlite::ToSql,
        ])
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
        .query(entry_number_sql, &[], |row| {
            Ok(row.get::<_, i64>(0)?)
        })
        .map_err(|e| format!("Failed to generate entry number: {}", e))?;
    let entry_number = format!("J{:06}", entry_numbers.first().copied().unwrap_or(1));

    let desc_str: Option<&str> = description.as_ref().map(|s| s.as_str());
    let ref_type_str: Option<&str> = reference_type.as_ref().map(|s| s.as_str());

    // Insert journal entry
    let insert_sql = "INSERT INTO journal_entries (entry_number, entry_date, description, reference_type, reference_id) VALUES (?, ?, ?, ?, ?)";
    db.execute(insert_sql, &[
        &entry_number as &dyn rusqlite::ToSql,
        &entry_date as &dyn rusqlite::ToSql,
        &desc_str as &dyn rusqlite::ToSql,
        &ref_type_str as &dyn rusqlite::ToSql,
        &reference_id as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert journal entry: {}", e))?;

    // Get the created entry ID
    let entry_id_sql = "SELECT id FROM journal_entries WHERE entry_number = ?";
    let entry_ids = db
        .query(entry_id_sql, &[&entry_number as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, i64>(0)?)
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
        db.execute(insert_line_sql, &[
            entry_id as &dyn rusqlite::ToSql,
            &account_id as &dyn rusqlite::ToSql,
            &currency_id as &dyn rusqlite::ToSql,
            &debit_amount as &dyn rusqlite::ToSql,
            &credit_amount as &dyn rusqlite::ToSql,
            &exchange_rate as &dyn rusqlite::ToSql,
            &base_amount as &dyn rusqlite::ToSql,
            &line_desc_str as &dyn rusqlite::ToSql,
        ])
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
        .query(entry_sql, &[entry_id as &dyn rusqlite::ToSql], |row| {
            Ok(JournalEntry {
                id: row.get(0)?,
                entry_number: row.get(1)?,
                entry_date: row.get(2)?,
                description: row.get(3)?,
                reference_type: row.get(4)?,
                reference_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
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
        .query(sql, &[&account_id as &dyn rusqlite::ToSql, &currency_id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, f64>(0)?)
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
        .query(count_sql, &[], |row| {
            Ok(row.get::<_, i64>(0)?)
        })
        .map_err(|e| format!("Failed to count journal entries: {}", e))?
        .first()
        .copied()
        .unwrap_or(0);

    // Get paginated entries
    let sql = "SELECT id, entry_number, entry_date, description, reference_type, reference_id, created_at, updated_at FROM journal_entries ORDER BY entry_date DESC, id DESC LIMIT ? OFFSET ?";
    let entries = db
        .query(sql, &[&per_page as &dyn rusqlite::ToSql, &offset as &dyn rusqlite::ToSql], |row| {
            Ok(JournalEntry {
                id: row.get(0)?,
                entry_number: row.get(1)?,
                entry_date: row.get(2)?,
                description: row.get(3)?,
                reference_type: row.get(4)?,
                reference_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
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
        .query(entry_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(JournalEntry {
                id: row.get(0)?,
                entry_number: row.get(1)?,
                entry_date: row.get(2)?,
                description: row.get(3)?,
                reference_type: row.get(4)?,
                reference_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })
        .map_err(|e| format!("Failed to fetch journal entry: {}", e))?;

    let entry = entries.first().ok_or("Journal entry not found")?;

    // Get lines
    let lines_sql = "SELECT id, journal_entry_id, account_id, currency_id, debit_amount, credit_amount, exchange_rate, base_amount, description, created_at FROM journal_entry_lines WHERE journal_entry_id = ?";
    let lines = db
        .query(lines_sql, &[&id as &dyn rusqlite::ToSql], |row| {
            Ok(JournalEntryLine {
                id: row.get(0)?,
                journal_entry_id: row.get(1)?,
                account_id: row.get(2)?,
                currency_id: row.get(3)?,
                debit_amount: row.get(4)?,
                credit_amount: row.get(5)?,
                exchange_rate: row.get(6)?,
                base_amount: row.get(7)?,
                description: row.get(8)?,
                created_at: row.get(9)?,
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
        .query(existing_lines_sql, &[&entry_id as &dyn rusqlite::ToSql], |row| {
            Ok((
                row.get::<_, i64>(0)?, // account_id
                row.get::<_, i64>(1)?, // currency_id
                row.get::<_, f64>(2)?, // debit_amount
                row.get::<_, f64>(3)?, // credit_amount
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
    db.execute(delete_lines_sql, &[&entry_id as &dyn rusqlite::ToSql])
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
        db.execute(insert_line_sql, &[
            &entry_id as &dyn rusqlite::ToSql,
            account_id as &dyn rusqlite::ToSql,
            currency_id as &dyn rusqlite::ToSql,
            debit_amount as &dyn rusqlite::ToSql,
            credit_amount as &dyn rusqlite::ToSql,
            exchange_rate as &dyn rusqlite::ToSql,
            &base_amount as &dyn rusqlite::ToSql,
            &line_desc_str as &dyn rusqlite::ToSql,
        ])
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
            .query(entry_sql, &[&entry_id as &dyn rusqlite::ToSql], |row| {
                Ok(row.get::<_, String>(0)?)
            })
            .map_err(|e| format!("Failed to fetch entry date: {}", e))?;
        
        if let Some(entry_date) = entry_dates.first() {
            let transaction_type = if *debit_amount > 0.0 { "deposit" } else { "withdraw" };
            let amount = if *debit_amount > 0.0 { *debit_amount } else { *credit_amount };
            let currency_name_sql = "SELECT name FROM currencies WHERE id = ?";
            let currency_names = db
                .query(currency_name_sql, &[currency_id as &dyn rusqlite::ToSql], |row| {
                    Ok(row.get::<_, String>(0)?)
                })
                .ok()
                .and_then(|v| v.first().cloned());
            
            if let Some(currency_name) = currency_names {
                let total = base_amount;
                let insert_transaction_sql = "INSERT INTO account_transactions (account_id, transaction_type, amount, currency, rate, total, transaction_date, is_full, notes) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)";
                let notes_str: Option<&str> = line_desc.as_ref().map(|s| s.as_str());
                let _ = db.execute(insert_transaction_sql, &[
                    account_id as &dyn rusqlite::ToSql,
                    &transaction_type as &dyn rusqlite::ToSql,
                    &amount as &dyn rusqlite::ToSql,
                    &currency_name as &dyn rusqlite::ToSql,
                    exchange_rate as &dyn rusqlite::ToSql,
                    &total as &dyn rusqlite::ToSql,
                    entry_date as &dyn rusqlite::ToSql,
                    &notes_str as &dyn rusqlite::ToSql,
                ]);
            }
        }
    }

    // Update entry timestamp
    let update_entry_sql = "UPDATE journal_entries SET updated_at = CURRENT_TIMESTAMP WHERE id = ?";
    db.execute(update_entry_sql, &[&entry_id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to update journal entry: {}", e))?;

    // Get the updated entry
    let entry_sql = "SELECT id, entry_number, entry_date, description, reference_type, reference_id, created_at, updated_at FROM journal_entries WHERE id = ?";
    let entries = db
        .query(entry_sql, &[&entry_id as &dyn rusqlite::ToSql], |row| {
            Ok(JournalEntry {
                id: row.get(0)?,
                entry_number: row.get(1)?,
                entry_date: row.get(2)?,
                description: row.get(3)?,
                reference_type: row.get(4)?,
                reference_id: row.get(5)?,
                created_at: row.get(6)?,
                updated_at: row.get(7)?,
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
    db.execute(insert_sql, &[
        &from_currency_id as &dyn rusqlite::ToSql,
        &to_currency_id as &dyn rusqlite::ToSql,
        &rate as &dyn rusqlite::ToSql,
        &date as &dyn rusqlite::ToSql,
    ])
        .map_err(|e| format!("Failed to insert exchange rate: {}", e))?;

    // Get the created rate
    let rate_sql = "SELECT id, from_currency_id, to_currency_id, rate, date, created_at FROM currency_exchange_rates WHERE from_currency_id = ? AND to_currency_id = ? AND date = ? ORDER BY id DESC LIMIT 1";
    let rates = db
        .query(rate_sql, &[&from_currency_id as &dyn rusqlite::ToSql, &to_currency_id as &dyn rusqlite::ToSql, &date as &dyn rusqlite::ToSql], |row| {
            Ok(CurrencyExchangeRate {
                id: row.get(0)?,
                from_currency_id: row.get(1)?,
                to_currency_id: row.get(2)?,
                rate: row.get(3)?,
                date: row.get(4)?,
                created_at: row.get(5)?,
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
        db.query(sql, &[&from_currency_id as &dyn rusqlite::ToSql, &to_currency_id as &dyn rusqlite::ToSql, &d as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, f64>(0)?)
        })
        .map_err(|e| format!("Failed to fetch exchange rate: {}", e))?
    } else {
        let sql = "SELECT rate FROM currency_exchange_rates WHERE from_currency_id = ? AND to_currency_id = ? ORDER BY date DESC LIMIT 1";
        db.query(sql, &[&from_currency_id as &dyn rusqlite::ToSql, &to_currency_id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, f64>(0)?)
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
        .query(sql, &[&from_currency_id as &dyn rusqlite::ToSql, &to_currency_id as &dyn rusqlite::ToSql], |row| {
            Ok(CurrencyExchangeRate {
                id: row.get(0)?,
                from_currency_id: row.get(1)?,
                to_currency_id: row.get(2)?,
                rate: row.get(3)?,
                date: row.get(4)?,
                created_at: row.get(5)?,
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
        .query(journal_debits_sql, &[&account_id as &dyn rusqlite::ToSql, &currency_id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, f64>(0)?)
        })
        .map_err(|e| format!("Failed to calculate journal debits: {}", e))?
        .first()
        .copied()
        .unwrap_or(0.0);

    let journal_credits_sql = "SELECT COALESCE(SUM(credit_amount), 0) FROM journal_entry_lines WHERE account_id = ? AND currency_id = ?";
    let journal_credits: f64 = db
        .query(journal_credits_sql, &[&account_id as &dyn rusqlite::ToSql, &currency_id as &dyn rusqlite::ToSql], |row| {
            Ok(row.get::<_, f64>(0)?)
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
    let base_currencies = db.query(base_currency_sql, &[], |row| Ok(row.get::<_, i64>(0)?))
        .map_err(|e| format!("Failed to get base currency: {}", e))?;
    let base_currency_id = base_currencies.first().copied().unwrap_or_else(|| {
        db.query("SELECT id FROM currencies LIMIT 1", &[], |row| Ok(row.get::<_, i64>(0)?))
            .ok()
            .and_then(|v| v.first().copied())
            .unwrap_or(1)
    });

    // Migrate existing account balances to account_currency_balances
    let accounts_sql = "SELECT id, currency_id, current_balance FROM accounts";
    let accounts = db
        .query(accounts_sql, &[], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?, row.get::<_, f64>(2)?))
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
    db.execute(update_sales_sql, &[&base_currency_id as &dyn rusqlite::ToSql])
        .map_err(|e| format!("Failed to migrate sales: {}", e))?;

    Ok(format!("Migration completed. Migrated {} account balances.", migrated_count))
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
            db_create,
            db_open,
            db_close,
            db_is_open,
            db_execute,
            db_query,
            get_database_path,
            backup_database,
            save_backup_to_path,
            create_daily_backup,
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
            update_sale_item,
            delete_sale_item,
            create_sale_payment,
            get_sale_payments,
            delete_sale_payment,
            get_sale_additional_costs,
            init_services_table,
            create_service,
            get_services,
            get_service,
            update_service,
            delete_service,
            get_service_items,
            create_service_item,
            update_service_item,
            delete_service_item,
            create_service_payment,
            get_service_payments,
            delete_service_payment,
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
            validate_license_key,
            hash_password,
            verify_password,
            store_puter_credentials,
            get_puter_credentials
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
