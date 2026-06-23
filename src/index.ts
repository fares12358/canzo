import { Hono } from 'hono'
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import {jwt} from "hono/jwt"
import clientRouter from './routes/client';
import profileRouter from './routes/profile';
import imageRouter from './routes/image';
import googleRouter from "./routes/google"
import { clientWithdrawRouter, adminWithdrawRouter } from "./routes/withdrawal"
import {prettyJSON} from "hono/pretty-json"
import verifyRole from "./middlewares/verifyRole"
type Bindings = {
    JWT_SECRET: string
}

const app = new Hono<{Bindings:Bindings}>()
app.use(prettyJSON())


app.use("/api/*",(c,next)=>{
  const jwtMiddleware = jwt({
    secret: c.env.JWT_SECRET,
    alg: 'HS256',
  })
  return jwtMiddleware(c, next)
})
app.use("/api/client/*",verifyRole("Client"))
//app.use("/api/admin/*",verifyRole("Admin"))

app.route("/api/admin/", adminRouter)
app.route("/api/admin/", profileRouter)
app.route("/auth/", authRouter)
app.route("/api/", googleRouter)
app.route("/api/client/", clientRouter)
app.route("/api/client/", clientWithdrawRouter)
app.route("/api/client/", profileRouter)
app.route("/api/admin/", adminWithdrawRouter)
app.route("/",imageRouter)

export default app
