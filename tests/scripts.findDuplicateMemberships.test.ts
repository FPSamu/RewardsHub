/**
 * P1.3 — scripts/find-duplicate-memberships.ts: lista (sin modificar nada) las
 * membresías activas duplicadas que impedirían construir el índice único parcial.
 */
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ClientMembershipModel } from '../src/models/clientMembership.model';
import { findDuplicateActiveMemberships } from '../scripts/find-duplicate-memberships';

let mongod: MongoMemoryServer;

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    // autoIndex apagado: simula una base vieja donde el índice nuevo aún no existe
    await mongoose.connect(mongod.getUri(), { dbName: 'dup-memberships-test', autoIndex: false });
}, 120_000);

afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

const membership = (userId: Types.ObjectId, planId: Types.ObjectId, status = 'active', endInDays = 10) => ({
    userId, planId, businessId: new Types.ObjectId(), activatedByBusinessId: new Types.ObjectId(),
    planSnapshot: { name: 'Plan', benefit: 'x', durationDays: 30, price: 1 },
    startDate: new Date(), endDate: new Date(Date.now() + endInDays * 86400_000), status,
    lastRedeemedDate: null, activatedAt: new Date(),
});

it('agrupa solo los duplicados activos (mismo cliente + plan) y no escribe nada', async () => {
    const [u1, u2, p1, p2] = [0, 1, 2, 3].map(() => new Types.ObjectId());
    await ClientMembershipModel.collection.insertMany([
        membership(u1, p1, 'active', 5),
        membership(u1, p1, 'active', 20), // duplicado de la anterior
        membership(u1, p2),               // otro plan: no cuenta
        membership(u2, p1),
        membership(u2, p1, 'expired'),    // vencida: el índice parcial la ignora
    ]);
    const before = await ClientMembershipModel.collection.find().toArray();

    const groups = await findDuplicateActiveMemberships();

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ userId: u1.toString(), planId: p1.toString(), count: 2 });
    // la primera es la que vence más tarde (la que normalmente se conserva)
    expect(groups[0].memberships[0].endDate.getTime()).toBeGreaterThan(groups[0].memberships[1].endDate.getTime());
    expect(await ClientMembershipModel.collection.find().toArray()).toEqual(before);
    expect((await ClientMembershipModel.collection.indexes()).map((i) => i.name)).not.toContain('uniq_active_plan_per_user');
});
