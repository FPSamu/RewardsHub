/**
 * P1.5 / P1.6 — webhook de Stripe: deduplicación por event.id y orden de eventos.
 *
 * Firma real con la librería de Stripe (sin red): los eventos usados aquí
 * (subscription.updated/deleted, checkout lifetime) no llaman a la API.
 */
import { TEST_WEBHOOK_SECRET } from './helpers/stripeEnv';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';
import Stripe from 'stripe';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app';
import { StripeEventModel } from '../src/models/stripeEvent.model';
import { SubscriptionModel } from '../src/models/subscription.model';
import { BusinessModel } from '../src/models/business.model';
import * as subscriptionService from '../src/services/subscription.service';

const stripe = new Stripe('sk_test_dummy');
let mongod: MongoMemoryServer;

beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(), { dbName: 'stripe-webhook-test' });
    await StripeEventModel.init();
}, 120_000);

afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
});

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([StripeEventModel.deleteMany({}), SubscriptionModel.deleteMany({}), BusinessModel.deleteMany({})]);
});

const seed = async () => {
    const business = await BusinessModel.create({
        username: 'Negocio Stripe', email: `s-${new Types.ObjectId()}@test.com`, passHash: 'x', status: 'active', isVerified: true,
    });
    const sub = await SubscriptionModel.create({
        businessId: business._id, stripeCustomerId: `cus_${new Types.ObjectId()}`,
        stripeSubscriptionId: `sub_${new Types.ObjectId()}`, planType: 'monthly', membershipStatus: 'active',
    });
    return { business, sub };
};

let seq = 0;
const subscriptionEvent = (
    type: 'customer.subscription.updated' | 'customer.subscription.deleted',
    subscriptionId: string,
    status: string,
    createdSec: number,
    id = `evt_${++seq}_${Date.now()}`,
) => ({
    id, object: 'event', type, created: createdSec, livemode: false, api_version: '2026-02-25.clover',
    pending_webhooks: 1, request: { id: null, idempotency_key: null },
    data: { object: { id: subscriptionId, object: 'subscription', status, cancel_at_period_end: false, items: { data: [] } } },
});

const send = (event: object, secret = TEST_WEBHOOK_SECRET) => {
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
    return request(app).post('/webhooks/stripe')
        .set('Content-Type', 'application/json').set('stripe-signature', signature).send(payload);
};

const now = () => Math.floor(Date.now() / 1000);

describe('deduplicación por event.id', () => {
    it('el mismo evento dos veces: efectos una sola vez, el segundo responde duplicate', async () => {
        const { sub } = await seed();
        const spy = jest.spyOn(subscriptionService, 'updateSubscriptionStatus');
        const event = subscriptionEvent('customer.subscription.updated', sub.stripeSubscriptionId!, 'past_due', now());

        const first = await send(event);
        const second = await send(event);

        expect(first.status).toBe(200);
        expect(first.body).toEqual({ received: true });
        expect(second.status).toBe(200);
        expect(second.body).toEqual({ received: true, duplicate: true });
        expect(spy).toHaveBeenCalledTimes(1);
        expect((await StripeEventModel.findById(event.id).lean())!.status).toBe('processed');
        expect((await SubscriptionModel.findById(sub._id).lean())!.membershipStatus).toBe('past_due');
    });

    it('dos entregas simultáneas del mismo evento: se procesa una sola vez', async () => {
        const { business } = await seed();
        const spy = jest.spyOn(subscriptionService, 'activateSubscription');
        const event = {
            id: `evt_checkout_${Date.now()}`, object: 'event', type: 'checkout.session.completed', created: now(),
            livemode: false, api_version: '2026-02-25.clover', pending_webhooks: 1, request: { id: null, idempotency_key: null },
            data: { object: { object: 'checkout.session', payment_status: 'paid', subscription: null,
                metadata: { businessId: business.id, planType: 'lifetime_access' } } },
        };

        const responses = await Promise.all([send(event), send(event), send(event)]);

        expect(spy).toHaveBeenCalledTimes(1);
        for (const r of responses) {
            expect([200, 409]).toContain(r.status);
            if (r.status === 409) expect(r.body).toEqual({ error: 'Event is being processed' });
        }
        expect(responses.filter((r) => r.status === 200 && !r.body.duplicate)).toHaveLength(1);
    });

    it('si el procesamiento falla, libera el event.id y la reentrega de Stripe sí se procesa', async () => {
        const { sub } = await seed();
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const spy = jest.spyOn(subscriptionService, 'updateSubscriptionStatus').mockRejectedValueOnce(new Error('mongo caído'));
        const event = subscriptionEvent('customer.subscription.updated', sub.stripeSubscriptionId!, 'past_due', now());

        const failed = await send(event);
        expect(failed.status).toBe(500);
        expect(failed.body).toEqual({ error: 'Webhook processing failed' });
        expect(await StripeEventModel.countDocuments()).toBe(0);

        const retried = await send(event);
        expect(retried.status).toBe(200);
        expect(retried.body).toEqual({ received: true });
        expect(spy).toHaveBeenCalledTimes(2);
        expect((await SubscriptionModel.findById(sub._id).lean())!.membershipStatus).toBe('past_due');
    });

    it('"processing" reciente → 409; abandonado hace más de 5 min → se retoma', async () => {
        const { sub } = await seed();
        const event = subscriptionEvent('customer.subscription.updated', sub.stripeSubscriptionId!, 'past_due', now());

        await StripeEventModel.create({ _id: event.id, type: event.type, status: 'processing', receivedAt: new Date() });
        const busy = await send(event);
        expect(busy.status).toBe(409);

        await StripeEventModel.updateOne({ _id: event.id }, { $set: { receivedAt: new Date(Date.now() - 10 * 60_000) } });
        const taken = await send(event);
        expect(taken.status).toBe(200);
        expect(taken.body).toEqual({ received: true });
        expect((await StripeEventModel.findById(event.id).lean())!.status).toBe('processed');
    });

    it('firma inválida sigue respondiendo 400 en texto, sin registrar nada', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const res = await send(subscriptionEvent('customer.subscription.updated', 'sub_x', 'active', now()), 'whsec_otro');
        expect(res.status).toBe(400);
        expect(res.text).toMatch(/^Webhook Error: /);
        expect(await StripeEventModel.countDocuments()).toBe(0);
    });

    it('los eventos se borran solos a los 30 días (TTL)', async () => {
        const indexes = await StripeEventModel.collection.indexes();
        expect(indexes.find((i) => i.key.receivedAt === 1)?.expireAfterSeconds).toBe(30 * 24 * 3600);
    });

    it('subscriptions tiene índice por stripeSubscriptionId (lo usa cada evento)', async () => {
        await SubscriptionModel.init();
        const indexes = await SubscriptionModel.collection.indexes();
        expect(indexes.find((i) => i.key.stripeSubscriptionId === 1)?.sparse).toBe(true);
    });
});

