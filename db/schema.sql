CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id TEXT UNIQUE,
    email TEXT NOT NULL UNIQUE,
    user_name TEXT NOT NULL ,
    phone_number TEXT UNIQUE,
    password_hash TEXT ,
    user_role TEXT NOT NULL CHECK(user_role IN ('Client','Admin')),
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now')),
    fcm_token TEXT
);

CREATE TABLE IF NOT EXISTS clients (
    user_id INTEGER PRIMARY KEY,
    address TEXT NOT NULL,
    activity_type TEXT NOT NULL CHECK(length(trim(activity_type)) > 0),
    activity_name TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS baskets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_type TEXT NOT NULL CHECK (content_type IN ('Plastic','Canz')),
    content_weight REAL NOT NULL,
    order_id INTEGER,
    client_id INTEGER NOT NULL,
    is_full BOOLEAN NOT NULL DEFAULT 0,
    price REAL NOT NULL,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
 
    client_id INTEGER NOT NULL,
    admin_id INTEGER,
 
    amount REAL NOT NULL,
 
    status TEXT NOT NULL DEFAULT 'Pending'
        CHECK(status IN ('Pending','Approved','Rejected')),
 
    screenshot_path TEXT,
 
    note TEXT,
 
    approved_at DATETIME,
 
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now')),
 
    FOREIGN KEY(client_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(admin_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS orders (
id INTEGER PRIMARY KEY AUTOINCREMENT,
client_id INTEGER NOT NULL,
status TEXT NOT NULL CHECK(status IN ('Pending', 'Completed', 'Cancelled')),
price REAL NOT NULL,
created_at DATETIME DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wallets (
    user_id INTEGER PRIMARY KEY,
    balance REAL NOT NULL DEFAULT 0 CHECK(balance >= 0),
    pending_balance REAL NOT NULL DEFAULT 0 CHECK(pending_balance >= 0),
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS withdrawal_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    status TEXT NOT NULL DEFAULT 'Pending'
        CHECK(status IN ('Pending','Approved','Rejected')),
    admin_id INTEGER,
    screenshot_path TEXT,
    wallet_number TEXT,
    wallet_type TEXT CHECK(wallet_type IN (
        'Vodafone Cash',
        'Orange Cash',
        'Etisalat Cash',
        'InstaPay'
    )),
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_status
    ON withdrawal_requests(user_id, status);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status
    ON withdrawal_requests(status);

CREATE TABLE IF NOT EXISTS sold (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    content_type TEXT NOT NULL CHECK (content_type IN ('Plastic','Canz')),
    content_weight REAL NOT NULL,
    total_price REAL NOT NULL,
    created_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pricing (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    material TEXT NOT NULL CHECK (material IN ('Plastic', 'Canz')),
    activity_type TEXT NOT NULL CHECK (activity_type IN ('Wedding hall', 'Cafe', 'Club', 'Restaurant')),
    price_per_kg REAL NOT NULL,
    UNIQUE (material, activity_type)
);

CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_id INTEGER NOT NULL,
    recipient_type TEXT NOT NULL CHECK(recipient_type IN ('Admin', 'Client')),
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_id, recipient_type);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(recipient_id, recipient_type, is_read) WHERE is_read = 0;