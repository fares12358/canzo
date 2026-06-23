import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { withdrawSchema } from '../validation/withdrawal'
import {
    approveWithdrawal,
    createWithdrawalRequest,
    getWallet,
    rejectWithdrawal,
    WalletServiceError,
    type WithdrawalRow,
} from '../services/wallet'

type TokenPayload = {
    userId: number
    user_role: string
}

type Bindings = {
    canzo: D1Database
    CANZO_R2: R2Bucket
}

type Variables = {
    jwtPayload: TokenPayload
}

type WithdrawalWithClient = WithdrawalRow & {
    user_name: string
    phone_number: string
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_IMAGE_BYTES = 2 * 1024 * 1024

function mapWalletError(c: { json: (body: unknown, status?: number) => Response }, err: unknown) {
    if (err instanceof WalletServiceError) {
        switch (err.code) {
            case 'INSUFFICIENT_BALANCE':
                return c.json({ error: err.message }, 400)
            case 'PENDING_WITHDRAWAL_EXISTS':
                return c.json({ error: err.message }, 409)
            case 'WITHDRAWAL_NOT_FOUND':
                return c.json({ error: err.message }, 404)
            case 'WITHDRAWAL_NOT_PENDING':
                return c.json({ error: err.message }, 409)
            default:
                return c.json({ error: err.message }, 400)
        }
    }
    console.error(err)
    return c.json({ error: 'Internal server error' }, 500)
}

export const clientWithdrawRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>()

clientWithdrawRouter
    .post(
        '/withdraw',
        zValidator('json', withdrawSchema, (result, c) => {
            if (!result.success) {
                return c.json({ error: result.error.issues[0].message }, 400)
            }
        }),
        async (c) => {
            try {
                const { userId } = c.get('jwtPayload') as TokenPayload
                const { amount, wallet_number, wallet_type } = c.req.valid('json')
                const withdrawalId = await createWithdrawalRequest(
                    c.env.canzo,
                    userId,
                    amount,
                    wallet_number,
                    wallet_type
                )
                const wallet = await getWallet(c.env.canzo, userId)
                return c.json(
                    {
                        message: 'Withdrawal request created',
                        withdrawalId,
                        wallet: {
                            balance: wallet.balance,
                            pending_balance: wallet.pending_balance,
                            total: wallet.balance + wallet.pending_balance,
                        },
                    },
                    201
                )
            } catch (error) {
                return mapWalletError(c, error)
            }
        }
    )
    .get('/withdrawals', async (c) => {
        try {
            const { userId } = c.get('jwtPayload') as TokenPayload
            const withdrawals = await c.env.canzo
                .prepare(
                    `SELECT id, user_id, amount, status, admin_id, screenshot_path, wallet_number, wallet_type, created_at, updated_at
                     FROM withdrawal_requests
                     WHERE user_id = ?1
                     ORDER BY created_at DESC`
                )
                .bind(userId)
                .all<WithdrawalRow>()
            const wallet = await getWallet(c.env.canzo, userId)
            return c.json({
                withdrawals: withdrawals.results,
                wallet: {
                    balance: wallet.balance,
                    pending_balance: wallet.pending_balance,
                    total: wallet.balance + wallet.pending_balance,
                },
            })
        } catch (error) {
            return mapWalletError(c, error)
        }
    })

export const adminWithdrawRouter = new Hono<{ Bindings: Bindings; Variables: Variables }>()

adminWithdrawRouter
    .get('/withdrawals', async (c) => {
        try {
            const status = c.req.query('status')
            if (
                status &&
                status !== 'Pending' &&
                status !== 'Approved' &&
                status !== 'Rejected'
            ) {
                return c.json({ error: 'Invalid status' }, 400)
            }

            let withdrawals
            if (status) {
                withdrawals = await c.env.canzo
                    .prepare(
                        `SELECT wr.id, wr.user_id, wr.amount, wr.status, wr.admin_id,
                                wr.screenshot_path, wr.wallet_number, wr.wallet_type, wr.created_at, wr.updated_at,
                                u.user_name, u.phone_number
                         FROM withdrawal_requests wr
                         JOIN users u ON wr.user_id = u.id
                         WHERE wr.status = ?1
                         ORDER BY wr.created_at DESC`
                    )
                    .bind(status)
                    .all<WithdrawalWithClient>()
            } else {
                withdrawals = await c.env.canzo
                    .prepare(
                        `SELECT wr.id, wr.user_id, wr.amount, wr.status, wr.admin_id,
                                wr.screenshot_path, wr.wallet_number, wr.wallet_type, wr.created_at, wr.updated_at,
                                u.user_name, u.phone_number
                         FROM withdrawal_requests wr
                         JOIN users u ON wr.user_id = u.id
                         ORDER BY wr.created_at DESC`
                    )
                    .all<WithdrawalWithClient>()
            }

            return c.json({ withdrawals: withdrawals.results }, 200)
        } catch (error) {
            console.error(`error while getting withdrawals ${error}`)
            return c.json({ error: 'Internal server error' }, 500)
        }
    })
    .patch('/withdraw/:id', async (c) => {
        let fileName: string | null = null
        try {
            const { userId: adminId } = c.get('jwtPayload') as TokenPayload
            const id = Number(c.req.param('id'))
            if (isNaN(id)) {
                return c.json({ error: 'Invalid withdrawal id' }, 400)
            }

            const body = await c.req.parseBody()
            const status = body.status as string
            const image = body.screenshot as File | undefined

            if (status !== 'Approved' && status !== 'Rejected') {
                return c.json({ error: 'Invalid status' }, 400)
            }

            if (status === 'Approved') {
                if (image && image instanceof File) {
                    if (image.size > MAX_IMAGE_BYTES) {
                        return c.json({ error: 'Image size is greater than 2MB' }, 400)
                    }
                    if (!ALLOWED_IMAGE_TYPES.includes(image.type)) {
                        return c.json({ error: 'Invalid image type' }, 400)
                    }
                    fileName = `${Date.now()}-withdraw-${image.name}`
                    await c.env.CANZO_R2.put(fileName, image, {
                        httpMetadata: { contentType: image.type },
                    })
                }
                await approveWithdrawal(c.env.canzo, id, adminId, fileName)
                return c.json({ message: 'Withdrawal approved' }, 200)
            }

            await rejectWithdrawal(c.env.canzo, id, adminId)
            if (fileName) {
                await c.env.CANZO_R2.delete(fileName)
            }
            return c.json({ message: 'Withdrawal rejected' }, 200)
        } catch (error) {
            if (fileName) {
                await c.env.CANZO_R2.delete(fileName)
            }
            return mapWalletError(c, error)
        }
    })
