import { z } from 'zod'

const googleLoginSchema = z.object({
    idToken: z.string().min(1, 'معرّف Google ID Token مطلوب'),
})

const setupProfileSchema = z.object({
    address: z
        .string()
        .min(1, 'العنوان مطلوب')
        .min(10, 'العنوان قصير جداً (10 أحرف على الأقل)')
        .max(255, 'العنوان طويل جداً (255 حرف على الأكثر)'),
    phoneNumber: z
        .string()
        .min(1, 'رقم الهاتف مطلوب')
        .regex(/^01[0125][0-9]{8}$/, 'رقم الهاتف غير صالح'),
    activityType: z.enum(['Wedding hall', 'Restaurant', 'Cafe', 'Club'], {
        message: 'نوع النشاط يجب أن يكون أحد الخيارات التالية: قاعة أفراح، مطعم، كافيه، أو نادي',
    }),
    activityName: z
        .string()
        .min(1, 'اسم النشاط مطلوب')
        .max(50, 'اسم النشاط طويل جداً (50 حرف على الأكثر)'),
})

export { googleLoginSchema, setupProfileSchema }