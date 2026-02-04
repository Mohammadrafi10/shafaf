import { invoke } from "@tauri-apps/api/core";

export interface EnvConfig {
  has_env_file: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Get current database env configuration (for setup/configuration page).
 * Values are read from the backend .env / environment.
 */
export async function getEnvConfig(): Promise<EnvConfig> {
  return await invoke<EnvConfig>("get_env_config");
}

/**
 * Save database configuration to .env and reload in the app.
 * After calling this, retry opening the database (e.g. ensureDatabase).
 */
export async function saveEnvConfig(config: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): Promise<void> {
  await invoke("save_env_config", {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
  });
}

export interface QueryResult {
  columns: string[];
  rows: Array<Array<any>>;
}

export interface ExecuteResult {
  rows_affected: number;
}

/**
 * Create a new MySQL database (if it doesn't exist) and connect
 * Connection uses MYSQL_* environment variables
 * @param dbName Name of the database (optional; uses MYSQL_DATABASE if empty)
 * @returns Promise with the connection/status message
 */
export async function createDatabase(dbName: string): Promise<string> {
  return await invoke<string>("db_create", { dbName });
}

/**
 * Open database (connect to MySQL)
 * Connection parameters are read from environment: MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
 * @param dbName Name of the database (optional; uses MYSQL_DATABASE if empty)
 * @returns Promise with the connection/status message
 */
export async function openDatabase(dbName: string): Promise<string> {
  return await invoke<string>("db_open", { dbName });
}

/**
 * Get the current database path
 * @returns Promise with the database path string
 */
export async function getDatabasePath(): Promise<string> {
  return await invoke<string>("get_database_path");
}

/**
 * Backup database - returns the database path
 * @returns Promise with the database path string
 */
export async function backupDatabase(): Promise<string> {
  return await invoke<string>("backup_database");
}

/**
 * Save backup to a user-selected path (from save dialog). Backend performs the copy.
 * @param destPath Full path where the backup file should be saved
 * @returns Promise with the destination path on success
 */
export async function saveBackupToPath(destPath: string): Promise<string> {
  return await invoke<string>("save_backup_to_path", { destPath });
}

/**
 * Get the folder path where automatic daily backups are stored.
 * @returns Promise with the backups directory path
 */
export async function getBackupsDir(): Promise<string> {
  return await invoke<string>("get_backups_dir");
}

/**
 * Create a daily backup. If customDir is set, backup is saved there; otherwise in app data backups folder.
 * Used by the automatic daily backup scheduler.
 * @param customDir Optional directory path from company settings (user-chosen auto backup location)
 * @returns Promise with the backup file path
 */
export async function createDailyBackup(customDir?: string | null): Promise<string> {
  return await invoke<string>("create_daily_backup", { customDir: customDir ?? null });
}

/**
 * Restore database from backup file
 * @param backupPath Path to the backup database file
 * @returns Promise with success message
 */
export async function restoreDatabase(backupPath: string): Promise<string> {
  return await invoke<string>("restore_database", { backupPath });
}

/**
 * Close the current database connection
 * @returns Promise with success message
 */
export async function closeDatabase(): Promise<string> {
  return await invoke<string>("db_close");
}

/**
 * Check if a database is currently open
 * @returns Promise with boolean indicating if database is open
 */
export async function isDatabaseOpen(): Promise<boolean> {
  return await invoke<boolean>("db_is_open");
}

/**
 * Execute a SQL query (INSERT, UPDATE, DELETE, CREATE TABLE, etc.)
 * @param sql SQL query string
 * @param params Optional array of parameters for prepared statements
 * @returns Promise with ExecuteResult containing rows_affected
 */
export async function executeQuery(
  sql: string,
  params: any[] = []
): Promise<ExecuteResult> {
  return await invoke<ExecuteResult>("db_execute", { sql, params });
}

/**
 * Execute a SELECT query and return results
 * @param sql SQL SELECT query string
 * @param params Optional array of parameters for prepared statements
 * @returns Promise with QueryResult containing columns and rows
 */
export async function queryDatabase(
  sql: string,
  params: any[] = []
): Promise<QueryResult> {
  return await invoke<QueryResult>("db_query", { sql, params });
}

/**
 * Helper function to convert query results to objects
 * @param result QueryResult from queryDatabase
 * @returns Array of objects with column names as keys
 */
export function resultToObjects(result: QueryResult): Record<string, any>[] {
  return result.rows.map((row) => {
    const obj: Record<string, any> = {};
    result.columns.forEach((col, index) => {
      obj[col] = row[index];
    });
    return obj;
  });
}
