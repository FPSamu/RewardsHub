/**
 * Datos sintéticos para la base del lab (npm run seed:lab). Sin PII real.
 *
 * Función pura y determinista (misma semilla → mismos datos salvo los
 * ObjectId): genera negocios con sucursales en Guadalajara/CDMX, sistemas de
 * puntos y sellos, recompensas, usuarios y un historial de transacciones.
 *
 * Los saldos de `userpoints` se derivan del propio historial, así que la
 * conciliación (P3.3) arranca con 0 diferencias: Σ de los cambios del ledger
 * por (usuario, negocio, sistema) == saldo guardado, y nunca hay saldos
 * negativos en ningún momento del historial.
 */
import { Types } from 'mongoose';

export const SEED_EMAIL_DOMAIN = 'seed.rewardshub.test';
export const SEED_TIMEZONE = 'America/Mexico_City';

export interface LabDatasetOptions {
    seed?: number;
    businesses?: number;
    users?: number;
    transactions?: number;
    days?: number;
    /** Fin del rango de fechas (por defecto ahora). */
    now?: Date;
    /** Hash bcrypt para passHash de todas las cuentas (el script lo calcula). */
    passHash?: string;
    /**
     * Hash bcrypt del PIN de administrador de los negocios. Sin correo (lab) no
     * hay otra forma de obtener un PIN, y varias pantallas lo piden.
     */
    adminPinHash?: string;
}

export const DEFAULT_LAB_OPTIONS = {
    seed: 42,
    businesses: 50,
    users: 2000,
    transactions: 50000,
    days: 90,
};

const CITIES = [
    { name: 'Guadalajara', lat: 20.6597, lng: -103.3496 },
    { name: 'CDMX', lat: 19.4326, lng: -99.1332 },
];

const POINTS_PER = { amount: 10, points: 1 }; // 1 punto por cada $10 MXN

/** PRNG pequeño y determinista (mulberry32). */
const makeRng = (seed: number) => {
    let a = seed >>> 0;
    const next = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        next,
        int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
        pick: <T>(items: T[]): T => items[Math.floor(next() * items.length)],
        chance: (p: number) => next() < p,
    };
};

const pad = (n: number, width: number) => String(n).padStart(width, '0');

export interface LabDataset {
    businesses: any[];
    systems: any[];
    rewards: any[];
    users: any[];
    userPoints: any[];
    transactions: any[];
}

