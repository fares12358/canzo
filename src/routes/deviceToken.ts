import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { deviceTokenSchema } from "../validation/auth";

type Bindings = {
  DB: D1Database;
  JWT_SECRET: string;
};

type Variables = {
  jwtPayload: {
    userId: number;
    user_role: "Client" | "Admin";
  };
};

const deviceTokenRouter = new Hono<{
  Bindings: Bindings;
  Variables: Variables;
}>();

deviceTokenRouter.post(
  "/device-token",
  zValidator("json", deviceTokenSchema, (result, c) => {
    if (!result.success) {
      return c.json(
        {
          error: result.error.issues[0].message,
        },
        400
      );
    }
  }),
  async (c) => {
    try {
      // Get the authenticated user's JWT payload
      const payload = c.get("jwtPayload");

      if (!payload?.userId) {
        return c.json(
          {
            error: "المستخدم غير مصرح له",
          },
          401
        );
      }

      const { device_token } = c.req.valid("json");

      // Make sure the user exists
      const user = await c.env.DB.prepare(
        "SELECT id FROM users WHERE id = ?1"
      )
        .bind(payload.userId)
        .first<{ id: number }>();

      if (!user) {
        return c.json(
          {
            error: "المستخدم غير موجود",
          },
          404
        );
      }

      // Update the FCM token for the authenticated user
      await c.env.DB.prepare(
        "UPDATE users SET fcm_token = ?1, updated_at = datetime('now') WHERE id = ?2"
      )
        .bind(device_token, payload.userId)
        .run();

      return c.json(
        {
          message: "تم تحديث FCM Token بنجاح",
        },
        200
      );
    } catch (error) {
      console.error("Error while updating FCM token:", error);

      return c.json(
        {
          error: "حدث خطأ أثناء تحديث FCM Token",
        },
        500
      );
    }
  }
);

export default deviceTokenRouter;