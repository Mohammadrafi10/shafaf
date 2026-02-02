# شفاف (Shafaf)

A bilingual (Persian/Dari) finance and accounting app built with Tauri 2, React, TypeScript, and MySQL. Supports Windows and Android.

## MySQL authentication (required for MySQL 8)

The app only works with MySQL users that use the **mysql_native_password** or **caching_sha2_password** plugin. If you see “Unknown authentication protocol: sha256_password” or the Persian message about plugins, do the following.

1. Open Command Prompt or PowerShell and connect to MySQL (adjust path if your MySQL is installed elsewhere):
   ```bash
   "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql" -u root -p
   ```
2. When prompted, enter your current root password (e.g. `S11solai`).
3. In the MySQL prompt, run these two commands (they switch `root@localhost` to `mysql_native_password` and reload privileges). Replace `your_password` with your actual password:
   ```sql
   ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY 'your_password';
   FLUSH PRIVILEGES;
   ```
4. Type `exit` to leave MySQL.
5. Start your app again and try to connect.

**Meaning of each part**

- **ALTER USER 'root'@'localhost'** – change the user named `root` that connects from `localhost`.
- **IDENTIFIED WITH mysql_native_password** – use the password plugin that the app supports.
- **BY 'your_password'** – set the password (use the same value as in your `.env`).
- **FLUSH PRIVILEGES;** – apply the change immediately.

After this, the “این برنامه فقط با کاربران MySQL با پلاگین …” message should no longer appear and the app should connect, because `root@localhost` will be using `mysql_native_password` instead of `sha256_password`.

## Documentation

Full documentation is in the **[wiki/](wiki/)** folder:

- [Home](wiki/Home.md) — overview and quick links
- [Getting Started](wiki/Getting-Started.md) — license and login
- [Installation](wiki/Installation.md) — Windows and Android
- [Features](wiki/Features.md) — modules and workflows
- [Development](wiki/Development.md) — setup and project layout
- [Building and Release](wiki/Building-and-Release.md) — build and CI
- [Configuration](wiki/Configuration.md) — env and settings
- [Android Setup](wiki/Android-Setup.md) — Android toolchain and signing
- [Troubleshooting](wiki/Troubleshooting.md) — common issues
- [License](wiki/License.md) — license check and generator

See [wiki/README.md](wiki/README.md) for how to add these to the GitHub Wiki.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
