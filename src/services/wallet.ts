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

import { AppError } from '../middlewares/errorHandler'

export class WalletServiceError extends AppError {
    constructor(
        code:
            | 'INSUFFICIENT_BALANCE'
            | 'PENDING_WITHDRAWAL_EXISTS'
            | 'WITHDRAWAL_NOT_FOUND'
            | 'WITHDRAWAL_NOT_PENDING'
            | 'WALLET_LOCK_FAILED'
            | 'WALLET_RELEASE_FAILED'
            | 'WALLET_NOT_FOUND'
            | 'INVALID_AMOUNT'
            | 'TRANSACTION_CREATE_FAILED',
        message: string
    ) {
        const statusMap: Record<WalletServiceError['code'], 400 | 404 | 409 | 500> = {
            INSUFFICIENT_BALANCE: 400,
            PENDING_WITHDRAWAL_EXISTS: 409,
            WITHDRAWAL_NOT_FOUND: 404,
            WITHDRAWAL_NOT_PENDING: 409,
            WALLET_LOCK_FAILED: 500,
            WALLET_RELEASE_FAILED: 500,
            // Added dedicated mappings for missing wallets and invalid amounts.
            WALLET_NOT_FOUND: 404,
            INVALID_AMOUNT: 400,
            TRANSACTION_CREATE_FAILED: 500,
        }
        super(code, message, statusMap[code])
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
        throw new WalletServiceError('WALLET_NOT_FOUND', 'المحفظة غير موجودة')
    }
    return wallet
}

export async function creditWallet(
    db: D1Database,
    userId: number,
    amount: number
): Promise<void> {
    if (amount <= 0) {
        throw new WalletServiceError('INVALID_AMOUNT', 'المبلغ يجب أن يكون أكبر من الصفر')
    }
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
        throw new WalletServiceError('WALLET_LOCK_FAILED', 'فشل تحديث رصيد المحفظة')
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
        //Invalid amount gets its own 400 error code.
        throw new WalletServiceError('INVALID_AMOUNT', 'المبلغ يجب أن يكون أكبر من الصفر')
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
            'يوجد طلب سحب قيد المراجعة بالفعل'
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
        throw new WalletServiceError('INSUFFICIENT_BALANCE', 'الرصيد غير كافي للسحب')
    }

    const clientInfo = await db.prepare('SELECT activity_name FROM clients WHERE user_id = ?1')
        .bind(userId).first<{ activity_name: string }>()

    const clientName = clientInfo?.activity_name || `user ${userId}`

    const adminMessage = `طلب سحب جديد من ${clientName} بمبلغ ${amount} :ج. م ,نوع المحفظة ${walletType} رقم المحفظة :${walletNumber}`

    let withdrawalId: number | null = null

    try {
        const insert = await db
            .prepare(
                `INSERT INTO withdrawal_requests (user_id, amount, status, wallet_number, wallet_type)
                 VALUES (?1, ?2, 'Pending', ?3, ?4)`
            )
            .bind(userId, amount, walletNumber, walletType)
            .run()

        withdrawalId = Number(insert.meta.last_row_id)
        if (!withdrawalId) {
            throw new WalletServiceError('WALLET_LOCK_FAILED', 'فشل إنشاء طلب السحب')
        }

        //  If notification creation fails, the catch removes the withdrawal and restores the wallet.
        const notificationResult = await db
            .prepare(
                `INSERT INTO notifications (recipient_id, recipient_type, message)
                 SELECT id, 'Admin', ?1 FROM users WHERE user_role = 'Admin'`
            )
            .bind(adminMessage)
            .run()
            console.log(`Admin withdrawal notifications created : ${notificationResult.meta.changes}`)

        return withdrawalId
    } catch (error) {
     console.error('create withdrawal error :', error)
     if (error instanceof Error){
     console.error('error message:', error.message)
          console.error('error stack:', error.stack)

     }

         try {
            await db.batch([
                db.prepare(
                    `DELETE FROM withdrawal_requests
                     WHERE id = ?1`
                ).bind(withdrawalId ?? -1),
                db.prepare(
                    `UPDATE wallets
                     SET balance = balance + ?1,
                         pending_balance = pending_balance - ?1,
                         updated_at = datetime('now')
                     WHERE user_id = ?2`
                ).bind(amount, userId),
            ])
        } catch (rollbackError) {
            // Log failed financial compensation as critical.
            console.error('CRITICAL: failed to restore wallet after withdrawal creation error:', rollbackError)
        }
        throw error
    }
}
/**
 * APPROVE WITHDRAWAL Flow:
 * Pending
 *   ↓
 * Atomically claim as Approved
 *   ↓
 * Decrease pending_balance
 *   ↓
 * Create Approved transaction
 *   ↓
 * Send notification
 */
