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
    canzo: D1Database
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
   const user = await c.env.canzo.prepare("SELECT activity_type FROM clients WHERE user_id = ?1").bind(userId).first<Client>()
   if(!user){
      return c.json({error:"Client not found"},404)
   }

// Check if user is requesting water (Canz) but is not a Wedding hall
const hasWaterRequest = unMappedBaskets.some(b => b.content_type === 'Canz');
if (hasWaterRequest && user.activity_type !== 'Wedding hall') {
  return c.json({ available: false, message: "Soon" }, 200);
}
 const baskets: { content_type: string; content_weight: number; price: number }[] = []
  for (const b of unMappedBaskets) {
    const pricePerKg = await c.env.canzo
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

    const totalPrice = pricePerKg.price_per_kg * b.content_weight
    for (let i = 0; i < b.amount; i++) {
      baskets.push({
        content_type: b.content_type,
        content_weight: b.content_weight,
        price: totalPrice,
      })
    }
  }
   await c.env.canzo.batch([
    ...baskets.map(b =>
        c.env.canzo.prepare("INSERT INTO baskets (client_id, content_type, content_weight, is_full, price) VALUES (?1, ?2, ?3, false, ?4)")
            .bind(userId, b.content_type, b.content_weight,b.price)
    )
])
return c.json({ message: "Baskets added successfully" }, 201);
    }catch(error){
        console.error(`error while adding basket ${error}`)
        return c.json({error:"Internal server error"},500)
    }
}).patch("/baskets/:id/fill",async(c)=>{
    try{
const {userId} = c.get("jwtPayload") as TokenPayload
const basketId = c.req.param("id")
const isOrderExist = 
await c.env.canzo.prepare("SELECT id,client_id FROM orders WHERE client_id = ?1 AND status = 'Pending'").bind(userId).first<Order>()
if(isOrderExist){
const [updateBasketWithOrderResult,updateOrderResult]= await c.env.canzo.batch([
 c.env.canzo.prepare(
  "UPDATE baskets SET is_full = 1, order_id = ?1, updated_at = datetime('now') WHERE id = ?2 AND client_id = ?3"
).bind(isOrderExist.id, basketId, userId),

c.env.canzo.prepare(
  "UPDATE orders SET price = price + (SELECT price FROM baskets WHERE id = ?1 AND client_id = ?2) WHERE id = ?3 AND client_id = ?2"
).bind(basketId, userId, isOrderExist.id)
])
 if(updateBasketWithOrderResult.meta.changes === 0 ){
   return c.json({error:"Failed to set basket to full or basket not found"},400)
 }
return c.json({message:"Basket filled successfully"},200)
}
const [insertrResult,updateBasketWithNoOrderResult]= await c.env.canzo.batch([
 c.env.canzo.prepare(
  "INSERT INTO orders (client_id, status, price) VALUES (?1, 'Pending', (SELECT price FROM baskets WHERE id = ?2 AND client_id = ?1))"
).bind(userId, basketId),
c.env.canzo.prepare(
  "UPDATE baskets SET is_full = 1, order_id = last_insert_rowid(), updated_at = datetime('now') WHERE id = ?1 AND client_id = ?2"
).bind(basketId, userId)
])
if(updateBasketWithNoOrderResult.meta.changes === 0){
return c.json({error:"Failed to set basket to full or basket not found"},400)
}
return c.json({message:"Basket filled successfully"},200)
    }catch(error){
        console.error(`error while setting basket full ${error}`)
        return c.json({error:"Internal server error"},500)
    }
}).get("/baskets",async(c)=>{
    try{
const {userId} = c.get("jwtPayload") as TokenPayload
const baskets = await c.env.canzo.prepare("SELECT id,content_type,content_weight,is_full,price FROM baskets WHERE client_id = ?1").bind(userId).all<Basket>()
return c.json({baskets:baskets.results})
    }catch(error){
        console.error(`error while getting baskets ${error}`)
        return c.json({error:"Internal server error"},500)
    }
}).get("/orders/count",async(c)=>{
    try{
        const {userId} = c.get("jwtPayload") as TokenPayload
        const counts = await c.env.canzo.prepare(
            "SELECT COUNT(CASE WHEN status = 'Completed' THEN 1 END) AS completed, COUNT(CASE WHEN status = 'Cancelled' THEN 1 END) AS cancelled, COUNT(CASE WHEN status = 'Pending' THEN 1 END) AS pending FROM orders WHERE client_id = ?1"
        ).bind(userId).first<{ completed: number; cancelled: number; pending: number }>()
        return c.json({counts})
    }catch(error){
        console.error(`error while getting orders count ${error}`)
        return c.json({error:"Internal server error"},500)
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
  orders = await c.env.canzo.prepare(`
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
   const completedOrders = await c.env.canzo.prepare(`
    SELECT o.id, o.price, o.status, o.created_at, c.address
    FROM orders o
    JOIN clients c ON o.client_id = c.user_id
    WHERE o.client_id = ?1 AND o.status = 'Completed'
  `).bind(userId).all<any>()

  const ordersWithItems = await Promise.all(
    completedOrders.results.map(async (order) => {
      const items = await c.env.canzo.prepare(`
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
  orders = await c.env.canzo.prepare(`
    SELECT o.id, o.price, o.status, o.created_at, c.address
    FROM orders o
    JOIN clients c ON o.client_id = c.user_id
    WHERE o.client_id = ?1 AND o.status = 'Cancelled'
  `).bind(userId).all()
}
return c.json({orders:orders.results})
    }catch(error){
        console.error(`error while getting orders ${error}`)
        return c.json({error:"Internal server error"},500)
    }
}).get("/transactions",async(c)=>{
    try{    
const {userId} = c.get("jwtPayload") as TokenPayload
const allTransactions = await c.env.canzo.prepare("SELECT t.id,t.amount,t.created_at,t.screenshot_path,u.user_name as username FROM transactions t JOIN users u ON t.client_id = u.id WHERE t.client_id = ?1").bind(userId).all<Transaction>()
const lastMonthTransactions = await c.env.canzo.prepare("SELECT t.id,t.amount,t.created_at,t.screenshot_path,u.user_name as username FROM transactions t JOIN users u ON t.client_id = u.id WHERE t.client_id = ?1 AND t.created_at >= date('now', '-1 month')").bind(userId).all<Transaction>()
const lastWeekTransactions = await c.env.canzo.prepare("SELECT t.id,t.amount,t.created_at,t.screenshot_path,u.user_name as username FROM transactions t JOIN users u ON t.client_id = u.id WHERE t.client_id = ?1 AND t.created_at >= date('now', '-7 days')").bind(userId).all<Transaction>()
const todayTransactions = await c.env.canzo.prepare("SELECT t.id,t.amount,t.created_at,t.screenshot_path,u.user_name as username FROM transactions t JOIN users u ON t.client_id = u.id WHERE t.client_id = ?1 AND t.created_at >= date('now', 'start of day')").bind(userId).all<Transaction>()
const totalEarnings = await c.env.canzo.prepare("SELECT SUM(amount) as total FROM transactions WHERE client_id = ?1").bind(userId).first<{ total: number }>()
return c.json({allTransactions:allTransactions.results,
    lastMonthTransactions:lastMonthTransactions.results,
    lastWeekTransactions:lastWeekTransactions.results,
    todayTransactions:todayTransactions.results,
    totalEarnings:totalEarnings})
    }catch(error){
        console.error(`error while getting transactions ${error}`)
        return c.json({error:"Internal server error"},500)
    }
 }) .get("/wallet",async(c)=>{
    try{
const {userId} = c.get("jwtPayload") as TokenPayload
let wallet = await c.env.canzo.prepare("SELECT balance,pending_balance FROM wallets WHERE user_id = ?1").bind(userId).first<Wallet>()
if (!wallet){
    await c.env.canzo.prepare("INSERT INTO wallets (user_id, balance) VALUES (?1, 0)").bind(userId).run()
     wallet = await c.env.canzo.prepare("SELECT balance FROM wallets WHERE user_id = ?1").bind(userId).first<Wallet>()
}
return c.json({wallet})
    }catch(error){
        console.error(`error while getting wallet ${error}`)
        return c.json({error:"Internal server error",message:error},500)
    }
}).delete("/basket/:id", async (c) => {
    try {
        const { userId } = c.get("jwtPayload") as TokenPayload
        const basketId = c.req.param("id")
        
        const basket = await c.env.canzo.prepare("SELECT is_full FROM baskets WHERE id = ?1 AND client_id = ?2").bind(basketId, userId).first<Basket>()
        
        if (!basket) {
            return c.json({ error: "Basket not found" }, 404)
        }
        
        if (basket.is_full) {
            return c.json({ message: "Cannot delete a full basket" }, 400)
        }
        
        await c.env.canzo.prepare("DELETE FROM baskets WHERE id = ?1 AND client_id = ?2").bind(basketId, userId).run()
        
        return c.json({ message: "Basket deleted successfully" }, 200)
    } catch (error) {
        console.error(`error while deleting basket ${error}`)
        return c.json({ error: "Internal server error" }, 500)
    }
})

export default clientRouter

