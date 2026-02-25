//! Portable MariaDB/MySQL lifecycle: init data dir, start server, graceful shutdown.
//! Data is stored in the user's App Data directory (passed from lib.rs).

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Default port for the embedded MySQL server.
pub const EMBEDDED_MYSQL_PORT: u16 = 3306;

/// State held so we can shut down the server when the app exits.
pub struct EmbeddedMysqlGuard {
    pub child: Mutex<Option<Child>>,
}

impl Drop for EmbeddedMysqlGuard {
    fn drop(&mut self) {
        if let Some(mut child) = self.child.lock().ok().and_then(|mut g| g.take()) {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Try to find the MariaDB bin directory (contains mariadbd.exe and mariadb-install-db.exe).
fn find_mariadb_bin_dir(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let from_resource = resource_dir.join("binaries").join("mariadb").join("bin");
    if from_resource.join("mariadbd.exe").exists() {
        return Some(from_resource);
    }
    if from_resource.join("mariadbd").exists() {
        return Some(from_resource);
    }
    // Development: try relative to current exe or current dir
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            for base in [parent, parent.join("..").as_path(), parent.join("..").join("..").as_path()] {
                let canonical = base.canonicalize().ok()?;
                let bin = canonical.join("binaries").join("mariadb").join("bin");
                if bin.join("mariadbd.exe").exists() || bin.join("mariadbd").exists() {
                    return Some(bin);
                }
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let bin = cwd.join("src-tauri").join("binaries").join("mariadb").join("bin");
        if bin.join("mariadbd.exe").exists() || bin.join("mariadbd").exists() {
            return Some(bin);
        }
    }
    None
}

/// Initialize the data directory if it does not exist (run mariadb-install-db).
fn init_data_dir_if_needed(bin_dir: &std::path::Path, data_dir: &std::path::Path) -> Result<(), String> {
    let mysql_sys = data_dir.join("mysql");
    if mysql_sys.exists() && mysql_sys.is_dir() {
        return Ok(());
    }
    std::fs::create_dir_all(data_dir).map_err(|e| format!("Failed to create data dir: {}", e))?;
    let install_db = if cfg!(windows) {
        bin_dir.join("mariadb-install-db.exe")
    } else {
        bin_dir.join("mariadb-install-db")
    };
    if !install_db.exists() {
        return Err(format!("mariadb-install-db not found at {:?}", install_db));
    }
    let status = Command::new(&install_db)
        .arg(format!("--datadir={}", data_dir.display()))
        .current_dir(bin_dir.parent().unwrap_or(bin_dir))
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .status()
        .map_err(|e| format!("Failed to run mariadb-install-db: {}", e))?;
    if !status.success() {
        return Err(format!("mariadb-install-db failed with {}", status));
    }
    Ok(())
}

/// Start the embedded MariaDB server; data is stored in `app_data_mysql_dir` (e.g. App Data/mysql_data).
/// Returns a guard to hold the child process; when dropped, the server is killed.
/// Updates process env (MYSQL_*) so the rest of the app connects to this server.
pub fn start_embedded_mysql(app: &AppHandle, app_data_mysql_dir: PathBuf) -> Result<EmbeddedMysqlGuard, String> {
    let bin_dir = find_mariadb_bin_dir(app).ok_or_else(|| "MariaDB binaries not found. Place extracted MariaDB (e.g. Windows zip) in src-tauri/binaries/mariadb/.".to_string())?;
    init_data_dir_if_needed(&bin_dir, &app_data_mysql_dir)?;
    let server_bin = if cfg!(windows) {
        bin_dir.join("mariadbd.exe")
    } else {
        bin_dir.join("mariadbd")
    };
    if !server_bin.exists() {
        return Err(format!("mariadbd not found at {:?}", server_bin));
    }
    let mut child = Command::new(&server_bin)
        .arg(format!("--datadir={}", app_data_mysql_dir.display()))
        .arg(format!("--port={}", EMBEDDED_MYSQL_PORT))
        .arg("--skip-networking=0")
        .arg("--bind-address=127.0.0.1")
        .current_dir(bin_dir.parent().unwrap_or(&bin_dir))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start mariadbd: {}", e))?;
    // Give the server a moment to bind
    std::thread::sleep(Duration::from_millis(1500));
    if child.try_wait().map(|s| s.is_some()).unwrap_or(false) {
        return Err("mariadbd exited immediately. Check data directory and binaries.".to_string());
    }
    // Point the app at the embedded server
    std::env::set_var("MYSQL_HOST", "127.0.0.1");
    std::env::set_var("MYSQL_PORT", EMBEDDED_MYSQL_PORT.to_string());
    std::env::set_var("MYSQL_USER", "root");
    std::env::set_var("MYSQL_PASSWORD", "");
    std::env::set_var("MYSQL_DATABASE", "shafaf");
    Ok(EmbeddedMysqlGuard {
        child: Mutex::new(Some(child)),
    })
}
