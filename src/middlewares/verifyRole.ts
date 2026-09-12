import { createMiddleware } from 'hono/factory'
import { AppError } from './errorHandler'


type TokenPayload = {
  userId: number
  user_role: string
}

type Bindings = {
  JWT_SECRET: string
}

type Variables = {
  jwtPayload: TokenPayload
}

export const verifyRole = (role: string) =>
  createMiddleware<{ Bindings: Bindings; Variables: Variables }>(async (c, next) => {
    const { user_role } = c.get('jwtPayload') as TokenPayload
    console.log(user_role)
    if (user_role !== role) {
      throw new AppError('FORBIDDEN', 'ليس لديك صلاحية لتنفيذ هذا الإجراء', 403)
    }

    await next()
  })
  export default verifyRole