describe('orden de eventos', () => {
    it('un "updated" más viejo que el último aplicado se ignora', async () => {
        const { sub } = await seed();
        const t = now();

        expect((await send(subscriptionEvent('customer.subscription.updated', sub.stripeSubscriptionId!, 'past_due', t))).status).toBe(200);
        // llega tarde un evento de antes, que decía "active"
        expect((await send(subscriptionEvent('customer.subscription.updated', sub.stripeSubscriptionId!, 'active', t - 60))).status).toBe(200);

        const doc = await SubscriptionModel.findById(sub._id).lean();
        expect(doc!.membershipStatus).toBe('past_due');
        expect(doc!.lastStripeEventAt!.getTime()).toBe(t * 1000);
    });

    it('un evento con la misma fecha o más nuevo sí se aplica', async () => {
        const { sub } = await seed();
        const t = now();
        await send(subscriptionEvent('customer.subscription.updated', sub.stripeSubscriptionId!, 'past_due', t));
        await send(subscriptionEvent('customer.subscription.updated', sub.stripeSubscriptionId!, 'active', t));
        expect((await SubscriptionModel.findById(sub._id).lean())!.membershipStatus).toBe('active');
        await send(subscriptionEvent('customer.subscription.updated', sub.stripeSubscriptionId!, 'past_due', t + 5));
        expect((await SubscriptionModel.findById(sub._id).lean())!.membershipStatus).toBe('past_due');
    });

    it('un "updated" viejo que llega después de "deleted" no revive la suscripción', async () => {
        const { business, sub } = await seed();
        const t = now();

        await send(subscriptionEvent('customer.subscription.deleted', sub.stripeSubscriptionId!, 'canceled', t));
        await send(subscriptionEvent('customer.subscription.updated', sub.stripeSubscriptionId!, 'active', t - 30));

        expect((await SubscriptionModel.findById(sub._id).lean())!.membershipStatus).toBe('canceled');
        expect((await BusinessModel.findById(business._id).lean())!.status).toBe('inactive');
    });

    it('"deleted" se aplica aunque sea más viejo que el último evento, sin retroceder lastStripeEventAt', async () => {
        const { sub } = await seed();
        const t = now();
        await send(subscriptionEvent('customer.subscription.updated', sub.stripeSubscriptionId!, 'active', t));
        await send(subscriptionEvent('customer.subscription.deleted', sub.stripeSubscriptionId!, 'canceled', t - 10));

        const doc = await SubscriptionModel.findById(sub._id).lean();
        expect(doc!.membershipStatus).toBe('canceled');
        expect(doc!.lastStripeEventAt!.getTime()).toBe(t * 1000);
    });

    it('sin eventCreatedAt, updateSubscriptionStatus se comporta como antes', async () => {
        const { sub } = await seed();
        await SubscriptionModel.updateOne({ _id: sub._id }, { $set: { lastStripeEventAt: new Date(Date.now() + 3600_000) } });
        const updated = await subscriptionService.updateSubscriptionStatus(sub.stripeSubscriptionId!, 'past_due');
        expect(updated!.membershipStatus).toBe('past_due');
    });
});
