import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import app from '../src/app';
import connectDb from '../src/db/mongoose';

let mongoServer: MongoMemoryServer;
let businessToken: string;
let businessId: string;
let business2Token: string;
let business2Id: string;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    process.env.MONGO_URI = uri;
    process.env.DB_NAME = 'testdb';
    process.env.REWARDS_COLLECTION = 'rewards';
    await connectDb();
});

afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
    // Clear database between tests
    const collections = mongoose.connection.collections;
    for (const key in collections) {
        await collections[key].deleteMany({});
    }

    // Register and login business 1
    const agent = request(app as any);
    const registerRes1 = await agent.post('/business/register').send({
        name: 'Test Business',
        email: 'business1@test.com',
        password: 'password123',
    });
    businessToken = registerRes1.body.token;
    businessId = registerRes1.body.business.id;

    // Register and login business 2 (for authorization tests)
    const registerRes2 = await agent.post('/business/register').send({
        name: 'Test Business 2',
        email: 'business2@test.com',
        password: 'password123',
    });
    business2Token = registerRes2.body.token;
    business2Id = registerRes2.body.business.id;
});

describe('Rewards API - Points System', () => {
    it('should create a points-based reward system', async () => {
        const agent = request(app as any);
        const response = await agent
            .post('/rewards/points')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Sistema de Puntos',
                description: 'Gana puntos por cada compra',
                pointsConversion: {
                    amount: 10,
                    currency: 'MXN',
                    points: 1,
                },
                pointsRewards: [
                    {
                        pointsRequired: 100,
                        rewardType: 'discount',
                        rewardValue: 10,
                        description: '10% de descuento',
                    },
                ],
            });

        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty('id');
        expect(response.body.type).toBe('points');
        expect(response.body.name).toBe('Sistema de Puntos');
        expect(response.body.businessId).toBe(businessId);
        expect(response.body.pointsConversion).toEqual({
            amount: 10,
            currency: 'MXN',
            points: 1,
        });
        expect(response.body.pointsRewards).toHaveLength(1);
        expect(response.body.pointsRewards[0].pointsRequired).toBe(100);
    });

    it('should fail to create points reward without authentication', async () => {
        const agent = request(app as any);
        const response = await agent.post('/rewards/points').send({
            name: 'Sistema de Puntos',
            pointsConversion: {
                amount: 10,
                currency: 'MXN',
                points: 1,
            },
        });

        expect(response.status).toBe(401);
    });

    it('should fail to create points reward without required fields', async () => {
        const agent = request(app as any);
        const response = await agent
            .post('/rewards/points')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Sistema de Puntos',
                // missing pointsConversion
            });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('pointsConversion');
    });

    it('should list all reward systems for a business', async () => {
        const agent = request(app as any);

        // Create two reward systems
        await agent
            .post('/rewards/points')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Sistema 1',
                pointsConversion: { amount: 10, currency: 'MXN', points: 1 },
            });

        await agent
            .post('/rewards/points')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Sistema 2',
                pointsConversion: { amount: 20, currency: 'MXN', points: 2 },
            });

        const response = await agent
            .get('/rewards')
            .set('Authorization', `Bearer ${businessToken}`);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
        expect(response.body.length).toBe(2);
        expect(response.body[0].businessId).toBe(businessId);
        expect(response.body[1].businessId).toBe(businessId);
    });

    it('should get a specific reward system by ID', async () => {
        const agent = request(app as any);

        // Create a reward system
        const createResponse = await agent
            .post('/rewards/points')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Sistema de Puntos',
                pointsConversion: { amount: 10, currency: 'MXN', points: 1 },
            });

        const rewardId = createResponse.body.id;

        // Get the reward system
        const response = await agent
            .get(`/rewards/${rewardId}`)
            .set('Authorization', `Bearer ${businessToken}`);

        expect(response.status).toBe(200);
        expect(response.body.id).toBe(rewardId);
        expect(response.body.name).toBe('Sistema de Puntos');
    });

    it('should not allow accessing other business rewards', async () => {
        const agent = request(app as any);

        // Business 1 creates a reward
        const createResponse = await agent
            .post('/rewards/points')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Sistema de Puntos',
                pointsConversion: { amount: 10, currency: 'MXN', points: 1 },
            });

        const rewardId = createResponse.body.id;

        // Business 2 tries to access it
        const response = await agent
            .get(`/rewards/${rewardId}`)
            .set('Authorization', `Bearer ${business2Token}`);

        expect(response.status).toBe(404);
    });

    it('should update a points-based reward system', async () => {
        const agent = request(app as any);

        // Create a reward system
        const createResponse = await agent
            .post('/rewards/points')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Sistema de Puntos',
                pointsConversion: { amount: 10, currency: 'MXN', points: 1 },
            });

        const rewardId = createResponse.body.id;

        // Update it
        const updateResponse = await agent
            .put(`/rewards/points/${rewardId}`)
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Sistema Actualizado',
                pointsConversion: { amount: 20, currency: 'MXN', points: 2 },
            });

        expect(updateResponse.status).toBe(200);
        expect(updateResponse.body.name).toBe('Sistema Actualizado');
        expect(updateResponse.body.pointsConversion.points).toBe(2);
    });

    it('should delete a reward system (soft delete)', async () => {
        const agent = request(app as any);

        // Create a reward system
        const createResponse = await agent
            .post('/rewards/points')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Sistema de Puntos',
                pointsConversion: { amount: 10, currency: 'MXN', points: 1 },
            });

        const rewardId = createResponse.body.id;

        // Delete it
        const deleteResponse = await agent
            .delete(`/rewards/${rewardId}`)
            .set('Authorization', `Bearer ${businessToken}`);

        expect(deleteResponse.status).toBe(200);

        // Verify it's not returned in list (soft delete)
        const listResponse = await agent
            .get('/rewards')
            .set('Authorization', `Bearer ${businessToken}`);

        expect(listResponse.body.length).toBe(0);

        // Verify it's returned when including inactive
        const listInactiveResponse = await agent
            .get('/rewards?includeInactive=true')
            .set('Authorization', `Bearer ${businessToken}`);

        expect(listInactiveResponse.body.length).toBe(1);
        expect(listInactiveResponse.body[0].isActive).toBe(false);
    });
});

