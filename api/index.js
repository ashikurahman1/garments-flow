import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';

// import authRoutes from './routes/auth.routes.js';
// import userRoutes from './routes/users.routes.js';
// import productsRoutes from './routes/products.routes.js';
// import ordersRoutes from './routes/orders.routes.js';

dotenv.config();
const app = express();

// Middlewares

app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Routes
// app.use('api/auth');
// app.use('api/user');
// app.use('api/products');
// app.use('api/orders');

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Start server
const port = process.env.PORT || 5000;

connectDB().then(() => {
  app.listen(port, () => console.log(`Server running on port ${port}`));
});
