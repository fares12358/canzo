export type WalletRow = {
    user_id: number
    balance: number
    pending_balance: number
}

export type WithdrawalRow = {
    id: number
    user_id: number
    amount: number
    status: 'Pending' | 'Approved' | 'Rejected'
    admin_id: number | null
    screenshot_path: string | null
    wallet_number: string | null
    wallet_type: string | null
    created_at: string
    updated_at: string
}

export class WalletServiceError extends Error {
    constructor(
        public readonly code:
            | 'INSUFFICIENT_BALANCE'
            | 'PENDING_WITHDRAWAL_EXISTS'
            | 'WITHDRAWAL_NOT_FOUND'
            | 'WITHDRAWAL_NOT_PENDING'
            | 'WALLET_LOCK_FAILED'
            | 'WALLET_RELEASE_FAILED',
        message: string
    ) {
        super(message)
        this.name = 'WalletServiceError'
    }
}

export async function ensureWallet(db: D1Database, userId: number): Promise<void> {
    await db
        .prepare(
            'INSERT OR IGNORE INTO wallets (user_id, balance, pending_balance) VALUES (?1, 0, 0)'
        )
        .bind(userId)
        .run()
}

export async function getWallet(db: D1Database, userId: number): Promise<WalletRow> {
    await ensureWallet(db, userId)
    const wallet = await db
        .prepare(
            'SELECT user_id, balance, pending_balance FROM wallets WHERE user_id = ?1'
        )
        .bind(userId)
        .first<WalletRow>()
    if (!wallet) {
        throw new WalletServiceError('WALLET_LOCK_FAILED', 'Wallet not found')
    }
    return wallet
}

export async function creditWallet(
    db: D1Database,
    userId: number,
    amount: number
): Promise<void> {
    if (amount <= 0) return
    await ensureWallet(db, userId)
    const result = await db
        .prepare(
            `UPDATE wallets
             SET balance = balance + ?1, updated_at = datetime('now')
             WHERE user_id = ?2`
        )
        .bind(amount, userId)
        .run()
    if (result.meta.changes === 0) {
        throw new WalletServiceError('WALLET_LOCK_FAILED', 'Failed to credit wallet')
    }
}

export async function createWithdrawalRequest(
    db: D1Database,
    userId: number,
    amount: number,
    walletNumber: string,
    walletType: string
): Promise<number> {
    if (amount <= 0) {
        throw new WalletServiceError('INSUFFICIENT_BALANCE', 'Invalid amount')
    }

    await ensureWallet(db, userId)

    const pending = await db
        .prepare(
            `SELECT id FROM withdrawal_requests
             WHERE user_id = ?1 AND status = 'Pending'
             LIMIT 1`
        )
        .bind(userId)
        .first<{ id: number }>()

    if (pending) {
        throw new WalletServiceError(
            'PENDING_WITHDRAWAL_EXISTS',
            'A pending withdrawal already exists'
        )
    }

    const lock = await db
        .prepare(
            `UPDATE wallets
             SET balance = balance - ?1,
                 pending_balance = pending_balance + ?2,
                 updated_at = datetime('now')
             WHERE user_id = ?3 AND balance >= ?4`
        )
        .bind(amount, amount, userId, amount)
        .run()

    if (lock.meta.changes === 0) {
        throw new WalletServiceError('INSUFFICIENT_BALANCE', 'Insufficient balance')
    }

    const insert = await db
        .prepare(
            `INSERT INTO withdrawal_requests (user_id, amount, status, wallet_number, wallet_type)
             VALUES (?1, ?2, 'Pending', ?3, ?4)`
        )
        .bind(userId, amount, walletNumber, walletType)
        .run()

    const withdrawalId = insert.meta.last_row_id
    if (!withdrawalId) {
        await db
            .prepare(
                `UPDATE wallets
                 SET balance = balance + ?1,
                     pending_balance = pending_balance - ?1,
                     updated_at = datetime('now')
                 WHERE user_id = ?2`
            )
            .bind(amount, userId)
            .run()
        throw new WalletServiceError('WALLET_LOCK_FAILED', 'Failed to create withdrawal')
    }

    return Number(withdrawalId)
}

