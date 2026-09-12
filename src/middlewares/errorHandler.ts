import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INSUFFICIENT_BALANCE'
  | 'PENDING_WITHDRAWAL_EXISTS'
  | 'WITHDRAWAL_NOT_FOUND'
  | 'WITHDRAWAL_NOT_PENDING'
  | 'WALLET_LOCK_FAILED'
  | 'WALLET_RELEASE_FAILED'
  | 'INVALID_AMOUNT'
  | 'TRANSACTION_CREATE_FAILED'
  | 'CLOUDINARY_UPLOAD_FAILED'
  | 'INTERNAL_SERVER_ERROR'

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode | string,
    message: string,
    public readonly statusCode: ContentfulStatusCode = 500,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export function errorHandler(error: Error, c: Context) {
  console.error('API ERROR:', error)

  if (error instanceof AppError) {
    return c.json(
      {
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      },
      error.statusCode,
    )
  }

  // Hono/JWT errors already contain the correct HTTP status.
  if (error instanceof HTTPException) {
    return c.json(
      {
        success: false,
        error: {
          code: error.status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'HTTP_ERROR',
          message: error.message,
        },
      },
      error.status,
    )
  }

  // Do not expose database, Cloudflare, or other internal details to the client.
  return c.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'حدث خطأ داخلي في الخادم',
      },
    },
    500,
  )
}
