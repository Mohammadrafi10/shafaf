-- Full schema for finance app (MySQL). Run on first init when database is empty.

CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(255) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(255),
    phone VARCHAR(255),
    role VARCHAR(64) NOT NULL DEFAULT 'user',
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    profile_picture MEDIUMTEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS currencies (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL UNIQUE,
    base INT NOT NULL DEFAULT 0,
    rate DOUBLE NOT NULL DEFAULT 1.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suppliers (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    email TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customers (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    email TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS unit_groups (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS units (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name TEXT NOT NULL,
    group_id BIGINT,
    ratio DOUBLE NOT NULL DEFAULT 1.0,
    is_base INT NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (group_id) REFERENCES unit_groups(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS products (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    price DOUBLE,
    currency_id BIGINT,
    supplier_id BIGINT,
    stock_quantity DOUBLE,
    unit TEXT,
    image_path TEXT,
    bar_code TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (currency_id) REFERENCES currencies(id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
);

CREATE TABLE IF NOT EXISTS purchases (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    supplier_id BIGINT NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    currency_id BIGINT,
    total_amount DOUBLE NOT NULL DEFAULT 0,
    additional_cost DOUBLE NOT NULL DEFAULT 0,
    batch_number TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

CREATE TABLE IF NOT EXISTS purchase_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    purchase_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    unit_id BIGINT NOT NULL,
    per_price DOUBLE NOT NULL,
    amount DOUBLE NOT NULL,
    total DOUBLE NOT NULL,
    per_unit DOUBLE,
    cost_price DOUBLE,
    wholesale_price DOUBLE,
    retail_price DOUBLE,
    expiry_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (unit_id) REFERENCES units(id)
);

CREATE TABLE IF NOT EXISTS purchase_additional_costs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    purchase_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    amount DOUBLE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS coa_categories (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    parent_id BIGINT,
    name TEXT NOT NULL,
    code VARCHAR(255) NOT NULL UNIQUE,
    category_type TEXT NOT NULL,
    level INT NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES coa_categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS accounts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name TEXT NOT NULL,
    currency_id BIGINT,
    coa_category_id BIGINT,
    account_code VARCHAR(255) UNIQUE,
    account_type TEXT,
    initial_balance DOUBLE NOT NULL DEFAULT 0,
    current_balance DOUBLE NOT NULL DEFAULT 0,
    is_active INT NOT NULL DEFAULT 1,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (currency_id) REFERENCES currencies(id),
    FOREIGN KEY (coa_category_id) REFERENCES coa_categories(id)
);

CREATE TABLE IF NOT EXISTS purchase_payments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    purchase_id BIGINT NOT NULL,
    account_id BIGINT,
    amount DOUBLE NOT NULL,
    currency TEXT NOT NULL,
    rate DOUBLE NOT NULL,
    total DOUBLE NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sales (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    customer_id BIGINT NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    currency_id BIGINT,
    exchange_rate DOUBLE NOT NULL DEFAULT 1,
    total_amount DOUBLE NOT NULL DEFAULT 0,
    base_amount DOUBLE NOT NULL DEFAULT 0,
    paid_amount DOUBLE NOT NULL DEFAULT 0,
    additional_cost DOUBLE NOT NULL DEFAULT 0,
    order_discount_type TEXT,
    order_discount_value DOUBLE NOT NULL DEFAULT 0,
    order_discount_amount DOUBLE NOT NULL DEFAULT 0,
    discount_code_id BIGINT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

CREATE TABLE IF NOT EXISTS sale_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    sale_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    unit_id BIGINT NOT NULL,
    per_price DOUBLE NOT NULL,
    amount DOUBLE NOT NULL,
    total DOUBLE NOT NULL,
    purchase_item_id BIGINT,
    sale_type TEXT,
    discount_type TEXT,
    discount_value DOUBLE NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (unit_id) REFERENCES units(id),
    FOREIGN KEY (purchase_item_id) REFERENCES purchase_items(id)
);

CREATE TABLE IF NOT EXISTS sale_payments (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    sale_id BIGINT NOT NULL,
    account_id BIGINT,
    currency_id BIGINT,
    exchange_rate DOUBLE NOT NULL DEFAULT 1,
    amount DOUBLE NOT NULL,
    base_amount DOUBLE NOT NULL DEFAULT 0,
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

CREATE TABLE IF NOT EXISTS sale_additional_costs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    sale_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    amount DOUBLE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS services (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    price DOUBLE NOT NULL DEFAULT 0,
    currency_id BIGINT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

CREATE TABLE IF NOT EXISTS sale_service_items (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    sale_id BIGINT NOT NULL,
    service_id BIGINT NOT NULL,
    name TEXT NOT NULL,
    price DOUBLE NOT NULL,
    quantity DOUBLE NOT NULL DEFAULT 1,
    total DOUBLE NOT NULL,
    discount_type TEXT,
    discount_value DOUBLE NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
    FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE TABLE IF NOT EXISTS sale_discount_codes (
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
);

CREATE TABLE IF NOT EXISTS expense_types (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expenses (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    expense_type_id BIGINT NOT NULL,
    account_id BIGINT,
    amount DOUBLE NOT NULL,
    currency TEXT NOT NULL,
    rate DOUBLE NOT NULL DEFAULT 1.0,
    total DOUBLE NOT NULL,
    date TEXT NOT NULL,
    bill_no TEXT,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (expense_type_id) REFERENCES expense_types(id),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS employees (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    address TEXT NOT NULL,
    position TEXT,
    hire_date TEXT,
    base_salary DOUBLE,
    photo_path TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS salaries (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    employee_id BIGINT NOT NULL,
    year INT NOT NULL,
    month TEXT NOT NULL,
    amount DOUBLE NOT NULL,
    deductions DOUBLE NOT NULL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
    UNIQUE(employee_id, year, month(100))
);

CREATE TABLE IF NOT EXISTS deductions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    employee_id BIGINT NOT NULL,
    year INT NOT NULL DEFAULT 1403,
    month VARCHAR(255) NOT NULL DEFAULT 'حمل',
    currency TEXT NOT NULL,
    rate DOUBLE NOT NULL DEFAULT 1.0,
    amount DOUBLE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS company_settings (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    name TEXT NOT NULL,
    logo MEDIUMTEXT,
    phone TEXT,
    address TEXT,
    font TEXT,
    auto_backup_dir TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS account_currency_balances (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    account_id BIGINT NOT NULL,
    currency_id BIGINT NOT NULL,
    balance DOUBLE NOT NULL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (currency_id) REFERENCES currencies(id),
    UNIQUE(account_id, currency_id)
);

CREATE TABLE IF NOT EXISTS journal_entries (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    entry_number VARCHAR(255) NOT NULL UNIQUE,
    entry_date TEXT NOT NULL,
    description TEXT,
    reference_type TEXT,
    reference_id BIGINT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS journal_entry_lines (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    journal_entry_id BIGINT NOT NULL,
    account_id BIGINT NOT NULL,
    currency_id BIGINT NOT NULL,
    debit_amount DOUBLE NOT NULL DEFAULT 0,
    credit_amount DOUBLE NOT NULL DEFAULT 0,
    exchange_rate DOUBLE NOT NULL DEFAULT 1,
    base_amount DOUBLE NOT NULL DEFAULT 0,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (journal_entry_id) REFERENCES journal_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES accounts(id),
    FOREIGN KEY (currency_id) REFERENCES currencies(id)
);

CREATE TABLE IF NOT EXISTS currency_exchange_rates (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    from_currency_id BIGINT NOT NULL,
    to_currency_id BIGINT NOT NULL,
    rate DOUBLE NOT NULL,
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_currency_id) REFERENCES currencies(id),
    FOREIGN KEY (to_currency_id) REFERENCES currencies(id)
);

CREATE TABLE IF NOT EXISTS account_transactions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    account_id BIGINT NOT NULL,
    transaction_type TEXT NOT NULL,
    amount DOUBLE NOT NULL,
    currency TEXT NOT NULL,
    rate DOUBLE NOT NULL,
    total DOUBLE NOT NULL,
    transaction_date TEXT NOT NULL,
    is_full INT NOT NULL DEFAULT 0,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

-- Default currencies (افغانی as base)
INSERT IGNORE INTO currencies (name, base, rate) VALUES
    ('افغانی', 1, 1.0),
    ('دالر', 0, 1.0),
    ('کلدار', 0, 1.0),
    ('یورو', 0, 1.0),
    ('تومان', 0, 1.0);

-- Default unit groups and units
INSERT IGNORE INTO unit_groups (name) VALUES ('تعداد'), ('وزن'), ('طول'), ('حجم');

INSERT IGNORE INTO units (name, group_id, ratio, is_base)
SELECT 'عدد', id, 1.0, 1 FROM unit_groups WHERE name = 'تعداد' LIMIT 1;
INSERT IGNORE INTO units (name, group_id, ratio, is_base)
SELECT 'جعبه', id, 12.0, 0 FROM unit_groups WHERE name = 'تعداد' LIMIT 1;
INSERT IGNORE INTO units (name, group_id, ratio, is_base)
SELECT 'کارتن', id, 120.0, 0 FROM unit_groups WHERE name = 'تعداد' LIMIT 1;

INSERT IGNORE INTO units (name, group_id, ratio, is_base)
SELECT 'کیلوگرم', id, 1.0, 1 FROM unit_groups WHERE name = 'وزن' LIMIT 1;
INSERT IGNORE INTO units (name, group_id, ratio, is_base)
SELECT 'گرم', id, 0.001, 0 FROM unit_groups WHERE name = 'وزن' LIMIT 1;

INSERT IGNORE INTO units (name, group_id, ratio, is_base)
SELECT 'متر', id, 1.0, 1 FROM unit_groups WHERE name = 'طول' LIMIT 1;
INSERT IGNORE INTO units (name, group_id, ratio, is_base)
SELECT 'سانتی‌متر', id, 0.01, 0 FROM unit_groups WHERE name = 'طول' LIMIT 1;

INSERT IGNORE INTO units (name, group_id, ratio, is_base)
SELECT 'لیتر', id, 1.0, 1 FROM unit_groups WHERE name = 'حجم' LIMIT 1;
INSERT IGNORE INTO units (name, group_id, ratio, is_base)
SELECT 'میلی‌لیتر', id, 0.001, 0 FROM unit_groups WHERE name = 'حجم' LIMIT 1;

INSERT IGNORE INTO company_settings (id, name, logo, phone, address, font) VALUES (1, 'شرکت', NULL, NULL, NULL, NULL);
