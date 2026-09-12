import { z } from 'zod'

export const walletTypeEnum = z.enum(
    ['Vodafone Cash', 'Orange Cash', 'Etisalat Cash', 'InstaPay'],
    {
        message:
            'نوع المحفظة يجب ان يكون أحد الخيارات التالية: Vodafone Cash, Orange Cash, Etisalat Cash, InstaPay',
    }
)

const withdrawSchema = z.object({
    amount: z
        .number({ error: 'المبلغ مطلوب' })
        .positive('المبلغ يجب أن يكون أكبر من الصفر')
        .max(1_000_000, 'المبلغ تجاوز الحد المسموح به'),
    wallet_number: z
        .string({ error: 'رقم المحفظة مطلوب' })
        .min(5, 'رقم المحفظة يجب أن يحتوي على 5 خانات على الأقل')
        .max(50, 'رقم المحفظة يجب ألا يتجاوز 50 خانة'),
    wallet_type: walletTypeEnum,
})

const adminWithdrawStatusSchema = z.object({
    status: z.enum(['Approved', 'Rejected'], {
        message:     ' حالة الطلب يجب ان تكون  Approved أو Rejected',
    }),
})

export { withdrawSchema, adminWithdrawStatusSchema }
