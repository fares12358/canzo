/auth
  POST   /client/signup     - Register a new client (username, password, email, phone, address, activity type/name)
  POST   /login             - Login with email or phone + password, returns JWT
  POST   /forgot-password   - Send OTP to email for password reset
  POST   /verify-otp        - Verify OTP, returns reset token
  PATCH  /reset-password    - Reset password using reset token
  POST   /google            - Google OAuth login, returns JWT

/google
  POST   /setup-profile     - Complete Google OAuth profile setup (address, activity type/name) | Client only

/client (protected, Client only)
  POST   /baskets                  - Add baskets with auto-calculated price
  PATCH  /baskets/:id/fill         - Mark basket as full, creates or updates pending order
  GET    /baskets                  - Get all client baskets
  GET    /orders/count             - Get order counts by status
  GET    /orders/:status           - Get orders by status (Pending/Completed/Cancelled)
  GET    /transactions             - Get all transactions (today, last week, last month, all time)

/admin (protected, Admin only)
  GET    /orders                   - Get all orders (optional ?status=Pending filter)
  PATCH  /order/:id                - Update order status (Completed/Cancelled) with screenshot upload
  GET    /analytics                - Get weekly analytics (sales per day, materials weight, profits)
  GET    /transactions             - Get all transactions with client info
  GET    /client-list              - Get all clients with order counts and total profits
  GET    /stats                    - Get overall stats (client count, completed orders, total revenue)

/image
  GET    /image/:key               - Serve image from R2 bucket

/profile (protected, Client & Admin)
  GET    /profile                  - Get client profile
  PATCH  /profile                  - Update client profile

/middleware
  verifyRole(role)    - Restricts route access based on JWT user_role (Client | Admin)

./validation
  all validation schemas are there
  /services
  sendEmail(apiKey, data)   - Sends transactional emails via Brevo SMTP API (used for OTP delivery and emails)