import { z } from 'zod'

const addBasketSchema = z.object({
    content_type: z.enum(['Plastic', 'Canz'], {
        message: 'نوع المحتوى يجب أن يكون Plastic أو Canz',
    }),
    content_weight: z
        .number({ message: 'الوزن يجب أن يكون رقماً' })
        .positive('الوزن يجب أن يكون رقماً موجباً')
        .max(15, 'الوزن الأقصى المسموح به هو 15'),
    amount: z
        .number({ message: 'الكمية يجب أن تكون رقماً' })
        .positive('الكمية يجب أن تكون رقماً موجباً'),
})

const arrayBasketsSchema = z.array(addBasketSchema)

const updateProfileSchema = z.object({
    username: z
        .string()
        .min(3, 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل')
        .max(50, 'اسم المستخدم يجب ألا يتجاوز 50 حرفاً')
        .optional(),
    email: z
        .string()
        .email('البريد الإلكتروني غير صالح')
        .max(300, 'البريد الإلكتروني طويل جداً')
        .optional(),
    phoneNumber: z
        .string()
        .regex(/^01[0125][0-9]{8}$/, 'رقم الهاتف غير صالح')
        .optional(),
    address: z
        .string()
        .min(10, 'العنوان قصير جداً')
        .max(255, 'العنوان طويل جداً')
        .optional(),
    activityType: z
        .enum(['Wedding hall', 'Restaurant', 'Cafe', 'Club'], {
            message: 'نوع النشاط يجب أن يكون أحد الخيارات التالية: قاعة أفراح، مطعم، كافيه، أو نادي',
        })
        .optional(),
    activityName: z
        .string()
        .min(1, 'اسم النشاط مطلوب')
        .max(50, 'اسم النشاط طويل جداً')
        .optional(),
})

const passwordSchema = z
    .object({
        oldPassword: z.string().min(8, 'كلمة المرور القديمة يجب أن تكون 8 أحرف على الأقل'),
        newPassword: z
            .string()
            .min(1, 'كلمة المرور الجديدة مطلوبة')
            .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
            .max(72, 'كلمة المرور يجب ألا تتجاوز 72 حرفاً')
            .regex(/[A-Z]/, 'كلمة المرور يجب أن تحتوي على حرف كبير واحد على الأقل (A-Z)')
            .regex(/[a-z]/, 'كلمة المرور يجب أن تحتوي على حرف صغير واحد على الأقل (a-z)')
            .regex(/[0-9]/, 'كلمة المرور يجب أن تحتوي على رقم واحد على الأقل (0-9)'),
        confirmPassword: z.string().min(1, 'تأكيد كلمة المرور مطلوب'),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
        message: 'كلمتا المرور غير متطابقتين',
        path: ['confirmPassword'],
    })

export { arrayBasketsSchema, updateProfileSchema, passwordSchema }