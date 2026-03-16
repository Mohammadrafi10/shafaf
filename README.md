# شفاف (Shafaf)

A bilingual (Persian/Dari) finance and accounting app built with **Tauri 2**, **React**, **TypeScript**, and **MySQL**. Supports **Windows desktop** (primary) and **Android** (via webview wrapper / companion build).

---

## Project overview

- **Domain**: SME finance, inventory, and accounting (Afghanistan-focused, Dari UI).
- **Key capabilities**:
  - Product, purchase, and sales management (with **batch-level stock tracking** and unit groups).
  - Customer and supplier ledgers, payments, and balances.
  - Employee, salary, and deduction management.
  - Expense tracking and service (non-stock) sales.
  - Multi-currency accounts and simple chart-of-accounts integration.
  - Smart and classic reports (including AI-assisted reporting).
  - License management, automatic backups, and update checks.

---

## Frameworks, stack, and project structure

- **Desktop shell**: [Tauri 2](https://tauri.app/) (Rust backend + webview frontend)
- **Frontend**:
  - React 18 + TypeScript
  - Tailwind-style utility classes (via PostCSS / compiled CSS)
  - `framer-motion` (with a “low graphics” mode where heavy animations are disabled)
- **Backend (Tauri commands)**:
  - Rust, with:
    - Embedded MariaDB binaries for portable deployments
    - MySQL / MariaDB client library for DB access
    - File system + process invocation (backup/restore mysqldump / mysql)
- **Database**:
  - MySQL / MariaDB
  - Full schema defined in `src-tauri/data/db.sql`
  - Uses `DOUBLE` for most numeric columns and supports decimal quantities for stock/batches

High-level layout:

- `src/` – React/TS frontend (pages, components, utils).
- `src-tauri/` – Tauri 2 Rust backend, commands, and DB integration.
- `src-tauri/data/db.sql` – canonical MySQL schema (run automatically on first init).
- `wiki/` – full user and developer documentation.

---

## Core modules and features

### Functional modules (UI)

| Module / Page              | Description                                                                                          |
|----------------------------|------------------------------------------------------------------------------------------------------|
| Dashboard                  | High-level KPIs (products, suppliers, purchases, sales, deductions, income) with quick navigation. |
| Products                   | Product catalog, units, prices, barcodes, images, and current aggregated stock.                    |
| Purchases                  | Purchase invoices, additional costs (e.g. transport), batch numbers, expiry dates.                 |
| Sales                      | Sales invoices (retail/wholesale), batch selection, quantity in multiple units, discounts.         |
| Stock by Batch             | Detailed batch-level stock report (*number, date, expiry, remaining quantity, value, margin*).     |
| Customers                  | Customer profiles, balances, and drill-down to customer detail page.                               |
| Suppliers                  | Supplier profiles, balances, and drill-down to supplier detail page.                               |
| Purchase Payments          | Payments against purchases, per-account and per-currency.                                          |
| Sales Payments             | Payments against sales, per-account and per-currency.                                              |
| Services                   | Service catalog (non-stock items) and service items on sales.                                      |
| Expenses                   | Operating expenses and cost tracking.                                                              |
| Employees & Salaries       | Employee master data, salary records, and related deductions.                                      |
| Deductions                 | Salary deduction definitions and postings.                                                         |
| Users & Profile            | User management, roles, and user profile editing (including profile picture).                      |
| Company Settings           | Company name, logo, fonts, auto-backup directory, quick links to currency/unit/account.           |
| Accounts & COA             | Financial accounts, currencies, and linkage to chart-of-accounts categories.                       |
| Reports                    | Tabular reports with date filters, export helpers.                                                 |
| AI Report                  | AI-assisted report generator (tables and charts based on textual prompts).                         |
| License                    | License key input, validation, remaining days, and server-side re-check.                           |
| Database Config            | MySQL connection config (host, port, user, password, database) and env storage.                    |

### Batch and stock features

**Purchases (batches)**:

- Each `purchase_items` row represents a batch:
  - `batch_number` stored on `purchases`.
  - `amount`, `unit_id`, `per_price`, `per_unit`, `wholesale_price`, `retail_price`, `expiry_date`.
- Supports **different units** for purchase vs sale via unit groups and ratios.

**Sales (batch-aware)**:

- Per sale line:
  - Select product → load available batches via `get_product_batches`.
  - Select **batch (purchase_item_id)** and sale type: `retail` / `wholesale`.
  - Price auto-selected from **retail/wholesale price** on the batch (fallback to `per_price`).
  - Quantity supports **decimals (Ashari)**:
    - Input step set to `0.001`.
    - Stock comparison uses unit ratios and batch `per_unit` where needed.

**Stock report by batch**:

- Tauri command computes **remaining quantity** in batch unit with 6-decimal precision.
- UI displays:
  - **Initial quantity** and **remaining quantity** (with decimal support).
  - Unit, purchase date, expiry date, value, potential revenue, and margin.
  - **Low stock highlighting** when remaining < 10% of original amount.

---

## Database tables (high level)

For full SQL details see `src-tauri/data/db.sql`. Below is an overview of the most important tables:

| Table                     | Purpose                                                                                     |
|---------------------------|---------------------------------------------------------------------------------------------|
| `users`                   | Application users, roles, and profile metadata.                                            |
| `currencies`              | Currencies and exchange rates.                                                             |
| `suppliers`, `customers`  | Business partners with contact info and notes.                                             |
| `unit_groups`, `units`    | Unit groups and units, with `ratio` for conversions and `is_base` for base units.         |
| `products`                | Product master data (name, description, stock_quantity snapshot, base unit, barcode, etc). |
| `purchases`               | Purchase headers: supplier, date, currency, total, additional cost, batch number.         |
| `purchase_items`          | Purchase lines (per batch): product, unit, quantities, prices, per-unit factors.          |
| `purchase_additional_costs` | Extra costs linked to a purchase (transport, customs, etc.).                            |
| `sales`                   | Sales headers: customer, date, currency, totals, discounts, additional cost.              |
| `sale_items`              | Sales lines: product, unit, quantities, prices, discount, link to `purchase_items` batch. |
| `sale_payments`           | Payments against sales, per account and currency.                                          |
| `sale_additional_costs`   | Extra costs linked to a sale.                                                              |
| `services`                | Service catalog items (non-stock).                                                         |
| `sale_service_items`      | Service lines on sales.                                                                    |
| `accounts`                | Cash/bank/other accounts with initial and current balance.                                 |
| `purchase_payments`       | Payments against purchases.                                                                 |
| `coa_categories`          | Chart-of-accounts categories linked to accounts.                                           |
| `expenses` & related      | Expense records and codes.                                                                  |
| `employees`, `salaries`, `deductions` | HR and payroll details.                                                       |
| `sale_discount_codes`     | Percent/fixed discount codes with constraints and usage tracking.                          |
| `company_settings`        | Company-wide configuration (name, logo, font, auto-backup dir, etc.).                      |

This schema is migrated automatically on first run (no manual SQL needed for new installations).

---

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
