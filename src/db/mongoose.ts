import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGO_URI;
const dbName = process.env.DB_NAME;

export const connectDb = async (): Promise<void> => {
    if (!uri) {
        console.warn('MONGO_URI not set, skipping MongoDB connection');
        return;
    }
    try {
        // connect with a default dbName to avoid relying on connection string
        await mongoose.connect(uri, { dbName });
        console.log('Connected to MongoDB');
    } catch (err) {
        console.error('MongoDB connection error:', err);
        throw err;
    }
};

export default connectDb;