describe('Rewards API - Stamps System', () => {
    it('should create a stamps-based reward system', async () => {
        const agent = request(app as any);
        const response = await agent
            .post('/rewards/stamps')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Bebidas Gratis',
                description: '10 bebidas = 1 gratis',
                targetStamps: 10,
                productType: 'specific',
                productIdentifier: 'bebida_coca_cola',
                stampReward: {
                    rewardType: 'free_product',
                    rewardValue: 'bebida_coca_cola',
                    description: 'Bebida gratis',
                },
            });

        expect(response.status).toBe(201);
        expect(response.body).toHaveProperty('id');
        expect(response.body.type).toBe('stamps');
        expect(response.body.name).toBe('Bebidas Gratis');
        expect(response.body.businessId).toBe(businessId);
        expect(response.body.targetStamps).toBe(10);
        expect(response.body.productType).toBe('specific');
        expect(response.body.productIdentifier).toBe('bebida_coca_cola');
        expect(response.body.stampReward).toBeDefined();
        expect(response.body.stampReward.rewardType).toBe('free_product');
    });

    it('should create a stamps system with general product type', async () => {
        const agent = request(app as any);
        const response = await agent
            .post('/rewards/stamps')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Cualquier Bebida',
                targetStamps: 5,
                productType: 'general',
                stampReward: {
                    rewardType: 'discount',
                    rewardValue: 20,
                    description: '20% de descuento',
                },
            });

        expect(response.status).toBe(201);
        expect(response.body.productType).toBe('general');
        expect(response.body.productIdentifier).toBeUndefined();
    });

    it('should create a stamps system with any product type', async () => {
        const agent = request(app as any);
        const response = await agent
            .post('/rewards/stamps')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Cualquier Producto',
                targetStamps: 8,
                productType: 'any',
                stampReward: {
                    rewardType: 'coupon',
                    rewardValue: 'DESCUENTO20',
                    description: 'Cupón de descuento',
                },
            });

        expect(response.status).toBe(201);
        expect(response.body.productType).toBe('any');
    });

    it('should fail to create stamps reward without productIdentifier when productType is specific', async () => {
        const agent = request(app as any);
        const response = await agent
            .post('/rewards/stamps')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Bebidas Gratis',
                targetStamps: 10,
                productType: 'specific',
                // missing productIdentifier
                stampReward: {
                    rewardType: 'free_product',
                    rewardValue: 'bebida_coca_cola',
                    description: 'Bebida gratis',
                },
            });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('productIdentifier');
    });

    it('should update a stamps-based reward system', async () => {
        const agent = request(app as any);

        // Create a reward system
        const createResponse = await agent
            .post('/rewards/stamps')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Bebidas Gratis',
                targetStamps: 10,
                productType: 'specific',
                productIdentifier: 'bebida_coca_cola',
                stampReward: {
                    rewardType: 'free_product',
                    rewardValue: 'bebida_coca_cola',
                    description: 'Bebida gratis',
                },
            });

        const rewardId = createResponse.body.id;

        // Update it
        const updateResponse = await agent
            .put(`/rewards/stamps/${rewardId}`)
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Bebidas Actualizadas',
                targetStamps: 15,
            });

        expect(updateResponse.status).toBe(200);
        expect(updateResponse.body.name).toBe('Bebidas Actualizadas');
        expect(updateResponse.body.targetStamps).toBe(15);
    });
});

describe('Rewards API - Mixed Systems', () => {
    it('should list both points and stamps systems', async () => {
        const agent = request(app as any);

        // Create points system
        await agent
            .post('/rewards/points')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Sistema de Puntos',
                pointsConversion: { amount: 10, currency: 'MXN', points: 1 },
            });

        // Create stamps system
        await agent
            .post('/rewards/stamps')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                name: 'Sistema de Estampas',
                targetStamps: 10,
                productType: 'any',
                stampReward: {
                    rewardType: 'coupon',
                    rewardValue: 'CUPON10',
                    description: 'Cupón de descuento',
                },
            });

        const response = await agent
            .get('/rewards')
            .set('Authorization', `Bearer ${businessToken}`);

        expect(response.status).toBe(200);
        expect(response.body.length).toBe(2);
        expect(response.body.some((r: any) => r.type === 'points')).toBe(true);
        expect(response.body.some((r: any) => r.type === 'stamps')).toBe(true);
    });
});

