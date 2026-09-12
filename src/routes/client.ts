import { Hono } from "hono";
import { JwtVariables } from "hono/jwt";
import {zValidator} from "@hono/zod-validator"
import {arrayBasketsSchema} from "../validation/client"
//client schema
type Client = {
    user_id: number
    activity_type: string
    activity_name: string
}
//pricing schema
type Pricing = {
    id: number
    material: string
    activity_type: string
    price_per_kg: number
}
//baskets
type Basket = {
    id: number
    client_id: number
    content_type: string
    content_weight: number
    order_id: number
    is_full: boolean
    price: number
}
//binding
type Bindings = {
    DB: D1Database
    JWT_SECRET: string
    RESEND_API_KEY: string
    canzo_KV:KVNamespace
}
type Variables = {
    jwtPayload: TokenPayload
}
//orders
type Order = {
    id: number
    client_id: number
    status: string
    created_at: string
}
//transactions
type Transaction = {
    id: number
    client_id: number
    amount: number
    status: string
    created_at: string
    screenshot_path: string |null

}
//wallet
type Wallet = {
    user_id: number
    balance: number
    created_at: string
}
type TokenPayload = {
    userId: number
    user_role: string
}
const clientRouter = new Hono<{Bindings:Bindings,Variables:Variables}>()

