import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';

const app = express();

import { MongoClient, ServerApiVersion, ObjectId } from 'mongodb';
const port = process.env.PORT || 5000;

// Generate the tracking ID

// Firebase Service Key
import admin from 'firebase-admin';

const decoded = Buffer.from(process.env.SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// Middlewares
app.use(cors());
app.use(express.json());

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

    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 });
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    );
  } finally {
  }
}
run().catch(console.dir);

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});
app.get('/', (req, res) => {
  res.send({
    message:
      "Welcome to Garments Flow API! Don't get lost in the code jungle 🐒",
  });
});

// Start server
app.listen(port, () => console.log(`Server running on port ${port}`));
