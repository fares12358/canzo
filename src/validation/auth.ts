import { z } from "zod";

const baseSchema = z.object({
  username: z
    .string()
    .min(1, "اسم المستخدم مطلوب")
    .min(3, "اسم المستخدم يجب ان يكون 3 أحرف على الأقل")
    .max(50, "اسم المستخدم لا يجب أن يزيد عن 50 حرف"),
  password: z
    .string()
    .min(1, "كلمة المرور مطلوبة")
    .min(8, "يجب ان تكون كلمة المرور على الأقل 8 أحرف ")
    .max(72)
    .regex(/[A-Z]/, " كلمة المرور يجب ان تحتوي على حرف كبير واحد على الأقل")
    .regex(/[a-z]/, "كلمة المرور يجب ان تحتوي على حرف صغير واحد على الأقل")
    .regex(/[0-9]/, "كلمة المرور يجب ان تحتوي على رقم واحد على الأقل"),
  confirmPassword: z.string().min(1, "تأكيد كلمة المرور مطلوب"),
  email: z.email("البريد الإلكتروني غير صالح").max(300),
  phoneNumber: z
    .string()
    .min(1, "رقم الهاتف مطلوب")
    .regex(/^01[0125][0-9]{8}$/, "رقم الهاتف غير صحيح"),
});
const refinedBaseSchema = baseSchema.refine(
  (data) => data.password === data.confirmPassword,
  {
    message: "كلمتا المرور غير متطابقتا",
  }
);
const clientSignupSchema = refinedBaseSchema
  .extend(  {
    address: z
      .string()
      .min(1, "العنوان مطلوب")
      .min(10, "العنوان قصير للغاية")
      .max(255, "العنوان طويل للغاية"),
    activityType: z.enum(
      ["Wedding hall", "Restaurant", "Cafe", "Club", "Other"],
      {
        message:
          "يجب ان يكون نوع النشاط أحد الخيارات التالية: قاعة أفراح, مطعم, مقهى , نادي , نشاط آخر",
      }
    ),
    activityName: z
      .string()
      .max(50, "اسم النشاط طويل للغاية")
      .min(1, "اسم النشاط مطلوب"),
    // customBusinessType: z
    //   .string()
    //   .max(255, "اسم النشاط طويل للغاية")
    //   .optional(),
  });
  // .refine(
  //   (data) => {
  //     if (data.activityType === "Other") {
  //       return (
  //       !!data.customBusinessType && data.customBusinessType.trim().length > 0
  //       );
  //     }
  //     return true;
  //   },
  //   {
  //     message: "نوع النشاط المخصص مطلوب عند اختيار  other",
  //     path: ["customBusinessType"],
  //   }
  // )
  // .refine(
  //   (data) => {
  //     if (data.activityType !== "Other") {
  //       return !data.customBusinessType;
  //     }
  //     return true;
  //   },
  //   {
  //     message:
  //       "يجب إدخال نوع النشاط المخصص فقط عند إختيار خيار آخر",
  //     path: ["customBusinessType"],
  //   }
  // );
const loginSchema = z.object({
  identifier: z.string().min(1, " معرّف الدخول مطلوب").max(300),
  password: z.string().min(1, "كلمة المرور مطلوبة للدخول").max(72),
});
const deviceTokenSchema = z.object({
  device_token:z
  .string()
  .min(1, "FCM Token مطلوب")
})
const resetPasswordSchema = baseSchema
  .pick({
    password: true,
    confirmPassword: true,
    email: true,
  })
  .extend({
    resetToken: z.uuid("رمز إعادة التعيين غير صالح"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "كلمات المرور غير متطابقة",
  });
const enterEmailSchema = baseSchema.pick({
  email: true,
});
const enterOtpSchema = baseSchema
  .pick({
    email: true,
  })
  .extend({
    otp: z.string().min(1, "كود التحقق مطلوب").length(6, "كود التحقق لا يجب ان يقل عن 6 أحرف"),
  });
export {
  clientSignupSchema,
  loginSchema,
  resetPasswordSchema,
  enterEmailSchema,
  enterOtpSchema,
  deviceTokenSchema,
};
