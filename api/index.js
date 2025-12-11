import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import formidable from 'formidable';
import axios from 'axios';
import fs from 'fs';
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

    // users related API
    // get all users by admin
    app.get(
      '/api/users',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const searchText = req.query.searchText;
        const query = {};
        if (searchText) {
          query.$or = [
            { displayName: { $regex: searchText, $options: 'i' } },
            { email: { $regex: searchText, $options: 'i' } },
          ];
        }

        const cursor = usersCollection.find(query).sort({ createdAt: -1 });
        const result = await cursor.toArray();
        res.send(result);
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
    // update user profile
    app.patch(
      '/api/users/:email/update-profile',
      verifyFirebaseToken,
      // uploadMemory.single('photo'),
      async (req, res) => {
        try {
          const { email } = req.params;
          const { displayName } = req.body;

          let photoURL;

          if (req.file) {
            const imgbbApiKey = process.env.VITE_IMGBB_API;
            const formData = new URLSearchParams();
            formData.append('key', imgbbApiKey);
            formData.append('image', req.file.buffer.toString('base64'));

            const imgbbRes = await fetch('https://api.imgbb.com/1/upload', {
              method: 'POST',
              body: formData,
            });

            const imgbbData = await imgbbRes.json();
            if (imgbbData.success) {
              photoURL = imgbbData.data.url;
            } else {
              throw new Error('Image upload failed');
            }
          }

          const updateData = { displayName };
          if (photoURL) updateData.photoURL = photoURL;

          const result = await usersCollection.updateOne(
            { email },
            { $set: updateData }
          );

          const updatedUser = await usersCollection.findOne({ email });

          res.send({
            success: true,
            message: 'Profile updated successfully!',
            photoURL: updatedUser.photoURL,
            user: updatedUser,
          });
        } catch (error) {
          console.error(error);
          res.status(500).send({
            success: false,
            message: 'Server error!',
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
        const cursor = productsCollection.find({}).sort({ createdAt: -1 });
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: 'Something wen wrong' });
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
      verifyManager,
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
      verifyManager,
      // upload.array('images', 10),
      async (req, res) => {
        try {
          const { id } = req.params;

          const updateData = {
            name: req.body.name,
            description: req.body.description,
            category: req.body.category,
            price: Number(req.body.price),
            availableQuantity: Number(req.body.availableQuantity),
            moq: Number(req.body.moq),
            paymentOption: req.body.paymentOption,
            showOnHome:
              req.body.showOnHome === 'true' || req.body.showOnHome === true,
            demoVideo: req.body.demoVideo || '',
          };
          if (req.files && req.files.length > 0) {
            updateData.images = req.files.map(f => `/uploads/${f.filename}`);
          }
          const result = await productsCollection.updateOne(
            {
              _id: new ObjectId(id),
            },
            { $set: updateData }
          );
          res.send({ success: true });
        } catch (error) {
          console.log(error);
          res.status(500).send({ success: false });
        }
      }
    );
    app.delete(
      '/api/products/:id',
      verifyFirebaseToken,
      verifyManager,
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

        res.status(201).send({ success: true, orderId: result.insertedId });
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

    // All Stats
    app.get(
      '/dashboard/admin/stats',
      verifyFirebaseToken,
      verifyAdmin,
      async (req, res) => {
        const totalProducts = await productsCollection.countDocuments();
        const totalUsers = await usersCollection.countDocuments();
        const totalOrders = await ordersCollection.countDocuments();

        res.send({ totalProducts, totalUsers, totalOrders });
      }
    );
    app.get(
      '/dashboard/manager/stats',
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

    app.get('/dashboard/buyer/stats', verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;

      const orderCount = await ordersCollection.countDocuments({
        buyerEmail: email,
      });

      res.send({ orderCount });
    });

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
