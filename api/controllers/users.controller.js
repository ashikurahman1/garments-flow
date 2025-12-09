import { getDB } from '../config/db.js';

export const getUsers = async (req, res) => {
  try {
    const users = await getDB.collection('users').find().toArray();
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
};
