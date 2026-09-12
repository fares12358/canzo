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
    DB: D1Database
    CLOUDINARY_CLOUD_NAME: string
    CLOUDINARY_API_KEY: string
    CLOUDINARY_API_SECRET: string
}

type Variables = {
    jwtPayload: TokenPayload
}

type WithdrawalWithClient = WithdrawalRow & {
    user_name: string
    phone_number: string
    activity_name: string
    screenshot_url: string | null
}

type ClientWithdrawalRow = WithdrawalRow & {
    screenshot_url: string | null
}

const ALLOWED_IMAGE_TYPES = ['image/jpg','image/jpeg', 'image/png', 'image/webp']
const MAX_IMAGE_BYTES = 2 * 1024 * 1024

// async function generateSignature(
//     paramsToSign: string,
//     apiSecret: string
// ): Promise<string> {
//     const encoder = new TextEncoder()

//     const data = encoder.encode(paramsToSign + apiSecret)

//     const hashBuffer = await crypto.subtle.digest('SHA-1', data)

//     const hashArray = Array.from(new Uint8Array(hashBuffer))

//     return hashArray
//         .map((b) => b.toString(16).padStart(2, '0'))
//         .join('')
// }

// async function uploadToCloudinary(
//     file: File,
//     cloudName: string,
//     apiKey: string,
//     apiSecret: string
// ): Promise<string> {

//     // CHANGE: Make sure Cloudinary variables actually exist.
//     if (!cloudName || !apiKey || !apiSecret) {
//         console.error('CLOUDINARY CONFIG ERROR:', {
//             cloudNameExists: !!cloudName,
//             apiKeyExists: !!apiKey,
//             apiSecretExists: !!apiSecret,
//         })

//         throw new Error('إعدادات Cloudinary غير مكتملة')
//     }

//     const timestamp = Math.floor(Date.now() / 1000).toString()
//     const stringTosign=`timestamp=${timestamp}`

   

//     const signature = await generateSignature(
//        // `timestamp=${timestamp}`,
//        stringTosign,
//         apiSecret
//     )

//     console.log('CLOUDINARY DEBUG:', {
//         timestamp,
//         stringTosign,
//         signature,
//         cloudName,
//         apiSecretLength: apiSecret.length,
//         apiKeyExists: !!apiKey,
//         apiSecretExists: !!apiSecret,
//     })

//     const formData = new FormData()

//     formData.append('file', file)
//     formData.append('api_key', apiKey)
//     formData.append('timestamp', timestamp)
//     formData.append('signature', signature)

//     const response = await fetch(
//         `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
//         {
//             method: 'POST',
//             body: formData,
//         }
//     )

//     const responseText = await response.text()

//     if (!response.ok) {
//         console.error('CLOUDINARY UPLOAD ERROR:', {
//             status: response.status,
//             response: responseText,
//         })

//         throw new Error('فشل رفع الصورة إلى Cloudinary')
//     }

//     const data = JSON.parse(responseText) as {
//         secure_url?: string
//     }

//     if (!data.secure_url) {
//         console.error(
//             'CLOUDINARY ERROR: secure_url missing',
//             responseText
//         )

//         throw new Error('لم يتم الحصول على رابط الصورة من Cloudinary')
//     }

