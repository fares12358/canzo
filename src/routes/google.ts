import { Hono } from "hono";
import { sign } from "hono/jwt";
import { zValidator } from "@hono/zod-validator";
import { setupProfileSchema,googleLoginSchema } from "../validation/google";
type Bindings = {
    GOOGLE_CLIENT_ID: string;
    DB: D1Database
    JWT_SECRET: string
}
type User = {
    id: number
    user_name: string
    phone_number: string
    email: string
    password_hash: string
    user_role: "Client" | "Admin"
}
type Client = {
    id: number
    user_id: number
    address: string
    activity_type: string
    activity_name: string
}
const googleRouter = new Hono<{Bindings:Bindings,Variables:User}>();
googleRouter.post("/setup-profile",
    zValidator("json",setupProfileSchema,(result,c)=>{
        if(!result.success){
            return c.json({error:result.error.issues[0].message},400)
        }
    }),async(c)=>{
    try {
        type TokenPayload = {
    userId: number
    user_role: string
}
        const {userId} = c.get("jwtPayload") as TokenPayload
        const {address,activityType,activityName,phoneNumber} = c.req.valid("json")
        const user = await c.env.DB.prepare("SELECT phone_number FROM users WHERE id = ?1").bind(userId).first<User>();
        const checkPhoneNumber = await c.env.DB.prepare("SELECT * FROM users WHERE phone_number = ?1").bind(phoneNumber).first<User>();
        if(user?.phone_number !== null){
            return c.json({error:"تم إعداد الملف الشخصي من قبل"},400)
        }
        if(checkPhoneNumber){
            return c.json({error:"رقم الهاتف مسجل بالفعل"},400)
        }
        const client = await c.env.DB.prepare("SELECT user_id FROM clients WHERE user_id = ?1").bind(userId).first<Client>();
        if(client?.user_id !== null){
            return c.json({error:"العميل موجود بالفعل"},400)
        }
        await c.env.DB.batch([
            c.env.DB.prepare("UPDATE users SET phone_number = ?1 WHERE id = ?2").bind(phoneNumber,userId),
            c.env.DB.prepare("INSERT INTO clients (user_id,address,activity_type,activity_name) VALUES (?, ?, ?,?)")
            .bind(userId,address,activityType,activityName)
        ]);
        return c.json({message:"تم إعداد الملف الشخصي بنجاح"})
    } catch (error) {
        console.error(`error while setting up profile ${error}`)
        throw error
    }
});
export default googleRouter;