clientRouter.post("/baskets",zValidator("json",arrayBasketsSchema,(result,c)=>{
    if(!result.success){
        return c.json({error:result.error.issues[0].message},400)
    }
}),async(c)=>{
    try{
 const {userId} = c.get("jwtPayload") as TokenPayload
  const unMappedBaskets = c.req.valid("json")
   const user = await c.env.DB.prepare("SELECT activity_type FROM clients WHERE user_id = ?1").bind(userId).first<Client>()
   if(!user){
      return c.json({error:"العميل غير موجود"},404)
   }

// Check if user is requesting water (Plastic) but is not a Wedding hall
   const filteredBaskets = unMappedBaskets.filter((b) => {
          if (b.content_type === "Plastic" && user.activity_type !== "Wedding hall") {
            return false; // استبعاد المياه إذا لم يكن العميل قاعة أفراح
          }
          return true;
        });

        if (filteredBaskets.length === 0) {
          return c.json(
            { error: "طلب المياه متاح حالياً لقاعات الأفراح فقط" },
            400
          );
        }


 const baskets: { content_type: string; content_weight: number; price: number }[] = []
  for (const b of unMappedBaskets) {
    const pricePerKg = await c.env.DB
      .prepare("SELECT price_per_kg FROM pricing WHERE material = ?1 AND activity_type = ?2")
      .bind(b.content_type, user.activity_type)
      .first<Pricing>()

    if (!pricePerKg) {
      return c.json(
        {
          error: `No pricing for material "${b.content_type}" and activity "${user.activity_type}". Run db/seed-pricing.sql on your D1 database.`,
        },
        400
      )
    }
    // OLD CALCULATION : the DB value was previously treated as a per-kg price.
    // const totalPrice = pricePerKg.price_per_kg * b.content_weight

    //  The value stored in pricing.price_per_kg is now the price of the whole basket.
    // Therefore we use it directly without multiplying by the basket weight.
    const totalPrice = pricePerKg.price_per_kg
    for (let i = 0; i < b.amount; i++) {
      baskets.push({
        content_type: b.content_type,
        content_weight: b.content_weight,
        price: totalPrice,
      })
    }
  }
   await c.env.DB.batch([
    ...baskets.map(b =>
        c.env.DB.prepare("INSERT INTO baskets (client_id, content_type, content_weight, is_full, price) VALUES (?1, ?2, ?3, false, ?4)")
            .bind(userId, b.content_type, b.content_weight,b.price)
    )
])
return c.json({ message: "تمت  إضافة السلة بنجاح" }, 201);
    }catch(error){
        console.error(`خطأ أثناء إضافة السلة ${error}`)
        throw error
    }
}).patch("/baskets/:id/fill",async(c)=>{
    try{
const {userId} = c.get("jwtPayload") as TokenPayload
const basketId = c.req.param("id")
const isOrderExist = 
await c.env.DB.prepare("SELECT id,client_id FROM orders WHERE client_id = ?1 AND status = 'Pending'").bind(userId).first<Order>()
if(isOrderExist){
const [updateBasketWithOrderResult,updateOrderResult]= await c.env.DB.batch([
 c.env.DB.prepare(
  "UPDATE baskets SET is_full = 1, order_id = ?1, updated_at = datetime('now') WHERE id = ?2 AND client_id = ?3"
).bind(isOrderExist.id, basketId, userId),

c.env.DB.prepare(
  "UPDATE orders SET price = price + (SELECT price FROM baskets WHERE id = ?1 AND client_id = ?2) WHERE id = ?3 AND client_id = ?2"
).bind(basketId, userId, isOrderExist.id)
])
 if(updateBasketWithOrderResult.meta.changes === 0 ){
   return c.json({error:"فشل في تغيير حالة السلة الى ممتلئة او السلة غير موجودة"},400)
 }
return c.json({message:"تم تعبئة السلة بنجاح"},200)
}
const [insertrResult,updateBasketWithNoOrderResult]= await c.env.DB.batch([
 c.env.DB.prepare(
  "INSERT INTO orders (client_id, status, price) VALUES (?1, 'Pending', (SELECT price FROM baskets WHERE id = ?2 AND client_id = ?1))"
).bind(userId, basketId),
c.env.DB.prepare(
  "UPDATE baskets SET is_full = 1, order_id = last_insert_rowid(), updated_at = datetime('now') WHERE id = ?1 AND client_id = ?2"
).bind(basketId, userId)
])
if(updateBasketWithNoOrderResult.meta.changes === 0){
return c.json({error:"فشل في تغيير حالة السلة الى ممتلئة او السلة غير موجودة"},400)
}
return c.json({message:"تم تعبئة السلة بنجاح"},200)
    }catch(error){
        console.error(`error while setting basket full ${error}`)
        throw error
    }
}).get("/baskets",async(c)=>{
    try{
const {userId} = c.get("jwtPayload") as TokenPayload
const baskets = await c.env.DB.prepare("SELECT id,content_type,content_weight,is_full,price FROM baskets WHERE client_id = ?1").bind(userId).all<Basket>()
return c.json({baskets:baskets.results})
    }catch(error){
        console.error(`خطأ أثناء جلب السلة ${error}`)
        throw error
    }
}).get("/orders/count",async(c)=>{
    try{
        const {userId} = c.get("jwtPayload") as TokenPayload
        const counts = await c.env.DB.prepare(
            "SELECT COUNT(CASE WHEN status = 'Completed' THEN 1 END) AS completed, COUNT(CASE WHEN status = 'Cancelled' THEN 1 END) AS cancelled, COUNT(CASE WHEN status = 'Pending' THEN 1 END) AS pending FROM orders WHERE client_id = ?1"
        ).bind(userId).first<{ completed: number; cancelled: number; pending: number }>()
        return c.json({counts})
    }catch(error){
        console.error(`خطأ أثناء جلب عدد الطلبات ${error}`)
        throw error
    }
}).get("/orders/:status",async(c)=>{
    try{
const {userId,user_role} = c.get("jwtPayload") as TokenPayload
const status = c.req.param("status")
const OrderStatus = ["Pending","Completed","Cancelled"]
if(!OrderStatus.includes(status)){
    return c.json({error:"Invalid status"},400)
}
let orders;
if (status === "Pending") {
  orders = await c.env.DB.prepare(`
    SELECT o.id, o.price, o.status, o.created_at, c.address,
      COUNT(b.id) AS total_baskets,
      COUNT(CASE WHEN b.content_type = 'Plastic' THEN 1 END) AS plastic_count,
      COUNT(CASE WHEN b.content_type = 'Canz' THEN 1 END) AS canz_count,
      COALESCE(SUM(b.content_weight), 0) AS total_weight
    FROM orders o
    LEFT JOIN baskets b ON o.id = b.order_id
    JOIN clients c ON o.client_id = c.user_id
    WHERE o.client_id = ?1 AND o.status = 'Pending'
    GROUP BY o.id, o.price, o.status, o.created_at, c.address
  `).bind(userId).all()

} else if (status === "Completed") {
   const completedOrders = await c.env.DB.prepare(`
    SELECT o.id, o.price, o.status, o.created_at, c.address
    FROM orders o
    JOIN clients c ON o.client_id = c.user_id
    WHERE o.client_id = ?1 AND o.status = 'Completed'
  `).bind(userId).all<any>()

  const ordersWithItems = await Promise.all(
    completedOrders.results.map(async (order) => {
      const items = await c.env.DB.prepare(`
        SELECT content_type, content_weight, total_price
        FROM sold
        WHERE order_id = ?1
      `).bind(order.id).all<any>()

      return { ...order, sold_items: items.results }
    })
  )

  orders = ordersWithItems
  return c.json({orders})
} else {
  orders = await c.env.DB.prepare(`
    SELECT o.id, o.price, o.status, o.created_at, c.address
    FROM orders o
    JOIN clients c ON o.client_id = c.user_id
    WHERE o.client_id = ?1 AND o.status = 'Cancelled'
  `).bind(userId).all()
}
return c.json({orders:orders.results})
    }catch(error){
        console.error(`error while getting orders ${error}`)
        throw error
    }
}).get("/transactions",async(c)=>{
    try{    
const {userId} = c.get("jwtPayload") as TokenPayload
const allTransactions = await c.env.DB.prepare("SELECT t.id,t.amount,t.created_at,t.screenshot_path,u.user_name as username FROM transactions t JOIN users u ON t.client_id = u.id WHERE t.client_id = ?1").bind(userId).all<Transaction>()
const lastMonthTransactions = await c.env.DB.prepare("SELECT t.id,t.amount,t.created_at,t.screenshot_path,u.user_name as username FROM transactions t JOIN users u ON t.client_id = u.id WHERE t.client_id = ?1 AND t.created_at >= date('now', '-1 month')").bind(userId).all<Transaction>()
const lastWeekTransactions = await c.env.DB.prepare("SELECT t.id,t.amount,t.created_at,t.screenshot_path,u.user_name as username FROM transactions t JOIN users u ON t.client_id = u.id WHERE t.client_id = ?1 AND t.created_at >= date('now', '-7 days')").bind(userId).all<Transaction>()
const todayTransactions = await c.env.DB.prepare("SELECT t.id,t.amount,t.created_at,t.screenshot_path,u.user_name as username FROM transactions t JOIN users u ON t.client_id = u.id WHERE t.client_id = ?1 AND t.created_at >= date('now', 'start of day')").bind(userId).all<Transaction>()
const totalEarnings = await c.env.DB.prepare("SELECT SUM(amount) as total FROM transactions WHERE client_id = ?1").bind(userId).first<{ total: number }>()
return c.json({allTransactions:allTransactions.results,
    lastMonthTransactions:lastMonthTransactions.results,
    lastWeekTransactions:lastWeekTransactions.results,
    todayTransactions:todayTransactions.results,
    totalEarnings:totalEarnings})
    }catch(error){
        console.error(`error while getting transactions ${error}`)
        throw error
    }
 }) .get("/wallet",async(c)=>{
    try{
const {userId} = c.get("jwtPayload") as TokenPayload
let wallet = await c.env.DB.prepare("SELECT balance,pending_balance FROM wallets WHERE user_id = ?1").bind(userId).first<Wallet>()
if (!wallet){
    await c.env.DB.prepare("INSERT INTO wallets (user_id, balance) VALUES (?1, 0)").bind(userId).run()
     wallet = await c.env.DB.prepare("SELECT balance FROM wallets WHERE user_id = ?1").bind(userId).first<Wallet>()
}
return c.json({wallet})
    }catch(error){
        console.error(`خطأ أثناء حذف المحفظة ${error}`)
        throw error
    }
}).delete("/basket/:id", async (c) => {
    try {
        const { userId } = c.get("jwtPayload") as TokenPayload
        const basketId = c.req.param("id")
        
        const basket = await c.env.DB.prepare("SELECT is_full FROM baskets WHERE id = ?1 AND client_id = ?2").bind(basketId, userId).first<Basket>()
        
        if (!basket) {
            return c.json({ error: "السلة غير موجودة" }, 404)
        }
        
        if (basket.is_full) {
            return c.json({ message: "لا يمكن حذف سلة ممتلئة" }, 400)
        }
        
        await c.env.DB.prepare("DELETE FROM baskets WHERE id = ?1 AND client_id = ?2").bind(basketId, userId).run()
        
        return c.json({ message: "Basket deleted successfully" }, 200)
    } catch (error) {
        console.error(`خطأ أثناء حذف السلة ${error}`)
        throw error
    }
}).get("/notifications", async (c) => {
    try {
        const { userId } = c.get("jwtPayload") as TokenPayload

        const notifications = await c.env.DB.prepare(
            "SELECT id, message, is_read, created_at FROM notifications WHERE recipient_id = ?1 AND recipient_type = 'Client' ORDER BY created_at DESC"
        )
        .bind(userId)
        .all()

        return c.json({ notifications: notifications.results }, 200)
    } catch (error) {
        console.error('error while getting client notifications ${error}')
        throw error
    }
})

export default clientRouter

