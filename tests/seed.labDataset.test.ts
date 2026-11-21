/**
 * P0.3 — seed del lab.
 *
 * - El dataset es consistente: saldos de userpoints == Σ del ledger, totales
 *   por negocio == Σ de sus sistemas, nunca negativos, canjes con recompensas
 *   que existen. Es lo que permite que la conciliación (P3.3) arranque en 0.
 * - El writer se niega a escribir en una base que no es de lab, no duplica
 *   datos sin --reset y --reset regenera.
 *
 * Todo corre sobre MongoDB en memoria.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { generateLabDataset, SEED_EMAIL_DOMAIN } from '../src/db/seed/labDataset';
import { writeLabDataset, SeedAlreadyPresentError } from '../src/db/seed/writeLabDataset';
import { ProductionDbError } from '../src/db/safety';
import { BusinessModel } from '../src/models/business.model';
import { TransactionModel } from '../src/models/transaction.model';
import { UserPointsModel } from '../src/models/userPoints.model';
import { parseArgs } from '../scripts/seed-lab';

const SMALL = { seed: 7, businesses: 6, users: 60, transactions: 3000, days: 30, now: new Date('2026-11-20T12:00:00Z') };

describe('generateLabDataset — consistencia', () => {
    const data = generateLabDataset(SMALL);

    it('con adminPinHash, los negocios lo traen (PIN de administrador sin correo); sin él, no', () => {
        const withPin = generateLabDataset({ ...SMALL, businesses: 2, users: 2, transactions: 5, adminPinHash: 'hash-pin' });
        expect(withPin.businesses.every((b) => b.adminPinHash === 'hash-pin' && b.isAdminPinTemporary === false)).toBe(true);
        expect(data.businesses.every((b) => b.adminPinHash === undefined)).toBe(true);
    });

    it('genera los volúmenes pedidos, solo con correos sintéticos', () => {
        expect(data.businesses).toHaveLength(6);
        expect(data.users).toHaveLength(60);
        expect(data.transactions).toHaveLength(3000);
        for (const doc of [...data.businesses, ...data.users]) {
            expect(doc.email.endsWith(`@${SEED_EMAIL_DOMAIN}`)).toBe(true);
        }
        for (const b of data.businesses) {
            expect(b.locations.length).toBeGreaterThanOrEqual(1);
            expect(b.locations.length).toBeLessThanOrEqual(3);
            expect(b.locations.filter((l: any) => l.isMain)).toHaveLength(1);
            for (const l of b.locations) {
                expect(l.geo).toEqual({ type: 'Point', coordinates: [l.longitude, l.latitude] });
            }
        }
    });

    it('incluye todos los tipos de transacción y queda dentro del rango de fechas', () => {
        const types = new Set(data.transactions.map((t) => t.type));
        expect(types).toEqual(new Set(['add', 'subtract', 'redeem']));
        const from = SMALL.now.getTime() - SMALL.days * 24 * 3600 * 1000;
        for (const t of data.transactions) {
            expect(t.createdAt.getTime()).toBeGreaterThanOrEqual(from);
            expect(t.createdAt.getTime()).toBeLessThanOrEqual(SMALL.now.getTime());
        }
    });

    it('los saldos de userpoints son exactamente Σ del ledger por (usuario, negocio, sistema)', () => {
        const ledger = new Map<string, { points: number; stamps: number }>();
        for (const t of data.transactions) {
            for (const it of t.items) {
                const key = `${t.userId}|${t.businessId}|${it.rewardSystemId}`;
                const cur = ledger.get(key) ?? { points: 0, stamps: 0 };
                cur.points += it.pointsChange;
                cur.stamps += it.stampsChange;
                ledger.set(key, cur);
            }
        }
        const stored = new Map<string, { points: number; stamps: number }>();
        for (const up of data.userPoints) {
            for (const bp of up.businessPoints) {
                for (const rs of bp.rewardSystems) {
                    stored.set(`${up.userId}|${bp.businessId}|${rs.rewardSystemId}`, { points: rs.points, stamps: rs.stamps });
                }
            }
        }
        expect(stored).toEqual(ledger);
    });

    it('totales por negocio == Σ de sus sistemas, y nada negativo', () => {
        for (const up of data.userPoints) {
            for (const bp of up.businessPoints) {
                const sum = bp.rewardSystems.reduce(
                    (acc: any, rs: any) => ({ points: acc.points + rs.points, stamps: acc.stamps + rs.stamps }),
                    { points: 0, stamps: 0 },
                );
                expect({ points: bp.points, stamps: bp.stamps }).toEqual(sum);
                expect(bp.points).toBeGreaterThanOrEqual(0);
                expect(bp.stamps).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('el saldo nunca baja de 0 en ningún momento del historial', () => {
        const running = new Map<string, { points: number; stamps: number }>();
        for (const t of data.transactions) {
            for (const it of t.items) {
                const key = `${t.userId}|${t.businessId}|${it.rewardSystemId}`;
                const cur = running.get(key) ?? { points: 0, stamps: 0 };
                cur.points += it.pointsChange;
                cur.stamps += it.stampsChange;
                expect(cur.points).toBeGreaterThanOrEqual(0);
                expect(cur.stamps).toBeGreaterThanOrEqual(0);
                running.set(key, cur);
            }
        }
    });

    it('cada canje apunta a una recompensa que existe; totales cuadran con items', () => {
        const rewardIds = new Set(data.rewards.map((r) => r._id.toString()));
        for (const t of data.transactions) {
            if (t.type === 'redeem') expect(rewardIds.has(t.rewardId.toString())).toBe(true);
            expect(t.totalPointsChange).toBe(t.items.reduce((s: number, it: any) => s + it.pointsChange, 0));
            expect(t.totalStampsChange).toBe(t.items.reduce((s: number, it: any) => s + it.stampsChange, 0));
            expect(t.items.length).toBeGreaterThan(0);
        }
    });

    it('incluye compras con monto pero 0 puntos (las dos reglas de revenue difieren)', () => {
        const smallAdds = data.transactions.filter(
            (t) => t.type === 'add' && t.purchaseAmount !== undefined && t.totalPointsChange === 0,
        );
        expect(smallAdds.length).toBeGreaterThan(0);
    });
});

describe('parseArgs', () => {
    it('lee --reset y las opciones numéricas', () => {
        expect(parseArgs(['--reset', '--users', '100'])).toEqual({ reset: true, options: { users: 100 } });
    });

    it.each([[['--users', 'x']], [['--users', '0']], [['--prod']]])('rechaza %p', (argv) => {
        expect(() => parseArgs(argv)).toThrow();
    });
});

describe('writeLabDataset', () => {
    let mongod: MongoMemoryServer;
    const quiet = () => undefined;
    const tiny = generateLabDataset({ ...SMALL, businesses: 2, users: 5, transactions: 50 });

    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
    }, 120_000);

    afterAll(async () => {
        await mongod.stop();
    });

    afterEach(async () => {
        await mongoose.disconnect();
    });

    it('se niega a escribir en una base que parece de producción', async () => {
        await mongoose.connect(mongod.getUri(), { dbName: 'rewardshub' });
        await expect(writeLabDataset(tiny, { log: quiet })).rejects.toThrow(ProductionDbError);
        expect(await BusinessModel.estimatedDocumentCount()).toBe(0);
    });

    it('escribe en la base de lab, no duplica sin --reset y --reset regenera', async () => {
        await mongoose.connect(mongod.getUri(), { dbName: 'seed_lab' });

        const result = await writeLabDataset(tiny, { log: quiet });
        expect(result.transactions).toBe(50);
        expect(await TransactionModel.countDocuments()).toBe(50);
        expect(await UserPointsModel.countDocuments()).toBe(tiny.userPoints.length);

        // fechas del historial conservadas
        const first = await TransactionModel.findOne().sort({ createdAt: 1 }).lean();
        expect(first!.createdAt.getTime()).toBe(tiny.transactions[0].createdAt.getTime());

        await expect(writeLabDataset(tiny, { log: quiet })).rejects.toThrow(SeedAlreadyPresentError);
        expect(await TransactionModel.countDocuments()).toBe(50);

        const again = generateLabDataset({ ...SMALL, businesses: 2, users: 5, transactions: 80 });
        await writeLabDataset(again, { reset: true, log: quiet });
        expect(await TransactionModel.countDocuments()).toBe(80);
        expect(await BusinessModel.countDocuments()).toBe(2);
    });
});