export async function approveWithdrawal(
    db: D1Database,
    withdrawalId: number,
    adminId: number,
    screenshotPath: string | null
): Promise<void> {

    const withdrawal = await db
        .prepare(
            `SELECT id, user_id, amount, status
             FROM withdrawal_requests
             WHERE id = ?1`
        )
        .bind(withdrawalId)
        .first<WithdrawalRow>()
if (!withdrawal) {
        throw new WalletServiceError(
            'WITHDRAWAL_NOT_FOUND',
            'طلب السحب غير موجود'
        )
    }

    if (withdrawal.status !== 'Pending') {
        throw new WalletServiceError(
            'WITHDRAWAL_NOT_PENDING',
           ` لا يمكن الموافقة على طلب السحب لأنه ${
                withdrawal.status === 'Approved'
                    ? 'تمت الموافقة عليه بالفعل'
                    : 'تم رفضه بالفعل'
            }`
        )}
   /*
     * We no longer update the withdrawal and wallet in the same batch.
     * First we atomically claim the withdrawal:
     * Pending -> Approved
     * The "AND status = Pending" prevents another request
     * from approving/rejecting the same withdrawal.
     */
    const claim = await db
        .prepare(
            `UPDATE withdrawal_requests
             SET status = 'Approved',
                 admin_id = ?1,
                 screenshot_path = ?2,
                 updated_at = datetime('now')
             WHERE id = ?3
             AND status = 'Pending'`
        )
        .bind(
            adminId, screenshotPath, withdrawalId
        )
        .run()

    if (claim.meta.changes === 0) {
        // Another request processed this withdrawal between
        // the SELECT and UPDATE.
        throw new WalletServiceError(
            'WITHDRAWAL_NOT_PENDING',
            'طلب السحب تم التعامل معه بالفعل بواسطة عملية أخرى'
        )
    }


    try {
        /*
         * Only after successfully claiming the withdrawal,
         * update the wallet.
         */
        const walletUpdate = await db
            .prepare(
                `UPDATE wallets
                 SET pending_balance = pending_balance - ?1,
                     updated_at = datetime('now')
                 WHERE user_id = ?2
                 AND pending_balance >= ?1`
            )
            .bind(
                withdrawal.amount, withdrawal.user_id
            )
            .run()
        if (walletUpdate.meta.changes === 0) {
            // Clear message explaining that the wallet could not
            // release the pending amount.
            throw new WalletServiceError(
                'WALLET_RELEASE_FAILED',
                'فشل إنهاء عملية السحب: الرصيد المعلّق غير كافٍ أو المحفظة غير موجودة'
            )
        }
        try {
            /*
             * Create the financial transaction only after:
             * 1. Withdrawal is Approved
             * 2. pending_balance is decreased
             */
            await db
                .prepare(
                    `INSERT INTO transactions (
                        client_id,  admin_id, amount, status,
                        screenshot_path, note, approved_at
                    )
                    VALUES (
                        ?1,
                        ?2,
                        ?3,
                        'Approved',
                        ?4,
                        'withdrawal',
                        datetime('now')
                    )`
                )
                .bind(
                    withdrawal.user_id, adminId,
                    -Math.abs(withdrawal.amount),
                    screenshotPath
                )
                .run()

        } catch (transactionError) {

            /*
             * If the transaction cannot be created,
             * restore pending_balance.
             * We don't want:
             * withdrawal = Approved
             * pending_balance = decreased
             * transaction = missing
             */
            try {

                await db
                    .prepare(
                        `UPDATE wallets
                         SET pending_balance = pending_balance + ?1,
                             updated_at = datetime('now')
                         WHERE user_id = ?2`
                    )
                    .bind(
                        withdrawal.amount,
                        withdrawal.user_id
                    )
                    .run()

            } catch (rollbackWalletError) {
                // Critical financial consistency error.
                console.error(
                    'CRITICAL: failed to restore pending wallet balance after approval transaction error:',
                    rollbackWalletError
                )
            }
            // Return a specific error instead of hiding the transaction failure.
            throw new WalletServiceError(
                'TRANSACTION_CREATE_FAILED',
                'فشل تسجيل المعاملة المالية الخاصة بعملية السحب'
            )
        }

    } catch (error) {

        /*
         * If anything in the financial part fails,
         * restore the withdrawal back to Pending.
         * This prevents an Approved request from remaining Approved
         * when the financial operation did not finish correctly.
         */
        try {

            await db
                .prepare(
                   ` UPDATE withdrawal_requests
                     SET status = 'Pending',
                         admin_id = NULL,
                         screenshot_path = NULL,
                         updated_at = datetime('now')
                     WHERE id = ?1
                     AND status = 'Approved'
                     AND admin_id = ?2`
                )
                .bind(
                    withdrawalId,
                    adminId
                )
                .run()

        } catch (rollbackStatusError) {

            console.error(
                'CRITICAL: failed to restore withdrawal status after approval error:',
                rollbackStatusError
            )
        }

        throw error
    }


    /*
     * Notification is NOT part of the financial operation.
     * We don't return 500 because the actual withdrawal succeeded.
     */

    try {

        await db
            .prepare(
               ` INSERT INTO notifications
                (recipient_id, recipient_type, message)
                 VALUES (?1, 'Client', ?2)`
            )
            .bind(
                withdrawal.user_id,
               ` تمت الموافقة على عملية السحب رقم #${withdrawalId}`
            )
            .run()

    } catch (notificationError) {
        // Notification failure is logged but does not undo a successful payment.
        console.error(
            'Withdrawal approval notification failed:',
            notificationError
        )
    }
}
/**
 * REJECT WITHDRAWAL Flow:
 * Pending
 *   ↓
 * Atomically claim as Rejected
 *   ↓
 * Return amount to balance
 *   ↓
 * Decrease pending_balance
 *   ↓
 * Send notification
 * NO transaction is created here because the money was NOT paid out.
 */
