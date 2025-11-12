import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import app from '../src/app';
import connectDb from '../src/db/mongoose';

let mongoServer: MongoMemoryServer;
let businessToken: string;
let businessId: string;
let userToken: string;
let userId: string;
let rewardSystemId: string;
let stampsRewardSystemId: string;

beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    process.env.MONGO_URI = uri;
    process.env.DB_NAME = 'testdb';
    process.env.REWARDS_COLLECTION = 'rewards';
    process.env.USERS_POINTS_COLLECTION = 'user_points';
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

    const agent = request(app as any);

    // Register and login business
    const businessRegisterRes = await agent.post('/business/register').send({
        name: 'Test Business',
        email: 'business@test.com',
        password: 'password123',
    });
    businessToken = businessRegisterRes.body.token;
    businessId = businessRegisterRes.body.business.id;

    // Register and login user
    const userRegisterRes = await agent.post('/auth/register').send({
        username: 'testuser',
        email: 'user@test.com',
        password: 'password123',
    });
    userToken = userRegisterRes.body.token;
    userId = userRegisterRes.body.user.id;

    // Create points reward system
    const pointsRewardRes = await agent
        .post('/rewards/points')
        .set('Authorization', `Bearer ${businessToken}`)
        .send({
            name: 'Sistema de Puntos',
            pointsConversion: {
                amount: 10,
                currency: 'MXN',
                points: 1,
            },
        });
    rewardSystemId = pointsRewardRes.body.id;

    // Create stamps reward system
    const stampsRewardRes = await agent
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
    stampsRewardSystemId = stampsRewardRes.body.id;
});

describe('UserPoints API - Add Points', () => {
    it('should add points to a user for a purchase', async () => {
        const agent = request(app as any);
        const response = await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId,
                purchaseAmount: 100,
            });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Points/stamps added successfully');
        expect(response.body.userPoints).toBeDefined();
        expect(response.body.userPoints.userId).toBe(userId);

        // Verify business was added
        const businessPoints = response.body.userPoints.businessPoints.find(
            (bp: any) => bp.businessId === businessId
        );
        expect(businessPoints).toBeDefined();
        expect(businessPoints.points).toBe(10); // 100 / 10 * 1 = 10 points
        expect(businessPoints.rewardSystems).toHaveLength(1);
        expect(businessPoints.rewardSystems[0].points).toBe(10);
    });

    it('should calculate points correctly based on conversion rate', async () => {
        const agent = request(app as any);

        // Purchase of 50 MXN with conversion 10 MXN = 1 point
        const response = await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId,
                purchaseAmount: 50,
            });

        expect(response.status).toBe(200);
        const businessPoints = response.body.userPoints.businessPoints.find(
            (bp: any) => bp.businessId === businessId
        );
        expect(businessPoints.points).toBe(5); // 50 / 10 * 1 = 5 points
    });

    it('should accumulate points for multiple purchases', async () => {
        const agent = request(app as any);

        // First purchase
        await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId,
                purchaseAmount: 100,
            });

        // Second purchase
        const response = await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId,
                purchaseAmount: 50,
            });

        expect(response.status).toBe(200);
        const businessPoints = response.body.userPoints.businessPoints.find(
            (bp: any) => bp.businessId === businessId
        );
        expect(businessPoints.points).toBe(15); // 10 + 5 = 15 points
        expect(businessPoints.rewardSystems[0].points).toBe(15);
    });

    it('should fail if user does not exist', async () => {
        const agent = request(app as any);
        const response = await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId: '507f1f77bcf86cd799439011', // Non-existent user ID
                rewardSystemId,
                purchaseAmount: 100,
            });

        expect(response.status).toBe(404);
        expect(response.body.message).toBe('user not found');
    });

    it('should fail if reward system does not exist', async () => {
        const agent = request(app as any);
        const response = await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId: '507f1f77bcf86cd799439011', // Non-existent reward system ID
                purchaseAmount: 100,
            });

        expect(response.status).toBe(404);
        expect(response.body.message).toBe('reward system not found or does not belong to this business');
    });

    it('should fail without authentication', async () => {
        const agent = request(app as any);
        const response = await agent.post('/user-points/add').send({
            userId,
            rewardSystemId,
            purchaseAmount: 100,
        });

        expect(response.status).toBe(401);
    });

    it('should fail without purchaseAmount for points system', async () => {
        const agent = request(app as any);
        const response = await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId,
            });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('purchaseAmount');
    });
});

