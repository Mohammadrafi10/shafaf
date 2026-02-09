# License table management (PHP)

Simple web UI to manage the `licenses` table: list (with **decrypted** expiry time), create, update, delete.

## Requirements

- PHP 7.2+ with `pdo_mysql` and `openssl` (AES-256-GCM).
- MySQL server and database (same as the Shafaf desktop app license server).

## Setup

1. Copy `config.local.php.example` to `config.local.php` and set your DB host, user, password, and database name. Or set env vars: `LICENSE_DB_HOST`, `LICENSE_DB_USER`, `LICENSE_DB_PASS`, `LICENSE_DB_NAME`, `LICENSE_DB_PORT`.
2. Copy `webhost/.env.example` to `webhost/.env` and set **SUPERADMIN_PASSWORD** to a single password used to log in to the web UI. All pages (list, create, edit, delete) require this password.
3. Deploy the `webhost/` folder under your web root (e.g. `https://yourdomain.com/webhost/` or a vhost pointing to `webhost/`).

**Upload script (PowerShell):** From the project root run `.\scripts\upload-webhost.ps1` to SCP `webhost/` to the server. You’ll be prompted for the SSH password (or use key-based login). Optional: `-HostName`, `-RemoteUser`, `-RemotePath`, `-SSHKey`. Example: `.\scripts\upload-webhost.ps1 -RemotePath "/var/www/html"`.

## Pages

- **index.php** – List all licenses; shows **decrypted** expiry time (and created_at). Links to add, edit, delete.
- **create.php** – Add a new license (license_key + expiry datetime). Expiry is stored encrypted.
- **update.php** – Edit expiry only (key is read-only). Decrypted expiry is shown in the form.
- **delete.php** – Delete a license by ID.

Encryption/decryption uses the same algorithm as the desktop app (`src-tauri/src/license.rs`) so the web UI can read and update the same encrypted column.
