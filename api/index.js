import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import admin from 'firebase-admin';
import { MongoClient, ServerApiVersion, ObjectId } from 'mongodb';

// Create uploads folder if missing
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');

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
        return res.staus(403).send({ message: 'Forbidden Access' });
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
    app.get('/api/users/:email/role', verifyFirebaseToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await usersCollection.findOne(query);
      res.send({ role: user?.role || 'buyer' });
    });
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
    app.post(
      '/api/products',
      verifyFirebaseToken,
      verifyManager,
      upload.array('images', 10),
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
            demoVideo: req.body.demoVideo || null,
            paymentOption: req.body.paymentOption,
            showOnHome: req.body.showOnHome === 'true',
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
