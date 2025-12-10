import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import multer, { memoryStorage } from 'multer';
import path from 'path';
import fs from 'fs';
import admin from 'firebase-admin';
import { MongoClient, ServerApiVersion, ObjectId } from 'mongodb';
import serverless from 'serverless-http';

// Create uploads folder if missing
// if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const unique =
      Date.now() + '-' + Math.random() + path.extname(file.originalname);
    cb(null, unique);
  },
});
export const upload = multer({ storage });
export const uploadMemory = multer({ storage: multer.memoryStorage() });
const app = express();

// uploads
app.use('/uploads', express.static('uploads'));

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
      uploadMemory.single('photo'),
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
      uploadMemory.array('images', 10),
      async (req, res) => {
        try {
          const imageUrls = req.files.map(f => `/uploads/${f.filename}`);

          const product = {
            name: req.body.name,
            description: req.body.description,
            category: req.body.category,
            price: Number(req.body.price),
            availableQuantity: Number(req.body.availableQuantity),
            moq: Number(req.body.moq),
            demoVideo: req.body.demoVideo || ' ',
            managerEmail: req.body.managerEmail,
            paymentOption: req.body.paymentOption,
            showOnHome:
              req.body.showOnHome === 'true' || req.body.showOnHome === true,
            images: imageUrls,
            createdAt: new Date(),
          };
          const result = await productsCollection.insertOne(product);

          res.send({ success: true, id: result.insertedId });
        } catch (error) {
          console.log(error);
          res.status(500).send({ success: false });
        }
      }
    );
    app.patch(
      '/api/products/:id',
      verifyFirebaseToken,
      verifyManager,
      upload.array('images', 10),
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

    // Send a ping to confirm a successful connection
    // await client.db('admin').command({ ping: 1 });
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
// app.listen(port, () => console.log(`Server running on port ${port}`));
export const handler = serverless(app);
