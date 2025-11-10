import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import app from '../src/app';
import connectDb from '../src/db/mongoose';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    process.env.MONGO_URI = uri;
    process.env.DB_NAME = 'testdb';
    await connectDb();
});

afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
});

afterEach(async () => {
    // Clear database between tests
    const collections = mongoose.connection.collections;
    for (const key in collections) {
        await collections[key].deleteMany({});
    }
});

describe('User auth (register/login)', () => {
    it('registers and logs in a user', async () => {
        const agent = request(app as any);
        const email = 'user1@example.com';

        const registerRes = await agent.post('/auth/register').send({ username: 'user1', email, password: 'pass123' });
        expect(registerRes.status).toBe(201);
        expect(registerRes.body).toHaveProperty('token');
        expect(registerRes.body).toHaveProperty('refreshToken');
        expect(registerRes.body.user.email).toBe(email);

        const loginRes = await agent.post('/auth/login').send({ email, password: 'pass123' });
        expect(loginRes.status).toBe(200);
        expect(loginRes.body).toHaveProperty('token');
        expect(loginRes.body).toHaveProperty('refreshToken');
    });
});

describe('Business auth (register/login)', () => {
    it('registers and logs in a business', async () => {
        const agent = request(app as any);
        const email = 'biz1@example.com';

        const registerRes = await agent.post('/business/register').send({ name: 'Biz1', email, password: 'bizpass' });
        expect(registerRes.status).toBe(201);
        expect(registerRes.body).toHaveProperty('token');
        expect(registerRes.body).toHaveProperty('refreshToken');
        expect(registerRes.body.business.email).toBe(email);

        const loginRes = await agent.post('/business/login').send({ email, password: 'bizpass' });
        expect(loginRes.status).toBe(200);
        expect(loginRes.body).toHaveProperty('token');
        expect(loginRes.body).toHaveProperty('refreshToken');
    });
});
