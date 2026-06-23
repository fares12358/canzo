import {z} from "zod"

const addBasketSchema = z.object({
    content_type: z.enum(["Plastic","Canz"]),
    content_weight: z.number().positive().max(15),
    amount: z.number().positive()
})
const arrayBasketsSchema = z.array(addBasketSchema)

const updateProfileSchema = z.object({
    username: z.string().min(3,"user name must be at least 3 characters").max(50,"user name must be at most 50 characters").optional(),
    email: z.email("invalid email address").max(300).optional(),
    phoneNumber: z.string().regex(/^01[0125][0-9]{8}$/, 'Invalid phone number').optional(),
    address: z.string().min(10, 'Address too short').max(255, 'Address too long').optional(),
    activityType: z.enum(["Wedding hall","Restaurant","Cafe","Club"], {message:"activity type must be one of the following: Wedding hall, Restaurant, Cafe, Club"}).optional(),
    activityName: z.string().max(50,"activity name is too long").min(1,"activity name is required").optional(),
})
const passwordSchema = z.object({
    oldPassword: z.string().min(8,"password must be at least 8 characters"),
    newPassword:  z.string().min(1,"password is required").min(8, 'Password must be at least 8 characters').max(72)
    .regex(/[A-Z]/, ' password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'password must contain at least one number'),
    confirmPassword: z.string().min(1,"confirm password is required"),
}).refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
})

export {arrayBasketsSchema, updateProfileSchema,passwordSchema}
