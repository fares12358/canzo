ALTER TABLE wallets ADD COLUMN pending_balance REAL NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS withdrawal_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    status TEXT NOT NULL DEFAULT 'Pending'
        CHECK(status IN ('Pending','Approved','Rejected')),
    admin_id INTEGER,
    screenshot_path TEXT,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_status
    ON withdrawal_requests(user_id, status);

CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status
    ON withdrawal_requests(status);