describe('UserPoints API - Add Stamps', () => {
    it('should add stamps to a user', async () => {
        const agent = request(app as any);
        const response = await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId: stampsRewardSystemId,
                stampsCount: 3,
            });

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Points/stamps added successfully');

        const businessPoints = response.body.userPoints.businessPoints.find(
            (bp: any) => bp.businessId === businessId
        );
        expect(businessPoints).toBeDefined();
        expect(businessPoints.stamps).toBe(3);
        expect(businessPoints.rewardSystems[0].stamps).toBe(3);
    });

    it('should accumulate stamps for multiple purchases', async () => {
        const agent = request(app as any);

        // First purchase
        await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId: stampsRewardSystemId,
                stampsCount: 3,
            });

        // Second purchase
        const response = await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId: stampsRewardSystemId,
                stampsCount: 2,
            });

        expect(response.status).toBe(200);
        const businessPoints = response.body.userPoints.businessPoints.find(
            (bp: any) => bp.businessId === businessId
        );
        expect(businessPoints.stamps).toBe(5); // 3 + 2 = 5 stamps
        expect(businessPoints.rewardSystems[0].stamps).toBe(5);
    });

    it('should fail without stampsCount for stamps system', async () => {
        const agent = request(app as any);
        const response = await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId: stampsRewardSystemId,
            });

        expect(response.status).toBe(400);
        expect(response.body.message).toContain('stampsCount');
    });
});

describe('UserPoints API - Multiple Reward Systems', () => {
    it('should handle multiple reward systems for the same business', async () => {
        const agent = request(app as any);

        // Add points
        await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId,
                purchaseAmount: 100,
            });

        // Add stamps
        const response = await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId: stampsRewardSystemId,
                stampsCount: 5,
            });

        expect(response.status).toBe(200);
        const businessPoints = response.body.userPoints.businessPoints.find(
            (bp: any) => bp.businessId === businessId
        );
        expect(businessPoints.points).toBe(10);
        expect(businessPoints.stamps).toBe(5);
        expect(businessPoints.rewardSystems).toHaveLength(2);
    });
});

describe('UserPoints API - Get User Points', () => {
    it('should get user points for authenticated user', async () => {
        const agent = request(app as any);

        // Add points first
        await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId,
                purchaseAmount: 100,
            });

        // Get user points
        const response = await agent
            .get('/user-points')
            .set('Authorization', `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.userId).toBe(userId);
        expect(response.body.businessPoints).toHaveLength(1);
        expect(response.body.businessPoints[0].points).toBe(10);
    });

    it('should return empty array if user has no points', async () => {
        const agent = request(app as any);
        const response = await agent
            .get('/user-points')
            .set('Authorization', `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.businessPoints).toEqual([]);
        expect(response.body.message).toBe('No points/stamps found for this user');
    });

    it('should fail without authentication', async () => {
        const agent = request(app as any);
        const response = await agent.get('/user-points');

        expect(response.status).toBe(401);
    });
});