export async function rejectWithdrawal(
    db: D1Database,
    withdrawalId: number,
    adminId: number
): Promise<void> {
const withdrawal = await db
        .prepare(
            `SELECT id, user_id, amount, status
             FROM withdrawal_requests
             WHERE id = ?1`
        )
        .bind(withdrawalId)
        .first<WithdrawalRow>()
    if (!withdrawal) {
        throw new WalletServiceError(
            'WITHDRAWAL_NOT_FOUND',
            'طلب السحب غير موجود'
        )
    }
    if (withdrawal.status !== 'Pending') {
        throw new WalletServiceError(
            'WITHDRAWAL_NOT_PENDING',
          `  لا يمكن رفض طلب السحب لأنه ${
                withdrawal.status === 'Approved'
                    ? 'تمت الموافقة عليه بالفعل'
                    : 'تم رفضه بالفعل'
            }`
        )
    }

    /*
     * IMPORTANT CHANGE:
     * Claim the withdrawal first:
     * Pending -> Rejected
     * The condition "status = Pending" makes this atomic.
     */
    const claim = await db
        .prepare(
            `UPDATE withdrawal_requests
             SET status = 'Rejected',
                 admin_id = ?1,
                 updated_at = datetime('now')
             WHERE id = ?2
             AND status = 'Pending'`
        )
        .bind(
            adminId,
            withdrawalId
        )
        .run()
    if (claim.meta.changes === 0) {
        // Another request has already processed the withdrawal.
        throw new WalletServiceError(
            'WITHDRAWAL_NOT_PENDING',
            'طلب السحب تم التعامل معه بالفعل بواسطة عملية أخرى'
        )
    }


    try {
        /*
         * Only after the request is successfully marked Rejected,
         * return the reserved money to the client's balance.
         */

        const walletUpdate = await db
            .prepare(
                `UPDATE wallets
                 SET balance = balance + ?1,
                     pending_balance = pending_balance - ?1,
                     updated_at = datetime('now')
                 WHERE user_id = ?2
                 AND pending_balance >= ?1`
            )
            .bind(
                withdrawal.amount,
                withdrawal.user_id
            )
            .run()

        if (walletUpdate.meta.changes === 0) {
            // Clear message showing exactly why the refund failed.
            throw new WalletServiceError(
                'WALLET_RELEASE_FAILED',
                'فشل إعادة المبلغ إلى المحفظة: الرصيد المعلّق غير كافٍ أو المحفظة غير موجودة'
            )
        }
    } catch (error) {

        /*
         * If the refund fails, don't leave:
         * withdrawal = Rejected
         * money = still locked
         * Instead return the request to Pending.
         */
        try {

            await db
                .prepare(
                    `UPDATE withdrawal_requests
                     SET status = 'Pending',
                         admin_id = NULL,
                         updated_at = datetime('now')
                     WHERE id = ?1
                     AND status = 'Rejected'
                     AND admin_id = ?2`
                )
                .bind(
                    withdrawalId,
                    adminId
                )
                .run()
        } catch (rollbackStatusError) {

            console.error(
                'CRITICAL: failed to restore withdrawal status after rejection error:',
                rollbackStatusError
            )
        }

        throw error
    }
    /*
     * Reject does NOT create a transaction.
     * The money was never paid out.
     * It was only moved:
     * pending_balance -> balance
     */
    try {
await db
            .prepare(
                `INSERT INTO notifications
                 (recipient_id, recipient_type, message)
                 VALUES (?1, 'Client', ?2)`
            )
            .bind(
                withdrawal.user_id,
               ` تم رفض عملية السحب رقم #${withdrawalId}`
            )
            .run()

    } catch (notificationError) {
        // Notification failure must not turn a successful rejection/refund into 500.
        console.error(
            'Withdrawal rejection notification failed:', notificationError     )
    }
}
  