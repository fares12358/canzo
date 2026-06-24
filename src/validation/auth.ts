import {z} from "zod";

const baseSchema = z.object({
    username: z.string().min(1,"username is required").min(3,"user name must be at least 3 characters").max(50,"user name must be at most 50 characters"),
    password: z.string().min(1,"password is required").min(8, 'Password must be at least 8 characters').max(72)
    .regex(/[A-Z]/, ' password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'password must contain at least one number'),
    confirmPassword: z.string().min(1,"confirm password is required"),
    email: z.email("invalid email address").max(300),
    phoneNumber: z.string().min(1, 'phone number is required').regex(/^01[0125][0-9]{8}$/, 'Invalid phone number')
})
const refinedBaseSchema = baseSchema.refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
})
const clientSignupSchema = refinedBaseSchema.extend({
   address:z.string()
     .min(1,"address is required")
     .min(10, 'Address too short')
     .max(255, 'Address too long'),
     activityType: z.enum(["Wedding hall","Restaurant","Cafe","Club","Other"],
         {message:"activity type must be one of the following: Wedding hall, Restaurant, Cafe, Club, Other"}),
     activityName: z.string().max(50,"activity name is too long").min(1,"activity name is required"),
     customBusinessType: z.string().max(255, "Custom business type too long").optional()
 })
 .refine((data) => {
   if (data.activityType === "Other") {
     return !!data.customBusinessType && data.customBusinessType.trim().length > 0;
   }
   return true;
 }, {
   message: "Custom business type is required when 'Other' is selected",
   path: ["customBusinessType"]
 })
 .refine((data) => {
   if (data.activityType !== "Other") {
     return !data.customBusinessType;
   }
   return true;
 }, {
   message: "Custom business type should only be provided when 'Other' is selected",
   path: ["customBusinessType"]
 })
const loginSchema = z.object({
    identifier: z.string().min(1,"identifier is required").max(300)  ,
    password: z.string().min(1,"password is required").max(72)
})
const resetPasswordSchema = baseSchema.pick({
    password:true,
    confirmPassword:true,
    email:true
}).extend({
    resetToken:z.uuid("invalid reset token")
}).refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
})
const enterEmailSchema = baseSchema.pick({
    email:true
})
const enterOtpSchema = baseSchema.pick({
    email:true,
}).extend({
    otp:z.string().min(1,"otp is required").length(6,"otp must be 6 digits")
})
export {clientSignupSchema ,loginSchema,resetPasswordSchema,enterEmailSchema,enterOtpSchema}