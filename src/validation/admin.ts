import { z } from "zod";
const orderStatusSchema = z.object({
    status: z.enum(["Pending", "Completed", "Cancelled"])
})
export {orderStatusSchema}