export const generateLabDataset = (opts: LabDatasetOptions = {}): LabDataset => {
    const o = { ...DEFAULT_LAB_OPTIONS, ...opts };
    const rng = makeRng(o.seed);
    const now = o.now ?? new Date();
    const start = new Date(now.getTime() - o.days * 24 * 3600 * 1000);
    const passHash = o.passHash ?? 'seed-no-login';

    // ── Negocios, sistemas y recompensas ────────────────────────────────────
    const businesses: any[] = [];
    const systems: any[] = [];
    const rewards: any[] = [];
    const catalog: Array<{
        business: any;
        points: any;
        stamps: any[];
        pointsRewards: any[];
        stampsRewards: Map<string, any>;
    }> = [];

    for (let i = 1; i <= o.businesses; i++) {
        const city = CITIES[i % CITIES.length];
        const branches = rng.int(1, 3);
        const _id = new Types.ObjectId();
        const business = {
            _id,
            username: `Negocio Lab ${pad(i, 2)}`,
            email: `negocio${pad(i, 2)}@${SEED_EMAIL_DOMAIN}`,
            passHash,
            ...(o.adminPinHash && { adminPinHash: o.adminPinHash }),
            status: 'active',
            isVerified: true,
            timezone: SEED_TIMEZONE,
            createdAt: start,
            refreshTokens: [],
            rotatedRefreshTokens: [],
            isAdminPinTemporary: false,
            locations: Array.from({ length: branches }, (_, b) => {
                const latitude = +(city.lat + (rng.next() - 0.5) * 0.1).toFixed(6);
                const longitude = +(city.lng + (rng.next() - 0.5) * 0.1).toFixed(6);
                return {
                    _id: new Types.ObjectId(),
                    name: b === 0 ? 'Matriz' : `Sucursal ${b + 1}`,
                    address: `Calle Lab ${i}-${b + 1}, ${city.name}`,
                    formattedAddress: `Calle Lab ${i}-${b + 1}, ${city.name}, México`,
                    latitude,
                    longitude,
                    isMain: b === 0,
                    // el writer inserta directo a la colección (sin hooks): geo va explícito
                    geo: { type: 'Point', coordinates: [longitude, latitude] },
                };
            }),
        };
        businesses.push(business);

        const sysBase = { businessId: _id, isActive: true, createdAt: start, updatedAt: start };
        const points = {
            ...sysBase,
            _id: new Types.ObjectId(),
            type: 'points',
            name: 'Puntos',
            pointsConversion: { ...POINTS_PER, currency: 'MXN' },
        };
        const stamps = Array.from({ length: rng.int(1, 2) }, (_, s) => ({
            ...sysBase,
            _id: new Types.ObjectId(),
            type: 'stamps',
            name: s === 0 ? 'Café' : 'Postre',
            targetStamps: rng.int(6, 10),
            productType: 'any',
        }));
        systems.push(points, ...stamps);

        const rewBase = { businessId: _id, isActive: true, createdAt: start, updatedAt: start };
        const pointsRewards = [20, 50].map((cost) => ({
            ...rewBase,
            _id: new Types.ObjectId(),
            systemId: points._id,
            name: `Descuento ${cost} pts`,
            description: `Recompensa sintética de ${cost} puntos`,
            rewardType: 'discount',
            rewardValue: cost,
            pointsRequired: cost,
        }));
        const stampsRewards = new Map<string, any>();
        for (const sys of stamps) {
            stampsRewards.set(sys._id.toString(), {
                ...rewBase,
                _id: new Types.ObjectId(),
                systemId: sys._id,
                name: `${sys.name} gratis`,
                description: `Al juntar ${sys.targetStamps} sellos`,
                rewardType: 'free_product',
                rewardValue: sys.name,
                stampsRequired: sys.targetStamps,
            });
        }
        rewards.push(...pointsRewards, ...stampsRewards.values());
        catalog.push({ business, points, stamps, pointsRewards, stampsRewards });
    }

    // ── Usuarios, cada uno con 1–4 negocios favoritos ───────────────────────
    const users = Array.from({ length: o.users }, (_, i) => ({
        _id: new Types.ObjectId(),
        username: `cliente_lab_${pad(i + 1, 4)}`,
        email: `cliente${pad(i + 1, 4)}@${SEED_EMAIL_DOMAIN}`,
        passHash,
        isVerified: true,
        createdAt: start,
        refreshTokens: [],
        rotatedRefreshTokens: [],
    }));
    const favorites = users.map(() =>
        Array.from(new Set(Array.from({ length: rng.int(1, 4) }, () => rng.int(0, catalog.length - 1))))
    );

    // ── Transacciones en orden cronológico; saldos al vuelo ─────────────────
    // balance: `${user}|${business}|${system}` → { points, stamps, last }
    // Solo se crea una entrada al escribir (bal); leer (peek) no la crea, para
    // que userpoints no tenga sistemas que el ledger nunca tocó.
    const balance = new Map<string, { points: number; stamps: number; last: Date }>();
    const peek = (u: any, b: any, s: any) =>
        balance.get(`${u._id}|${b._id}|${s._id}`) ?? { points: 0, stamps: 0, last: start };
    const bal = (u: any, b: any, s: any) => {
        const key = `${u._id}|${b._id}|${s._id}`;
        let entry = balance.get(key);
        if (!entry) {
            entry = { points: 0, stamps: 0, last: start };
            balance.set(key, entry);
        }
        return entry;
    };

    const span = now.getTime() - start.getTime();
    const times = Array.from({ length: o.transactions }, () => start.getTime() + Math.floor(rng.next() * span))
        .sort((a, b) => a - b);

    const transactions: any[] = [];
    for (const t of times) {
        const createdAt = new Date(t);
        const ui = rng.int(0, users.length - 1);
        const user = users[ui];
        const entry = catalog[rng.pick(favorites[ui])];
        const { business, points } = entry;
        const branch = rng.pick(business.locations as any[]);
        const base = {
            _id: new Types.ObjectId(),
            userId: user._id,
            businessId: business._id,
            branchId: branch._id,
            businessName: business.username,
            timezone: SEED_TIMEZONE,
            createdAt,
            updatedAt: createdAt,
        };

        const pointsNow = peek(user, business, points).points;
        const redeemableStamps = entry.stamps.filter((s) => peek(user, business, s).stamps >= s.targetStamps);
        const affordable = entry.pointsRewards.filter((r) => pointsNow >= r.pointsRequired);

        // Canje de sellos
        if (redeemableStamps.length > 0 && rng.chance(0.6)) {
            const sys = rng.pick(redeemableStamps);
            const reward = entry.stampsRewards.get(sys._id.toString());
            const s = bal(user, business, sys);
            s.stamps -= sys.targetStamps;
            s.last = createdAt;
            transactions.push({
                ...base,
                type: 'redeem',
                items: [{ rewardSystemId: sys._id, rewardSystemName: sys.name, pointsChange: 0, stampsChange: -sys.targetStamps }],
                totalPointsChange: 0,
                totalStampsChange: -sys.targetStamps,
                rewardId: reward._id,
                rewardName: reward.name,
                notes: 'Canje sintético',
            });
            continue;
        }

        // Canje de puntos
        if (affordable.length > 0 && rng.chance(0.15)) {
            const reward = rng.pick(affordable);
            const pts = bal(user, business, points);
            pts.points -= reward.pointsRequired;
            pts.last = createdAt;
            transactions.push({
                ...base,
                type: 'redeem',
                items: [{ rewardSystemId: points._id, rewardSystemName: points.name, pointsChange: -reward.pointsRequired, stampsChange: 0 }],
                totalPointsChange: -reward.pointsRequired,
                totalStampsChange: 0,
                rewardId: reward._id,
                rewardName: reward.name,
                notes: 'Canje sintético',
            });
            continue;
        }

        // Resta manual de puntos (ajuste del cajero)
        if (pointsNow >= 5 && rng.chance(0.03)) {
            const amount = rng.int(1, Math.min(pointsNow, 30));
            const pts = bal(user, business, points);
            pts.points -= amount;
            pts.last = createdAt;
            transactions.push({
                ...base,
                type: 'subtract',
                items: [{ rewardSystemId: points._id, rewardSystemName: points.name, pointsChange: -amount, stampsChange: 0 }],
                totalPointsChange: -amount,
                totalStampsChange: 0,
                notes: 'Points/stamps subtraction',
            });
            continue;
        }

        // Compra: puntos por el monto y/o sellos
        const items: any[] = [];
        let purchaseAmount: number | undefined;
        const kind = rng.next();
        if (kind < 0.8) {
            // compra normal: puntos (y a veces un sello)
            purchaseAmount = rng.int(50, 800);
        } else if (kind < 0.85) {
            // compra chica: monto < $10 → 0 puntos, solo sello (revenueAllAdds la cuenta, revenueWithPoints no)
            purchaseAmount = rng.int(5, 9);
        }
        const earned = purchaseAmount ? Math.floor((purchaseAmount / POINTS_PER.amount) * POINTS_PER.points) : 0;
        if (earned > 0) {
            const pts = bal(user, business, points);
            pts.points += earned;
            pts.last = createdAt;
            items.push({ rewardSystemId: points._id, rewardSystemName: points.name, pointsChange: earned, stampsChange: 0 });
        }
        if (earned === 0 || rng.chance(0.4)) {
            const sys = rng.pick(entry.stamps);
            const s = bal(user, business, sys);
            s.stamps += 1;
            s.last = createdAt;
            items.push({ rewardSystemId: sys._id, rewardSystemName: sys.name, pointsChange: 0, stampsChange: 1 });
        }
        transactions.push({
            ...base,
            type: 'add',
            ...(purchaseAmount !== undefined && { purchaseAmount }),
            items,
            totalPointsChange: earned,
            totalStampsChange: items.reduce((sum, it) => sum + it.stampsChange, 0),
            notes: 'Purchase transaction',
        });
    }

    // ── userpoints derivado de los saldos ───────────────────────────────────
    const byUser = new Map<string, Map<string, any>>();
    for (const [key, value] of balance) {
        const [userId, businessId, systemId] = key.split('|');
        if (!byUser.has(userId)) byUser.set(userId, new Map());
        const perBiz = byUser.get(userId)!;
        if (!perBiz.has(businessId)) {
            perBiz.set(businessId, {
                businessId: new Types.ObjectId(businessId),
                points: 0,
                stamps: 0,
                lastVisit: start,
                rewardSystems: [],
            });
        }
        const bp = perBiz.get(businessId)!;
        bp.points += value.points;
        bp.stamps += value.stamps;
        if (value.last > bp.lastVisit) bp.lastVisit = value.last;
        bp.rewardSystems.push({
            rewardSystemId: new Types.ObjectId(systemId),
            points: value.points,
            stamps: value.stamps,
            lastUpdated: value.last,
        });
    }
    const userPoints = Array.from(byUser, ([userId, perBiz]) => ({
        _id: new Types.ObjectId(),
        userId: new Types.ObjectId(userId),
        businessPoints: Array.from(perBiz.values()),
        createdAt: start,
        updatedAt: now,
    }));

    return { businesses, systems, rewards, users, userPoints, transactions };
};
