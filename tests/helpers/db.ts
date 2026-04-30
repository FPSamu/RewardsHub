import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

export const connectTestDb = async (): Promise<void> => {
    const uri = process.env.TEST_MONGO_URI;
    if (!uri) throw new Error('TEST_MONGO_URI is not set in .env');
    const dbName = process.env.TEST_DB_NAME;
    await mongoose.connect(uri, { ...(dbName && { dbName }) });
};

export const disconnectTestDb = async (): Promise<void> => {
    await mongoose.disconnect();
};