describe('UserPoints API - Get User Points for Business', () => {
    it('should get user points for a specific business', async () => {
        const agent = request(app as any);

        // Add points first
        await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId,
                purchaseAmount: 100,
            });

        // Get user points for business
        const response = await agent
            .get(`/user-points/${userId}`)
            .set('Authorization', `Bearer ${businessToken}`);

        expect(response.status).toBe(200);
        expect(response.body.businessId).toBe(businessId);
        expect(response.body.points).toBe(10);
        expect(response.body.rewardSystems).toHaveLength(1);
    });

    it('should return default values if user has not visited business', async () => {
        const agent = request(app as any);
        const response = await agent
            .get(`/user-points/${userId}`)
            .set('Authorization', `Bearer ${businessToken}`);

        expect(response.status).toBe(200);
        expect(response.body.points).toBe(0);
        expect(response.body.stamps).toBe(0);
        expect(response.body.rewardSystems).toEqual([]);
        expect(response.body.message).toBe('User has not visited this business yet');
    });

    it('should fail without authentication', async () => {
        const agent = request(app as any);
        const response = await agent.get(`/user-points/${userId}`);

        expect(response.status).toBe(401);
    });
});

describe('UserPoints API - Get User Points for Business (User)', () => {
    it('should get user points for a specific business as authenticated user', async () => {
        const agent = request(app as any);

        // Add points first
        await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId,
                purchaseAmount: 100,
            });

        // Get user points for business as user
        const response = await agent
            .get(`/user-points/business/${businessId}`)
            .set('Authorization', `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.businessId).toBe(businessId);
        expect(response.body.points).toBe(10);
        expect(response.body.rewardSystems).toHaveLength(1);
        expect(response.body.rewardSystems[0].points).toBe(10);
    });

    it('should return default values if user has not visited business', async () => {
        const agent = request(app as any);
        const response = await agent
            .get(`/user-points/business/${businessId}`)
            .set('Authorization', `Bearer ${userToken}`);

        expect(response.status).toBe(200);
        expect(response.body.userId).toBe(userId);
        expect(response.body.businessId).toBe(businessId);
        expect(response.body.points).toBe(0);
        expect(response.body.stamps).toBe(0);
        expect(response.body.rewardSystems).toEqual([]);
        expect(response.body.lastVisit).toBeNull();
        expect(response.body.message).toBe('You have not visited this business yet');
    });

    it('should fail without authentication', async () => {
        const agent = request(app as any);
        const response = await agent.get(`/user-points/business/${businessId}`);

        expect(response.status).toBe(401);
    });

    it('should fail with invalid businessId', async () => {
        const agent = request(app as any);
        // Test with a valid format but non-existent businessId
        const response = await agent
            .get('/user-points/business/507f1f77bcf86cd799439011')
            .set('Authorization', `Bearer ${userToken}`);

        // Should return 200 with default values since user hasn't visited that business
        expect(response.status).toBe(200);
        expect(response.body.points).toBe(0);
        expect(response.body.stamps).toBe(0);
        expect(response.body.message).toBe('You have not visited this business yet');
    });
});

describe('UserPoints API - Edge Cases', () => {
    it('should handle purchase amount that results in zero points', async () => {
        const agent = request(app as any);

        // Purchase of 5 MXN with conversion 10 MXN = 1 point (should be 0 points)
        const response = await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId,
                purchaseAmount: 5,
            });

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('No points or stamps to add');
    });

    it('should update lastVisit timestamp on each purchase', async () => {
        const agent = request(app as any);

        // First purchase
        const firstResponse = await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId,
                purchaseAmount: 100,
            });

        const firstLastVisit = firstResponse.body.userPoints.businessPoints[0].lastVisit;

        // Wait a bit and make second purchase
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const secondResponse = await agent
            .post('/user-points/add')
            .set('Authorization', `Bearer ${businessToken}`)
            .send({
                userId,
                rewardSystemId,
                purchaseAmount: 50,
            });

        const secondLastVisit = secondResponse.body.userPoints.businessPoints[0].lastVisit;

        expect(new Date(secondLastVisit).getTime()).toBeGreaterThan(new Date(firstLastVisit).getTime());
    });
});