//     return data.secure_url
// }
async function uploadToCloudinary(
    file: File,
    cloudName: string,
    apiKey: string,
    apiSecret: string
): Promise<string> {

    // CHANGE: Validate Cloudinary configuration.
    if (!cloudName  || !apiKey || !apiSecret) {
        console.error('CLOUDINARY CONFIG ERROR:', {
            cloudNameExists: !!cloudName,
            apiKeyExists: !!apiKey,
            apiSecretExists: !!apiSecret,
        })

        throw new Error('إعدادات Cloudinary غير مكتملة')
    }

    // CHANGE: Use Cloudinary Basic Authentication instead of a signed request.
    const credentials = btoa(`${apiKey}:${apiSecret}`)

    const formData = new FormData()
    formData.append('file', file)
    console.log('cloudinary config debbud:',{
        cloudName, apiKey,
    })

    const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        {
            method: 'POST',
            headers: {
                // CHANGE: Authenticate using API Key + API Secret.
                Authorization: `Basic ${credentials}`,
            },
            body: formData,
        }
    )

    const responseText = await response.text()

    if (!response.ok) {
        console.error('CLOUDINARY UPLOAD ERROR:', {
            status: response.status,
            response: responseText,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
        })

        throw new Error('فشل رفع الصورة إلى Cloudinary')
    }

    const data = JSON.parse(responseText) as {
        secure_url?: string
    }

    if (!data.secure_url) {
        console.error(
            'CLOUDINARY ERROR: secure_url missing',
            responseText
        )

        throw new Error('لم يتم الحصول على رابط الصورة من Cloudinary')
    }

    return data.secure_url
}

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
    return c.json({ error: 'حدث خطأ في الخادم' }, 500)
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
                    c.env.DB,
                    userId,
                    amount,
                    wallet_number,
                    wallet_type
                )
                const wallet = await getWallet(c.env.DB, userId)
                return c.json(
                    {
                        message: 'تم طلب عملية السحب بنجاح',
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
                console.log("withdral error : ", error)
                 throw error

            }
        }
    )
    .get('/withdrawals', async (c) => {
        try {
            const { userId } = c.get('jwtPayload') as TokenPayload
            const withdrawals = await c.env.DB
                .prepare(
                    `SELECT id, user_id, amount, status, admin_id, screenshot_path,
                     screenshot_path AS screenshot_url, wallet_number, wallet_type, created_at, updated_at
                     FROM withdrawal_requests
                     WHERE user_id = ?1
                     ORDER BY created_at DESC`
                )
                .bind(userId)
                .all<ClientWithdrawalRow>()
            const wallet = await getWallet(c.env.DB, userId)
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
                return c.json({ error: 'حالة الطلب غير صحيحة' }, 400)
            }

            let withdrawals
            if (status) {
                withdrawals = await c.env.DB
                    .prepare(
                        `SELECT wr.id, wr.user_id, wr.amount, wr.status, wr.admin_id,
                                wr.screenshot_path, wr.screenshot_path AS screenshot_url, 
                                wr.wallet_number, wr.wallet_type, wr.created_at, wr.updated_at,
                                u.user_name, u.phone_number
                         FROM withdrawal_requests wr
                         JOIN users u ON wr.user_id = u.id
                         WHERE wr.status = ?1
                         ORDER BY wr.created_at DESC`
                    )
                    .bind(status)
                    .all<WithdrawalWithClient>()
            } else {
                withdrawals = await c.env.DB
                    .prepare(
                        `SELECT wr.id, wr.user_id, wr.amount, wr.status, wr.admin_id,
                                wr.screenshot_path, wr.screenshot_path AS screenshot_url,
                                wr.wallet_number, wr.wallet_type, wr.created_at, wr.updated_at,
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
        throw error
        }
    })
    .patch('/withdraw/:id', async (c) => {
        try {
            const { userId: adminId } = c.get('jwtPayload') as TokenPayload
            const id = Number(c.req.param('id'))
            if (isNaN(id)) {
                return c.json({ error: 'معرّف طلب السحب غير صالح' }, 400)
            }

            const body = await c.req.parseBody()
            const status = body.status as string
            const image = body.screenshot as File | undefined

            if (status !== 'Approved' && status !== 'Rejected') {
                return c.json({ error: 'حالة الطلب غير صالحة' }, 400)
            }

            if (status === 'Approved') {
                let imageUrl: string | null = null
                if (image && image instanceof File) {
                    if (image.size > MAX_IMAGE_BYTES) {
                        return c.json({ error: 'حجم الصورة أكبر من 2 ميجا' }, 400)
                    }
                    const imageType= image.type.toLocaleLowerCase().trim()
                    const fileName= image.name.toLocaleLowerCase()
                    const isValidType =ALLOWED_IMAGE_TYPES.includes(imageType) || 
                    fileName.endsWith('.png') ||
                    fileName.endsWith('.jpg') ||
                    fileName.endsWith('.jpeg') ||
                    fileName.endsWith('.webp') ;

                    if (!isValidType) {
                        console.error(
                            'Invalid withdrwal screenShot :',
                            {
                                name: image.name,
                                type: image.type,
                                size : image.size,
                            }
                        )
                        return c.json(
                            { error :' نوع الصورة غير صالح , المسموح png , jpg , jpeg , webp'}, 400
                        );
                    }
                    imageUrl = await uploadToCloudinary(
                        image,
                        c.env.CLOUDINARY_CLOUD_NAME,
                        c.env.CLOUDINARY_API_KEY,
                        c.env.CLOUDINARY_API_SECRET
                    )
                }
                await approveWithdrawal(c.env.DB, id, adminId, imageUrl)
                return c.json({ message: 'تم الموافقة على عملية السحب' }, 200)
            }

            await rejectWithdrawal(c.env.DB, id, adminId)
            return c.json({ message: 'تم رفض عملية السحب' }, 200)
        } catch (error) {
            return mapWalletError(c, error)
        }
    })