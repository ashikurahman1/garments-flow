import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import formidable from 'formidable';
import axios from 'axios';
import fs from 'fs';
import { nanoid } from 'nanoid';
import admin from 'firebase-admin';
import { MongoClient, ServerApiVersion, ObjectId } from 'mongodb';

const app = express();

const port = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

// Firebase admin sdk
const decoded = Buffer.from(process.env.SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// verify Firebase Token
const verifyFirebaseToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: 'Unauthorized Access' });
  }
  try {
    const authorization = token.split(' ')[1];
    const decoded = await admin.auth().verifyIdToken(authorization);
    req.decoded_email = decoded.email;
    console.log(decoded);

    next();
  } catch (error) {
    return res.status(401).send({ message: 'Unauthorized Access' });
  }
};

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const db = client.db('garments_flow');
    const usersCollection = db.collection('users');
    const productsCollection = db.collection('products');
    const ordersCollection = db.collection('orders');

    // Verify Admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      if (!user || user.role !== 'admin') {
        return res.status(403).send({ message: 'Forbidden Access' });
      }
      next();
    };

    //  Verify Manager
    const verifyManager = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await usersCollection.findOne({ email });

      if (!user || user.role !== 'manager') {
        return res.status(403).send({ message: 'Forbidden Access' });
      }
      next();
    };
    // Manager & Admin
    const verifyAdminOrManager = async (req, res, next) => {
      try {
        const email = req.decoded_email;

        if (!email) {
          return res.status(401).send({ message: 'Invalid Token' });
        }

        const user = await usersCollection.findOne({ email });

        if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
          return res.status(403).send({ message: 'Forbidden Access' });
        }

        next();
      } catch (error) {
        return res.status(403).send({ message: 'Forbidden Access' });
      }
    };

    // users related API
    // get all users by admin
    app.get(
      '/api/users',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const { searchText, role, status } = req.query;
        const query = {};

        // Search by name or email
        if (searchText) {
          query.$or = [
            { displayName: { $regex: searchText, $options: 'i' } },
            { email: { $regex: searchText, $options: 'i' } },
          ];
        }

        // Filter by role
        if (role) {
          query.role = role;
        }

        // Filter by status
        if (status) {
          query.status = status;
        }

        try {
          const cursor = usersCollection.find(query).sort({ createdAt: -1 });
          const result = await cursor.toArray();
          res.send(result);
        } catch (error) {
          res.status(500).send({ message: 'Failed to fetch users', error });
        }
      }
    );
    // add user in Db
    app.post('/api/users', async (req, res) => {
      const user = req.body;
      user.status = 'pending';
      user.createdAt = new Date();
      // Check user is exist or not
      const email = user.email;
      const userExist = await usersCollection.findOne({ email });
      if (userExist) {
        return res.send({ message: 'User already exist' });
      }
      const result = await usersCollection.insertOne(user);
      res.status(200).send(result);
    });

    // get user by query email
    app.get('/api/users/:email', verifyFirebaseToken, async (req, res) => {
      try {
        const email = req.params.email;

        if (email !== req.decoded_email) {
          return res
            .status(403)
            .send({ success: false, message: 'Forbidden access' });
        }

        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res
            .status(404)
            .send({ success: false, message: 'User not found' });
        }

        res.send({ success: true, user });
      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, message: 'Server error' });
      }
    });

    // get user role by query email
    app.get('/api/users/:email/role', verifyFirebaseToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || 'buyer' });
    });

    app.patch(
      '/api/users/:email/update-profile',
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const { email } = req.params;

          // Ensure the user can only update their own profile
          if (email !== req.decoded_email) {
            return res
              .status(403)
              .send({ success: false, message: 'Forbidden access' });
          }

          const { displayName, photoURL } = req.body;

          if (!displayName && !photoURL) {
            return res
              .status(400)
              .send({ success: false, message: 'Nothing to update' });
          }

          // Build update object
          const updateData = {};
          if (displayName) updateData.displayName = displayName;
          if (photoURL) updateData.photoURL = photoURL;

          // Update in database
          const result = await usersCollection.updateOne(
            { email },
            { $set: updateData }
          );

          if (result.matchedCount === 0) {
            return res
              .status(404)
              .send({ success: false, message: 'User not found' });
          }

          // Return updated user
          const updatedUser = await usersCollection.findOne({ email });

          res.send({
            success: true,
            message: 'Profile updated successfully!',
            user: updatedUser,
            photoURL: updatedUser.photoURL,
          });
        } catch (error) {
          console.error('Update profile error:', error);
          res.status(500).send({
            success: false,
            message: 'Server error',
            error: error.message,
          });
        }
      }
    );

    // update user role & status by admin
    app.patch(
      '/api/users/:id',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;

        const { role, status } = req.body;

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          {
            $set: { role, status },
          }
        );
        res.send({ success: !!result.modifiedCount });
      }
    );
    // suspend user by admin
    app.patch(
      '/api/users/:id/suspend',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { suspendReason, suspendFeedback } = req.body;

        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: 'suspended', suspendReason, suspendFeedback } }
        );

        res.send({ success: !!result.modifiedCount });
      }
    );

    // delete user by admin
    app.delete(
      '/api/users/:id',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;

        try {
          const result = await usersCollection.deleteOne({
            _id: new ObjectId(id),
          });
          if (result.deletedCount === 1) {
            res.send({ success: true, message: 'User deleted successfully' });
          } else {
            res.status(404).send({ success: false, message: 'User not found' });
          }
        } catch (error) {
          console.error(error);
          res
            .status(500)
            .send({ success: false, message: 'Internal server error' });
        }
      }
    );

    // Products related api
    app.get('/api/products', async (req, res) => {
      try {
        const { search = '', page = 1, limit = 12 } = req.query;

        const query = search ? { name: { $regex: search, $options: 'i' } } : {};

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const total = await productsCollection.countDocuments(query);
        const products = await productsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .toArray();

        res.send({
          products,
          total,
          page: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: 'Something went wrong' });
      }
    });
    app.get('/api/products/featured', async (req, res) => {
      try {
        const products = await productsCollection
          .find({ showOnHome: true })
          .sort({ createdAt: -1 })
          .limit(8)
          .toArray();
        res.send(products);
      } catch (error) {
        console.error('Featured products error:', error);
        res.status(500).send({ message: 'Something went wrong' });
      }
    });
    app.get('/api/products/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const query = {
          _id: new ObjectId(id),
        };
        const result = await productsCollection.findOne(query);
        res.send(result);
        console.log(id);
      } catch (error) {
        res.status(500).send({ message: 'Something wen wrong' });
      }
    });

    app.post(
      '/api/products',
      verifyFirebaseToken,
      verifyAdminOrManager,
      async (req, res) => {
        try {
          const form = formidable({ multiples: true });

          form.parse(req, async (err, fields, files) => {
            if (err)
              return res
                .status(500)
                .send({ success: false, message: 'Form parse error' });

            if (!files.images) {
              return res
                .status(400)
                .send({ success: false, message: 'No images uploaded' });
            }

            const allFiles = Array.isArray(files.images)
              ? files.images
              : [files.images];
            const imageUrls = [];

            for (const file of allFiles) {
              if (!fs.existsSync(file.filepath)) {
                return res
                  .status(400)
                  .send({ success: false, message: 'File missing' });
              }

              const imgBuffer = fs.readFileSync(file.filepath);
              const base64 = imgBuffer.toString('base64');

              const formData = new URLSearchParams();
              formData.append('key', process.env.VITE_IMGBB_API);
              formData.append('image', base64);

              const uploadRes = await axios.post(
                'https://api.imgbb.com/1/upload',
                formData.toString(),
                {
                  headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                  },
                }
              );

              if (!uploadRes.data.success) {
                return res
                  .status(500)
                  .send({ success: false, message: 'Image upload failed' });
              }

              imageUrls.push(uploadRes.data.data.url);
            }
            const getField = value => (Array.isArray(value) ? value[0] : value);
            const product = {
              name: getField(fields.name),
              description: getField(fields.description),
              category: getField(fields.category),
              price: Number(getField(fields.price)),
              availableQuantity: Number(getField(fields.availableQuantity)),
              moq: Number(getField(fields.moq)),
              demoVideo: getField(fields.demoVideo) || '',
              managerEmail: getField(fields.managerEmail),
              paymentOption: getField(fields.paymentOption),

              showOnHome: getField(fields.showOnHome) === 'true',

              images: imageUrls,
              createdAt: new Date(),
            };

            const result = await productsCollection.insertOne(product);
            res.send({ success: true, id: result.insertedId });
          });
        } catch (error) {
          console.error('Product upload error:', error);
          res
            .status(500)
            .send({ success: false, message: 'Something went wrong' });
        }
      }
    );

    app.patch(
      '/api/products/:id',
      verifyFirebaseToken,
      verifyAdminOrManager,
      async (req, res) => {
        try {
          const { id } = req.params;

          const form = formidable({ multiples: true });

          form.parse(req, async (err, fields, files) => {
            if (err) {
              return res
                .status(500)
                .send({ success: false, message: 'Form parse error' });
            }

            const getField = v => (Array.isArray(v) ? v[0] : v);

            // Build update object
            const updateData = {
              name: getField(fields.name),
              description: getField(fields.description),
              category: getField(fields.category),
              price: Number(getField(fields.price)),
              availableQuantity: Number(getField(fields.availableQuantity)),
              moq: Number(getField(fields.moq)),
              paymentOption: getField(fields.paymentOption),
              demoVideo: getField(fields.demoVideo) || '',
              showOnHome: getField(fields.showOnHome) === 'true',
            };

            //  Upload only if new images exist
            if (files.images) {
              const allFiles = Array.isArray(files.images)
                ? files.images
                : [files.images];

              const uploadedImages = [];

              for (const file of allFiles) {
                const imgBuffer = fs.readFileSync(file.filepath);
                const base64 = imgBuffer.toString('base64');

                const formData = new URLSearchParams();
                formData.append('key', process.env.VITE_IMGBB_API);
                formData.append('image', base64);

                const uploadRes = await axios.post(
                  'https://api.imgbb.com/1/upload',
                  formData.toString(),
                  {
                    headers: {
                      'Content-Type': 'application/x-www-form-urlencoded',
                    },
                  }
                );

                uploadedImages.push(uploadRes.data.data.url);
              }

              updateData.images = uploadedImages;
            }

            const result = await productsCollection.updateOne(
              { _id: new ObjectId(id) },
              { $set: updateData }
            );

            res.send({ success: true, updated: result.modifiedCount > 0 });
          });
        } catch (error) {
          console.log(error);
          res.status(500).send({ success: false, message: 'Server error' });
        }
      }
    );

    app.delete(
      '/api/products/:id',
      verifyFirebaseToken,
      verifyAdminOrManager,
      async (req, res) => {
        try {
          const { id } = req.params;

          const result = await productsCollection.deleteOne({
            _id: new ObjectId(id),
          });
          res.send({ success: !!result.deletedCount });
        } catch (error) {
          res.status(500).send({ success: false });
        }
      }
    );
    // Toggle showOnHome by admin
    app.patch(
      '/api/products/:id/toggle-home',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { id } = req.params;
          const { showOnHome } = req.body;

          const result = await productsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { showOnHome: !!showOnHome } }
          );

          res.send({ success: true });
        } catch (error) {
          console.error('Toggle Home Error:', error);
          res.status(500).send({ success: false });
        }
      }
    );

    // only manager products
    app.get(
      '/api/manager/products',
      verifyFirebaseToken,
      verifyManager,
      async (req, res) => {
        try {
          const email = req.query.email;

          if (!email) {
            return res.status(400).json({ message: 'Email is required' });
          }

          if (req.decoded_email !== email) {
            return res.status(403).json({ message: 'Unauthorized access' });
          }

          const products = await productsCollection
            .find({ managerEmail: email })
            .sort({ createdAt: -1 })
            .toArray();

          const finalProducts = products.map(p => ({
            ...p,
            images: p.images?.map(
              img => `${req.protocol}://${req.get('host')}${img}`
            ),
          }));
          res.send(finalProducts);
        } catch (error) {
          res.status(500).send({ message: 'Internal server error' });
        }
      }
    );

    // Orders related API

    app.get(
      '/api/orders/details/:id',
      verifyFirebaseToken,
      verifyAdminOrManager,
      async (req, res) => {
        try {
          const { id } = req.params;
          const order = await ordersCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!order)
            return res
              .status(404)
              .send({ success: false, message: 'Order not found' });

          res.send({ success: true, order });
        } catch (error) {
          console.error(error);
          res.status(500).send({ success: false, message: 'Server error' });
        }
      }
    );

    // Get Pending Orders by Manager or Admin

    app.get(
      '/api/orders/pending',
      verifyFirebaseToken,
      verifyAdminOrManager,
      async (req, res) => {
        try {
          const pendingOrders = await ordersCollection
            .aggregate([
              {
                $addFields: {
                  latestStatus: { $arrayElemAt: ['$statusHistory.status', -1] },
                },
              },
              {
                $match: { latestStatus: 'pending' },
              },
              {
                $sort: { createdAt: -1 },
              },
            ])
            .toArray();

          res.send(pendingOrders);
        } catch (error) {
          console.error('Pending Orders Error:', error);
          res.status(500).send({ message: 'Failed to load pending orders' });
        }
      }
    );

    // GET: Approved Orders (Admin + Manager)
    app.get(
      '/api/orders/approved',
      verifyFirebaseToken,
      verifyAdminOrManager,
      async (req, res) => {
        try {
          const approvedOrders = await ordersCollection
            .aggregate([
              {
                $addFields: {
                  latestStatus: { $arrayElemAt: ['$statusHistory.status', -1] },
                },
              },
              {
                $match: { latestStatus: 'approved' },
              },
              { $sort: { createdAt: -1 } },
            ])
            .toArray();

          res.send(approvedOrders);
        } catch (error) {
          console.error('Approved Orders Error:', error);
          res.status(500).send({ message: 'Failed to load approved orders' });
        }
      }
    );

    // Order Tracking Timeline
    app.get(
      '/api/orders/:id/tracking',
      verifyFirebaseToken,
      verifyAdminOrManager,
      async (req, res) => {
        const { id } = req.params;

        try {
          const order = await ordersCollection.findOne(
            { _id: new ObjectId(id) },
            { projection: { tracking: 1, productName: 1, buyerEmail: 1 } }
          );

          if (!order) {
            return res.status(404).send({ message: 'Order not found' });
          }

          res.send(order);
        } catch (error) {
          console.error('Tracking Fetch Error:', error);
          res.status(500).send({ message: 'Failed to fetch tracking' });
        }
      }
    );

    // Add Tracking Update
    app.patch(
      '/api/orders/:id/tracking',
      verifyFirebaseToken,
      verifyAdminOrManager,
      async (req, res) => {
        const { id } = req.params;
        const { status, location, note } = req.body;

        try {
          const update = {
            status,
            location,
            note: note || '',
            date: new Date(),
          };

          const result = await ordersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $push: { tracking: update } }
          );

          res.send({ success: true, message: 'Tracking updated successfully' });
        } catch (error) {
          console.error('Add Tracking Error:', error);
          res
            .status(500)
            .send({ success: false, message: 'Failed to add tracking' });
        }
      }
    );

    // Approve Order by Manager or Admin
    app.patch(
      '/api/orders/:id/approve',
      verifyFirebaseToken,
      verifyAdminOrManager,
      async (req, res) => {
        try {
          const { id } = req.params;

          const order = await ordersCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!order) {
            return res
              .status(404)
              .send({ success: false, message: 'Order not found' });
          }

          const lastStatus =
            order.statusHistory[order.statusHistory.length - 1].status;

          if (lastStatus !== 'pending') {
            return res.status(400).send({
              success: false,
              message: 'Only pending orders can be approved',
            });
          }

          const result = await ordersCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $push: {
                statusHistory: { status: 'approved', date: new Date() },
              },
              $set: { approvedAt: new Date() },
            }
          );

          res.send({ success: true });
        } catch (error) {
          console.error('Approve order error:', error);
          res.status(500).send({ success: false, message: 'Server error' });
        }
      }
    );

    // Reject Order by Manager or Admin
    app.patch(
      '/api/orders/:id/reject',
      verifyFirebaseToken,
      verifyAdminOrManager,
      async (req, res) => {
        try {
          const { id } = req.params;

          const order = await ordersCollection.findOne({
            _id: new ObjectId(id),
          });

          if (!order) {
            return res
              .status(404)
              .send({ success: false, message: 'Order not found' });
          }

          const lastStatus =
            order.statusHistory[order.statusHistory.length - 1].status;

          if (lastStatus !== 'pending') {
            return res.status(400).send({
              success: false,
              message: 'Only pending orders can be rejected',
            });
          }

          const result = await ordersCollection.updateOne(
            { _id: new ObjectId(id) },
            {
              $push: {
                statusHistory: { status: 'rejected', date: new Date() },
              },
            }
          );

          res.send({ success: true });
        } catch (error) {
          console.error('Reject order error:', error);
          res.status(500).send({ success: false, message: 'Server error' });
        }
      }
    );

    // My orders for Buyer
    app.get('/api/orders/my-orders', verifyFirebaseToken, async (req, res) => {
      try {
        const userEmail = req.decoded_email;

        const orders = await ordersCollection
          .find({ buyerEmail: userEmail })
          .sort({ createdAt: -1 })
          .toArray();

        res.status(200).send({ success: true, orders });
      } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).send({ success: false, message: 'Server error' });
      }
    });
    // Get all orders - Admin only
    app.get(
      '/api/orders',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const { status, searchText } = req.query;
          const query = {};

          // Filter by status
          if (status && status !== 'All') {
            query.status = status.toLowerCase();
          }

          // Optional search
          if (searchText) {
            query.$or = [
              { buyerEmail: { $regex: searchText, $options: 'i' } },
              { productName: { $regex: searchText, $options: 'i' } },
              { trackingId: { $regex: searchText, $options: 'i' } },
            ];
          }

          const orders = await ordersCollection
            .find(query)
            .sort({ createdAt: -1 })
            .toArray();

          res.send({ success: true, orders });
        } catch (error) {
          console.error('Admin all orders error:', error);
          res.status(500).send({ success: false, message: 'Server error' });
        }
      }
    );

    app.post('/api/orders', verifyFirebaseToken, async (req, res) => {
      try {
        const userEmail = req.decoded_email;
        const {
          productId,
          firstName,
          lastName,
          quantity,
          contact,
          address,
          notes,
        } = req.body;

        // Fetch user
        const user = await usersCollection.findOne({ email: userEmail });
        if (!user || user.role === 'admin' || user.role === 'manager') {
          return res
            .status(403)
            .send({ message: 'Only buyers can place orders' });
        }

        // Fetch product
        const product = await productsCollection.findOne({
          _id: new ObjectId(productId),
        });
        if (!product)
          return res.status(404).send({ message: 'Product not found' });

        // Validate quantity
        if (quantity < product.moq) {
          return res
            .status(400)
            .send({ message: `Minimum order quantity is ${product.moq}` });
        }
        if (quantity > product.availableQuantity) {
          return res.status(400).send({
            message: `Maximum available quantity is ${product.availableQuantity}`,
          });
        }

        // Calculate order price
        const orderPrice = product.price * quantity;

        const newOrder = {
          buyerEmail: userEmail,
          productId: product._id,
          productName: product.name,
          quantity,
          pricePerUnit: product.price,
          orderPrice,
          firstName,
          lastName,
          contact,
          deliveryAddress: address,
          trackingId: nanoid(10).toUpperCase(),
          additionalNotes: notes || '',
          paymentOption: product.paymentOption,
          statusHistory: [{ status: 'pending', date: new Date() }],
          managerEmail: product.managerEmail,
          createdAt: new Date(),
        };

        // Save order
        const result = await ordersCollection.insertOne(newOrder);

        // Reduce product stock
        await productsCollection.updateOne(
          { _id: product._id },
          { $inc: { availableQuantity: -quantity } }
        );

        res.status(201).send({
          success: true,
          orderId: result.insertedId,
          trackingId: newOrder.trackingId,
        });
      } catch (error) {
        console.error('Order API Error:', error);
        res.status(500).send({ success: false, message: 'Server error' });
      }
    });
    // Cancel order
    app.delete('/api/orders/:id', verifyFirebaseToken, async (req, res) => {
      try {
        const orderId = req.params.id;

        const order = await ordersCollection.findOne({
          _id: new ObjectId(orderId),
        });
        if (!order) {
          return res
            .status(404)
            .send({ success: false, message: 'Order not found' });
        }

        // Get current status from statusHistory
        const lastStatus =
          order.statusHistory && order.statusHistory.length
            ? order.statusHistory[order.statusHistory.length - 1].status
            : 'pending';

        if (lastStatus !== 'pending') {
          return res
            .status(400)
            .send({ success: false, message: 'Order cannot be cancelled' });
        }

        // Update statusHistory to cancelled
        const result = await ordersCollection.updateOne(
          { _id: new ObjectId(orderId) },
          {
            $push: { statusHistory: { status: 'cancelled', date: new Date() } },
          }
        );

        if (result.modifiedCount === 1) {
          res.send({ success: true });
        } else {
          res
            .status(500)
            .send({ success: false, message: 'Failed to cancel order' });
        }
      } catch (error) {
        console.error(error);
        res.status(500).send({ success: false, message: 'Server error' });
      }
    });

    // Get order by ID for tracking
    app.get('/api/orders/track-by-id/:trackingId', async (req, res) => {
      try {
        const { trackingId } = req.params;

        const order = await ordersCollection.findOne({ trackingId });

        if (!order)
          return res
            .status(404)
            .send({ success: false, message: 'Order not found' });

        res.send({ success: true, order });
      } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, message: 'Server error' });
      }
    });
    // All Stats
    app.get(
      '/api/dashboard/admin/stats',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const now = new Date();

        // Helper to calculate date ranges
        const getDateRange = days =>
          new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

        const todayStart = new Date(now.setHours(0, 0, 0, 0));
        const weekStart = getDateRange(7);
        const monthStart = getDateRange(30);

        // Product Stats
        const productsToday = await productsCollection.countDocuments({
          createdAt: { $gte: todayStart },
        });
        const productsWeek = await productsCollection.countDocuments({
          createdAt: { $gte: weekStart },
        });
        const productsMonth = await productsCollection.countDocuments({
          createdAt: { $gte: monthStart },
        });

        // Orders This Month
        const ordersThisMonth = await ordersCollection.countDocuments({
          createdAt: { $gte: monthStart },
        });

        // Users
        const newUsers = await usersCollection.countDocuments({
          createdAt: { $gte: monthStart },
        });
        const totalUsers = await usersCollection.countDocuments();

        // Managers Active Count
        const activeManagers = await usersCollection.countDocuments({
          role: 'manager',
          status: 'active',
        });

        // Monthly Order Chart
        const monthlyOrders = await ordersCollection
          .aggregate([
            {
              $group: {
                _id: { $month: '$createdAt' },
                orders: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ])
          .toArray();

        const monthNames = [
          'Jan',
          'Feb',
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug',
          'Sep',
          'Oct',
          'Nov',
          'Dec',
        ];

        const formattedMonthly = monthlyOrders.map(m => ({
          month: monthNames[m._id - 1],
          orders: m.orders,
        }));

        res.send({
          productStats: {
            today: productsToday,
            week: productsWeek,
            month: productsMonth,
          },
          ordersThisMonth,
          users: {
            new: newUsers,
            total: totalUsers,
          },
          managersActive: activeManagers,
          monthlyOrders: formattedMonthly,
        });
      }
    );

    app.get(
      '/api/dashboard/manager/stats',
      verifyFirebaseToken,
      verifyManager,
      async (req, res) => {
        const email = req.query.email;

        const pendingOrders = await ordersCollection.countDocuments({
          managerEmail: email,
          status: 'pending',
        });

        const approvedOrders = await ordersCollection.countDocuments({
          managerEmail: email,
          status: 'approved',
        });

        res.send({ pendingOrders, approvedOrders });
      }
    );

    // Get buyer stats
    app.get(
      '/api/dashboard/buyer/stats',
      verifyFirebaseToken,
      async (req, res) => {
        try {
          const email = req.query.email;
          if (!email)
            return res.status(400).send({ message: 'Email is required' });

          const orderCount = await ordersCollection.countDocuments({
            buyerEmail: email,
          });

          res.send({ success: true, orderCount });
        } catch (error) {
          console.error(error);
          res
            .status(500)
            .send({ success: false, message: 'Failed to fetch stats' });
        }
      }
    );

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );
  } finally {
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send({
    message:
      "Welcome to Garments Flow API! Don't get lost in the code jungle 🐒",
  });
});
// app.use((req, res) => {
//   res.status(404).json({ message: 'Route not found' });
// });
// Start server
app.listen(port, () => console.log(`Server running on port ${port}`));

export default app;
