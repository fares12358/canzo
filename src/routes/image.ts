import { Hono } from "hono";

type Bindings = {
    CANZO_R2: R2Bucket
}
const imageRouter = new Hono<{Bindings:Bindings}>()
imageRouter.get("/image/:key",async(c)=>{
    try{
const key = c.req.param("key")
if (!key || key.includes("..") || !/^[\w\-\.]+$/.test(key)) {
  return c.json({ error: "Invalid key" }, 400)
}
const image = await c.env.CANZO_R2.get(key)
if(!image){
    return c.json({error:"Image not found"},404)
}
return c.body(image.body,200,{"Content-Type": image.httpMetadata?.contentType ?? "image/jpeg"})
    }catch(error){
        console.error(`error while getting image ${error}`)
        return c.json({error:"Internal server error"},500)
    }
})
export default imageRouter