export async function approveWithdrawal(
    db: D1Database,
    withdrawalId: number,
    adminId: number,
    screenshotPath: string | null
): Promise<void> {
    const withdrawal = await db
        .prepare(
            `SELECT id, user_id, amount, status
             FROM withdrawal_requests WHERE id = ?1`
        )
        .bind(withdrawalId)
        .first<WithdrawalRow>()

    if (!withdrawal) {
        throw new WalletServiceError('WITHDRAWAL_NOT_FOUND', 'Withdrawal not found')
    }
    if (withdrawal.status !== 'Pending') {
        throw new WalletServiceError('WITHDRAWAL_NOT_PENDING', 'Withdrawal is not pending')
    }

    const results = await db.batch([
        db
            .prepare(
                `UPDATE withdrawal_requests
                 SET status = 'Approved',
                     admin_id = ?1,
                     screenshot_path = ?2,
                     updated_at = datetime('now')
                 WHERE id = ?3 AND status = 'Pending'`
            )
            .bind(adminId, screenshotPath, withdrawalId),
        db
            .prepare(
                `UPDATE wallets
                 SET pending_balance = pending_balance - ?1,
                     updated_at = datetime('now')
                 WHERE user_id = ?2 AND pending_balance >= ?1`
            )
            .bind(withdrawal.amount, withdrawal.user_id),
        db
            .prepare(
                `INSERT INTO transactions (
                    client_id, admin_id, amount, status, screenshot_path, note, approved_at
                 ) VALUES (?1, ?2, ?3, 'Approved', ?4, 'withdrawal', datetime('now'))`
            )
            .bind(
                withdrawal.user_id,
                adminId,
                -Math.abs(withdrawal.amount),
                screenshotPath
            ),
    ])

    if (results[0].meta.changes === 0) {
        throw new WalletServiceError('WITHDRAWAL_NOT_PENDING', 'Withdrawal is not pending')
    }
    if (results[1].meta.changes === 0) {
        throw new WalletServiceError('WALLET_RELEASE_FAILED', 'Failed to finalize withdrawal')
    }
}

export async function rejectWithdrawal(
    db: D1Database,
    withdrawalId: number,
    adminId: number
): Promise<void> {
    const withdrawal = await db
        .prepare(
            `SELECT id, user_id, amount, status
             FROM withdrawal_requests WHERE id = ?1`
        )
        .bind(withdrawalId)
        .first<WithdrawalRow>()

    if (!withdrawal) {
        throw new WalletServiceError('WITHDRAWAL_NOT_FOUND', 'Withdrawal not found')
    }
    if (withdrawal.status !== 'Pending') {
        throw new WalletServiceError('WITHDRAWAL_NOT_PENDING', 'Withdrawal is not pending')
    }

    const results = await db.batch([
        db
            .prepare(
                `UPDATE withdrawal_requests
                 SET status = 'Rejected',
                     admin_id = ?1,
                     updated_at = datetime('now')
                 WHERE id = ?2 AND status = 'Pending'`
            )
            .bind(adminId, withdrawalId),
        db
            .prepare(
                `UPDATE wallets
                 SET balance = balance + ?1,
                     pending_balance = pending_balance - ?1,
                     updated_at = datetime('now')
                 WHERE user_id = ?2 AND pending_balance >= ?1`
            )
            .bind(withdrawal.amount, withdrawal.user_id),
    ])

    if (results[0].meta.changes === 0) {
        throw new WalletServiceError('WITHDRAWAL_NOT_PENDING', 'Withdrawal is not pending')
    }
    if (results[1].meta.changes === 0) {
        throw new WalletServiceError('WALLET_RELEASE_FAILED', 'Failed to release funds')
    }
}
