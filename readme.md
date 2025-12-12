# Garments Flow

Garments Flow is a full-stack MERN-based garment ordering and management
platform built to support buyers, managers, and administrators with role-based
access control, product management, order processing, and dashboard analytics.

---

## Live Demo

Client Application:  
https://garments-flow.vercel.app/

---

## Repositories

Client Repository:  
https://github.com/ashikurahman1/garments-flow-c

Server Repository:  
https://github.com/ashikurahman1/garments-flow

---

## Tech Stack

### Frontend

- Next.js
- React
- Tailwind CSS
- TanStack Query
- Firebase Authentication

### Backend

- Node.js
- Express.js
- MongoDB
- Firebase Admin SDK
- Formidable (file uploads)
- Axios
- JWT-based authorization

---

## Authentication and Authorization

- Firebase Authentication for secure login and registration
- Firebase Admin SDK for verifying ID tokens
- Role-based access control (buyer, manager, admin)
- Protected API routes using middleware

---

## Core Features

### User Management

- User registration and profile updates
- Admin-controlled user role and status management
- User suspension and deletion
- Role-based conditional navigation rendering

### Product Management

- Add, update, and delete products (Admin and Manager)
- Multiple image uploads using imgBB
- Featured products for home page display
- Search, pagination, and filtering

### Order Management

- Order placement by buyers only
- MOQ and stock availability validation
- Order approval and rejection by Admin or Manager
- Order cancellation (pending orders only)
- Order tracking timeline with status history

### Dashboards

Admin Dashboard:

- Product statistics (daily, weekly, monthly)
- User statistics
- Monthly order analytics

Manager Dashboard:

- Pending and approved orders
- Manager-specific product listings

Buyer Dashboard:

- Order count and order history

---

## Important Learning and Mistakes

### Mistake #1: API Route Prefix Mismatch

While implementing the user role fetching feature, the backend route was
initially created without the `/api` prefix, but the frontend was requesting
data using `/api/...`.
