import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { updateProfileSchema, passwordSchema } from "../validation/client";
import bcrypt from "bcryptjs";

type TokenPayload = {
    userId: number;
    user_role: string;
}

type Bindings = {
    canzo: D1Database;
    JWT_SECRET: string;
    RESEND_API_KEY: string;
    canzo_KV: KVNamespace;
}

type Variables = {
    jwtPayload: TokenPayload;
}

const profileRouter = new Hono<{ Bindings: Bindings, Variables: Variables }>()

profileRouter.get("/profile", async (c) => {
    try {
        const { userId } = c.get("jwtPayload") as TokenPayload
        const profile = await c.env.canzo.prepare(
            "SELECT u.email, u.user_name AS username, u.user_role, u.phone_number AS phoneNumber, c.address,c.activity_name as activityName,c.activity_type AS activityType FROM users u JOIN clients c ON u.id = c.user_id WHERE u.id = ?1"
        ).bind(userId).first<{ email: string, username: string, user_role: string, phoneNumber: string, address: string, activityName: string, activityType: string }>()
        return c.json({ profile ,userId})
    } catch (error) {
        console.error(`error while getting profile ${error}`)
        return c.json({ error: "Internal server error" }, 500)
    }
})
.patch("/profile", zValidator("json", updateProfileSchema, (result, c) => {
    if (!result.success) return c.json({ error: result.error.issues[0].message }, 400)
}), async (c) => {
    try {
        const { userId } = c.get("jwtPayload") as TokenPayload
        const body = c.req.valid("json")
        const allowedKeys = ["username", "email", "phoneNumber", "address", "activityType", "activityName"]
        const record = {
            username:"user_name",
            email:"email",
            phoneNumber:"phone_number",
            address:"address",
            activityType:"activity_type",
            activityName:"activity_name"
        }
        const keys = Object.keys(body).filter(key => allowedKeys.includes(key) && body[key as keyof typeof body] !== undefined)
        const table = (field: string) => {
            return field === "address" || field === "activityType" || field === "activityName" ? "clients" : "users"
        }
        if (keys.length === 0) {
            return c.json({ error: "At least one field must be provided to update profile" }, 400)
        }
        const uniqueFields = ["phoneNumber", "email"] as const;
        for (const field of uniqueFields) {
            if (body[field]) {
                const existing = await c.env.canzo
                    .prepare(`SELECT id FROM users WHERE ${record[field as keyof typeof record]} = ? AND id != ?`)
                    .bind(body[field], userId)
                    .first();
                if (existing) return c.json({ error: `${field} already in use` }, 409);
            }
        }
        const statements = keys.map(key => {
            const tablename = table(key)
            const colName = tablename === "users" ? "id" : "user_id"
            return c.env.canzo.prepare(`UPDATE ${tablename} SET ${record[key as keyof typeof record]} = ? WHERE ${colName} = ?`).bind(body[key as keyof typeof body], userId)
        })
        await c.env.canzo.batch(statements)
        return c.json({ message: "Profile updated successfully" }, 200)
    } catch (error) {
        console.error(`error while updating profile ${error}`)
        return c.json({ error: "Internal server error" }, 500)
    }
}).patch("/password", zValidator("json", passwordSchema, (result, c) => {
    if (!result.success) return c.json({ error: result.error.issues[0].message }, 400)
}), async (c) => {
    try {
        const { userId } = c.get("jwtPayload") as TokenPayload
        const body = c.req.valid("json")
        const user = await c.env.canzo.prepare("SELECT password_hash FROM users WHERE id = ?1").bind(userId).first<{ password_hash: string }>()
        if (!user) return c.json({ error: "User not found" }, 404)
        const isPasswordValid = await bcrypt.compare(body.oldPassword, user.password_hash)
        if (!isPasswordValid) return c.json({ error: "Invalid password" }, 401)
        const password_hash = await bcrypt.hash(body.newPassword, 10)
        await c.env.canzo.prepare("UPDATE users SET password_hash = ?1, updated_at = datetime('now') WHERE id = ?2").bind(password_hash, userId).run()
        return c.json({ message: "Password updated successfully" }, 200)
    } catch (error) {
        console.error(`error while updating password ${error}`)
        return c.json({ error: "Internal server error" }, 500)
    }
})

export default profileRouter;
