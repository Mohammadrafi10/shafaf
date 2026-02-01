/**
 * Database schema description for the AI report generator.
 * Derived from src-tauri/src/lib.rs CREATE TABLE definitions.
 * Dates are stored as TEXT (YYYY-MM-DD or Persian date strings).
 */
export const REPORT_SCHEMA = `
## Database Schema (SQLite)

### users
- id INTEGER PK
- username TEXT, email TEXT, password_hash TEXT, full_name TEXT, phone TEXT
- role TEXT, is_active INTEGER
- created_at, updated_at DATETIME

### currencies
- id INTEGER PK
- name TEXT UNIQUE, base INTEGER, rate REAL
- created_at, updated_at DATETIME

### suppliers
- id INTEGER PK
- full_name TEXT, phone TEXT, address TEXT, email TEXT, notes TEXT
- created_at, updated_at DATETIME

### customers
- id INTEGER PK
- full_name TEXT, phone TEXT, address TEXT, email TEXT, notes TEXT
- created_at, updated_at DATETIME

### unit_groups
- id INTEGER PK
- name TEXT UNIQUE
- created_at, updated_at DATETIME

### units
- id INTEGER PK
- name TEXT UNIQUE, group_id INTEGER -> unit_groups(id), ratio REAL, is_base INTEGER
- created_at, updated_at DATETIME

### products
- id INTEGER PK
- name TEXT, description TEXT, price REAL, currency_id INTEGER -> currencies(id), supplier_id INTEGER -> suppliers(id)
- stock_quantity REAL, unit TEXT, image_path TEXT, bar_code TEXT
- created_at, updated_at DATETIME

### purchases
- id INTEGER PK
- supplier_id INTEGER -> suppliers(id), date TEXT, notes TEXT
- total_amount REAL, additional_cost REAL
- created_at, updated_at DATETIME

### purchase_items
- id INTEGER PK
- purchase_id INTEGER -> purchases(id), product_id INTEGER -> products(id), unit_id INTEGER -> units(id)
- per_price REAL, amount REAL, total REAL
- created_at DATETIME

### purchase_additional_costs
- id INTEGER PK
- purchase_id INTEGER -> purchases(id), name TEXT, amount REAL
- created_at DATETIME

### purchase_payments
- id INTEGER PK
- purchase_id INTEGER -> purchases(id), account_id INTEGER -> accounts(id)
- amount REAL, currency TEXT, rate REAL, total REAL, date TEXT, notes TEXT
- created_at DATETIME

### sales
- id INTEGER PK
- customer_id INTEGER -> customers(id), date TEXT, notes TEXT
- currency_id INTEGER -> currencies(id), exchange_rate REAL
- total_amount REAL, base_amount REAL, paid_amount REAL, additional_cost REAL
- created_at, updated_at DATETIME

### sale_items
- id INTEGER PK
- sale_id INTEGER -> sales(id), product_id INTEGER -> products(id), unit_id INTEGER -> units(id)
- per_price REAL, amount REAL, total REAL
- created_at DATETIME

### sale_payments
- id INTEGER PK
- sale_id INTEGER -> sales(id), account_id INTEGER -> accounts(id), currency_id INTEGER -> currencies(id)
- exchange_rate REAL, amount REAL, base_amount REAL, date TEXT
- created_at DATETIME

### sale_additional_costs
- id INTEGER PK
- sale_id INTEGER -> sales(id), name TEXT, amount REAL
- created_at DATETIME

### services
- id INTEGER PK
- customer_id INTEGER -> customers(id), date TEXT, notes TEXT
- currency_id INTEGER -> currencies(id), exchange_rate REAL
- total_amount REAL, base_amount REAL, paid_amount REAL
- created_at, updated_at DATETIME

### service_items
- id INTEGER PK
- service_id INTEGER -> services(id), name TEXT, price REAL, quantity REAL, total REAL
- created_at DATETIME

### service_payments
- id INTEGER PK
- service_id INTEGER -> services(id), account_id INTEGER -> accounts(id), currency_id INTEGER -> currencies(id)
- exchange_rate REAL, amount REAL, base_amount REAL, date TEXT
- created_at DATETIME

### expense_types
- id INTEGER PK
- name TEXT UNIQUE
- created_at, updated_at DATETIME

### expenses
- id INTEGER PK
- expense_type_id INTEGER -> expense_types(id), amount REAL, currency TEXT, rate REAL, total REAL
- date TEXT, bill_no TEXT, description TEXT
- created_at, updated_at DATETIME

### employees
- id INTEGER PK
- full_name TEXT, phone TEXT, email TEXT, address TEXT, position TEXT, hire_date TEXT
- base_salary REAL, photo_path TEXT, notes TEXT
- created_at, updated_at DATETIME

### salaries
- id INTEGER PK
- employee_id INTEGER -> employees(id), year INTEGER, month TEXT, amount REAL, deductions REAL, notes TEXT
- created_at, updated_at DATETIME
- UNIQUE(employee_id, year, month)

### deductions
- id INTEGER PK
- employee_id INTEGER -> employees(id), year INTEGER, month TEXT
- currency TEXT, rate REAL, amount REAL
- created_at, updated_at DATETIME

### company_settings
- id INTEGER PK
- name TEXT, logo TEXT, phone TEXT, address TEXT, font TEXT
- created_at, updated_at DATETIME

### coa_categories
- id INTEGER PK
- parent_id INTEGER -> coa_categories(id), name TEXT, code TEXT UNIQUE, category_type TEXT, level INTEGER
- created_at, updated_at DATETIME

### account_currency_balances
- id INTEGER PK
- account_id INTEGER -> accounts(id), currency_id INTEGER -> currencies(id), balance REAL
- updated_at DATETIME
- UNIQUE(account_id, currency_id)

### journal_entries
- id INTEGER PK
- entry_number TEXT UNIQUE, entry_date TEXT, description TEXT, reference_type TEXT, reference_id INTEGER
- created_at, updated_at DATETIME

### journal_entry_lines
- id INTEGER PK
- journal_entry_id INTEGER -> journal_entries(id), account_id INTEGER -> accounts(id), currency_id INTEGER -> currencies(id)
- debit_amount REAL, credit_amount REAL, exchange_rate REAL, base_amount REAL, description TEXT
- created_at DATETIME

### currency_exchange_rates
- id INTEGER PK
- from_currency_id INTEGER -> currencies(id), to_currency_id INTEGER -> currencies(id), rate REAL, date TEXT
- created_at DATETIME

### accounts
- id INTEGER PK
- name TEXT, currency_id INTEGER -> currencies(id), coa_category_id INTEGER -> coa_categories(id)
- account_code TEXT UNIQUE, account_type TEXT, initial_balance REAL, current_balance REAL, is_active INTEGER, notes TEXT
- created_at, updated_at DATETIME

### account_transactions
- id INTEGER PK
- account_id INTEGER -> accounts(id), transaction_type TEXT (deposit/withdraw)
- amount REAL, currency TEXT, rate REAL, total REAL, transaction_date TEXT, is_full INTEGER, notes TEXT
- created_at, updated_at DATETIME
`;
