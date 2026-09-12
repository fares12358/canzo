import {Hono} from 'hono';
import { creditWallet } from '../services/wallet';
import {AppError } from '../middlewares/errorHandler';

//types
type ClientsWithDetails = {
    id: number
    email: string
    user_name: string
    phone_number: string
    activity_type: string
    activity_name: string
}
type Basket = {
    id: number
    client_id: number
    content_type: string
    content_weight: number
    order_id: number
    price: number
    is_full: boolean
}
type OrderWithDetails = {
  id: number
  user_name: string
  address: string
  phone_number: string
  created_at: string
  status: string
  baskets_count: number
  total_weight: number
  plastic_count: number
  canz_count: number
}
type Transaction = {
    id: number
    client_id: number
    amount: number
    created_at: string
    screenshot_path:string
}
type Bindings = {
    DB: D1Database
    JWT_SECRET: string
    RESEND_API_KEY: string
    CLOUDINARY_CLOUD_NAME: string
    canzo_KV:KVNamespace
}
type Variables = {
    jwtPayload: TokenPayload
}
type TokenPayload = {
    userId: number
    user_role: string
}
const adminRouter = new Hono<{Bindings:Bindings,Variables:Variables}>()
.get("/orders",async(c)=>{
    const status = c.req.query("status")
    if(status && status !=="Pending" ) return c.json({error:"Invalid status"},400)
        try{
               if (status === "Pending"){
      const orders = await c.env.DB.prepare("SELECT o.id,o.price, u.user_name,c.address,u.phone_number,o.created_at,o.status ,COUNT(b.id) AS baskets_count, SUM(b.content_weight) AS total_weight ,COUNT(CASE WHEN b.content_type = 'Plastic' THEN 1 END) AS plastic_count ,COUNT(CASE WHEN b.content_type = 'Canz' THEN 1 END) AS canz_count FROM orders o JOIN users u ON o.client_id = u.id LEFT JOIN baskets b ON o.id = b.order_id JOIN clients c ON o.client_id = c.user_id WHERE o.status = 'Pending' GROUP BY u.user_name,o.created_at,o.status,c.address,u.phone_number,o.id,o.price").all<OrderWithDetails>()
     return c.json({orders:orders.results},200)
    }else{
      const orders = await c.env.DB.prepare("SELECT o.id,o.price, u.user_name,c.address,u.phone_number,o.created_at,o.status ,COUNT(b.id) AS baskets_count, SUM(b.content_weight) AS total_weight ,COUNT(CASE WHEN b.content_type = 'Plastic' THEN 1 END) AS plastic_count ,COUNT(CASE WHEN b.content_type = 'Canz' THEN 1 END) AS canz_count FROM orders o JOIN users u ON o.client_id = u.id LEFT JOIN baskets b ON o.id = b.order_id JOIN clients c ON o.client_id = c.user_id GROUP BY u.user_name,o.created_at,o.status,c.address,u.phone_number,o.id,o.price").all<OrderWithDetails>()
   return c.json({orders:orders.results},200)
    }
    }catch(error){
        console.error(`error while getting orders ${error}`)
        throw error
    }
}).patch("/order/:id",async(c)=>{
    try{
      const id = Number(c.req.param("id"))
      if(isNaN(id)) return c.json({error:"معرّف الطلب غير موجود"},400)
      
      let status: string | undefined;
      const contentType = c.req.header("content-type") || "";
      if (contentType.includes("application/json")) {
          const json = await c.req.json();
          status = json.status;
      } else {
          const body = await c.req.parseBody();
          status = body.status as string;
      }

      if(!status || (status !== "Completed" && status !== "Cancelled")){
          return c.json({error:"Invalid status"},400)
      }

      const order = await c.env.DB.prepare("SELECT id,status FROM orders WHERE id = ?1").bind(id).first<{id:number,status:string}>();
      if (!order || order.status !== "Pending" ) {
          return c.json({ error: "الطلب غير موجود او تم تعديله بالفعل" }, 404);
      }

      if (status === "Cancelled"){
          await c.env.DB.batch([
              c.env.DB.prepare("UPDATE orders SET status = ?1 WHERE id = ?2").bind(status,id),
              c.env.DB.prepare("UPDATE baskets SET is_full = 0 , order_id = NULL, updated_at = datetime('now') WHERE order_id = ?1").bind(id)
          ])
          return c.json({message:"تم إلغاء الطلب بنجاح"},200)
      }

      if(status === "Completed"){
          const getBaskets = await c.env.DB.prepare("SELECT id,content_type,content_weight,price FROM baskets WHERE order_id = ?1").bind(id).all<Basket>();
          const orderRow = await c.env.DB.prepare("SELECT client_id, price FROM orders WHERE id = ?1").bind(id).first<{ client_id: number; price: number }>();
          if (!orderRow) return c.json({ error: "الطلب غير موجود" }, 404);

          const mappedBaskets = getBaskets.results.map((basket: Basket) =>
              c.env.DB.prepare("INSERT INTO sold (content_type,content_weight,total_price,order_id) VALUES(?1,?2,?3,?4)").bind(basket.content_type, basket.content_weight,basket.price,id)
          );

          await c.env.DB.batch([
              c.env.DB.prepare("UPDATE orders SET status = ?1 WHERE id = ?2").bind(status, id),
              c.env.DB.prepare("INSERT INTO transactions (client_id, screenshot_path, amount, status, note, approved_at) VALUES (?1, NULL, ?2, 'Approved', 'order_payout', datetime('now'))").bind(orderRow.client_id, orderRow.price),
              ...mappedBaskets,
              c.env.DB.prepare("UPDATE baskets SET is_full = 0, order_id = NULL, updated_at = datetime('now') WHERE order_id = ?1").bind(id),
          ]);
          await creditWallet(c.env.DB, orderRow.client_id, orderRow.price);
          return c.json({message:"تم تعديل الطلب بنجاح"},200)   
      }
    }catch(error){
        console.error(`error while updating order status ${error}`)
        throw error
    }
}).get("/analytics",async(c)=>{
    try{
      const batchReq = [
        c.env.DB.prepare("SELECT STRFTIME('%w',created_at) as day, COUNT(*) as total_packages,SUM(total_price) as total_profit FROM sold WHERE created_at >= date('now','-7 days') GROUP BY STRFTIME('%w',created_at) "),
        c.env.DB.prepare("SELECT COALESCE( SUM(CASE WHEN content_type = 'Plastic' THEN content_weight END),0) as plastic_weight , COALESCE(SUM(CASE WHEN content_type = 'Canz' THEN content_weight END),0) as canz_weight FROM sold WHERE created_at >= date('now','-7 days')"),
        c.env.DB.prepare("SELECT COALESCE(SUM(total_price),0) as total_profit FROM sold WHERE created_at >= date('now','-7 days')")
      ]
      const [soldPerDay,materialsWeightSoldThisWeek,profitsThisWeek] = await c.env.DB.batch(batchReq)
      const dayOrder = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]
      const daysSoldPerDay = soldPerDay.results.map((sold:any)=>{
        return {
          day:dayOrder[Number(sold.day)],
          total_packages:sold.total_packages,
          total_profit:sold.total_profit
        }
      })
return c.json({chart:daysSoldPerDay,materialsWeightSoldThisWeek:materialsWeightSoldThisWeek.results,profitsThisWeek:profitsThisWeek.results},200)
    }catch(error){
        console.error(`error while getting analytics ${error}`)
        throw error
    }
}).get("/transactions",async(c)=>{
    try{
        const transactions = await c.env.DB.prepare("SELECT t.id, t.amount,t.created_at,t.screenshot_path,u.user_name FROM transactions t JOIN users u ON t.client_id = u.id  ORDER BY t.created_at DESC").all<Transaction>()
        return c.json({transactions:transactions.results},200)
    }catch(error){
        console.error(`error while getting transactions ${error}`)
        throw error
    }
}).get("/client-list",async(c)=>{
  try{
    const users = await c.env.DB.prepare("SELECT u.id,u.email,u.user_name,u.phone_number,c.activity_type,c.activity_name,COUNT(CASE WHEN o.status = 'Completed' THEN o.id END) as completed_orders ,COUNT(CASE WHEN o.status = 'Cancelled' THEN o.id END) as cancelled_orders,COUNT(CASE WHEN o.status = 'Pending' THEN o.id END) as pending_orders,COUNT(t.id) as transaction_count,COALESCE(SUM(t.amount), 0) as total_profits FROM users u LEFT JOIN transactions t ON u.id = t.client_id JOIN clients c ON u.id = c.user_id LEFT JOIN orders o ON u.id = o.client_id GROUP BY u.id,u.email,u.user_name,u.phone_number,c.activity_type,c.activity_name").all<ClientsWithDetails>();
    return c.json({users:users.results},200)
  }catch(error){
    console.error(`error while getting clients ${error}`)
        throw error
  }
}).get("/stats",async(c)=>{
    try{
        const [clientsResult, ordersResult, spendsResult] = await c.env.DB.batch([
            c.env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE user_role = 'Client'"),
            c.env.DB.prepare("SELECT COUNT(*) as count FROM orders WHERE status = 'Completed'"),
            c.env.DB.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions")
        ]);

        const clientCount = (clientsResult.results[0] as { count: number } | undefined)?.count ?? 0;
        const completedOrdersCount = (ordersResult.results[0] as { count: number } | undefined)?.count ?? 0;
        const totalSpends = (spendsResult.results[0] as { total: number } | undefined)?.total ?? 0;

        return c.json({
            clientCount,
            completedOrdersCount,
            totalSpends
        },200)
    }catch(error){
        console.error(`error while getting stats ${error}`)
        throw error
    }
 }).get("/notifications", async (c) => {
    try {
        // CHANGE: Get JWT payload first and log it safely.
        const jwtPayload = c.get("jwtPayload");

        console.log("ADMIN NOTIFICATIONS JWT:", jwtPayload);

        // CHANGE: Validate that JWT payload exists.
        if (!jwtPayload) {
            throw new AppError(
                "AUTHENTICATION_ERROR",
                "بيانات تسجيل الدخول غير موجودة",
                401
            );
        }

        const { userId } = jwtPayload as TokenPayload;

        console.log("ADMIN NOTIFICATIONS USER ID:", userId);

        // CHANGE: Admin notifications always use recipient_type = 'Admin'.
        const notifications = await c.env.DB.prepare(
            "SELECT id, message, is_read, created_at FROM notifications WHERE recipient_id = ?1 AND recipient_type = 'Admin' ORDER BY created_at DESC"
        )
            .bind(userId)
            .all();

        console.log(
            "ADMIN NOTIFICATIONS RESULT:",
            notifications.results
        );

        return c.json(
            {
                notifications: notifications.results
            },
            200
        );

    } catch (error) {
        console.error(
            "ERROR WHILE GETTING ADMIN NOTIFICATIONS:",
            error
        );

        throw error;
    }
})
//.get("/notifications", async (c) => {
//     try {
//         const { userId, user_role } = c.get("jwtPayload") as TokenPayload;
//         const notifications = await c.env.DB.prepare(
//             "SELECT id, message, is_read, created_at FROM notifications  WHERE recipient_id = ?1 AND recipient_type = ?2 ORDER BY created_at DESC"
//         ).bind(userId, user_role).all();
//         return c.json({ notifications: notifications.results });
//     } catch (error) {
//         console.error(`error while getting notifications ${error}`)
//         throw error
//     }
// })
export default adminRouter
