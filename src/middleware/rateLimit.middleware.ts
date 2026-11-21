/**
 * Rate limits de aplicación (P4.4). Se activan con RATE_LIMITS=on (el lab lo
 * pone en user_data); sin la variable no hacen nada, así que Render y local
 * se comportan igual que antes.
 *
 * Contador:
 * - Con Redis (REDIS_URL) el contador es GLOBAL: 10 intentos son 10 en total,
 *   aunque el ALB reparta las peticiones entre 4 instancias.
 * - Sin Redis, o si Redis falla, cada instancia cuenta en memoria (el "antes"
 *   de la demo: con N instancias, el límite real es N × límite). La API nunca
 *   falla por culpa del limitador.
 *
 * El WAF del ALB (1000 peticiones / 5 min / IP) sigue siendo el límite grueso;
 * estos son los finos, donde el riesgo es fuerza bruta.
 */
import { RequestHandler, Request } from 'express';
import rateLimit, { MemoryStore, Options, Store, IncrementResponse } from 'express-rate-limit';
import { getRedis, logRedisError } from '../cache/redis';
import { incrementMetric, Metric } from '../observability/metrics';

export const rateLimitsEnabled = (): boolean => process.env.RATE_LIMITS === 'on';

/**
 * Store compartido en Redis con respaldo en memoria.
 *
 * SET k 0 PX ventana NX → INCR k → PTTL k, en un MULTI: la ventana empieza
 * con el primer intento y se cuenta de forma atómica. Funciona en Redis 6
 * (Valkey/redis6 del modo ec2) y 7 (ElastiCache); no usa scripts Lua.
 */
export class SharedRateLimitStore implements Store {
    prefix: string;
    localKeys = false;
    private windowMs = 60_000;
    private memory = new MemoryStore();

    constructor(name: string) {
        this.prefix = `rl:${name}:`;
    }

    init(options: Options) {
        this.windowMs = options.windowMs;
        this.memory.init(options);
    }

    async increment(key: string): Promise<IncrementResponse> {
        const r = getRedis();
        if (r) {
            try {
                const k = this.prefix + key;
                const out = await r.multi().set(k, '0', 'PX', this.windowMs, 'NX').incr(k).pttl(k).exec();
                const [, [incrErr, hits], [ttlErr, ttl]] = out as Array<[Error | null, any]>;
                if (!incrErr && !ttlErr && typeof hits === 'number') {
                    const ms = typeof ttl === 'number' && ttl > 0 ? ttl : this.windowMs;
                    return { totalHits: hits, resetTime: new Date(Date.now() + ms) };
                }
            } catch (err) {
                logRedisError(`rate limit ${this.prefix}`, err);
            }
        }
        return this.memory.increment(key);
    }

    async decrement(key: string): Promise<void> {
        const r = getRedis();
        if (r) {
            try {
                await r.decr(this.prefix + key);
                return;
            } catch (err) {
                logRedisError(`rate limit ${this.prefix}`, err);
            }
        }
        await this.memory.decrement(key);
    }

    async resetKey(key: string): Promise<void> {
        const r = getRedis();
        if (r) {
            try {
                await r.del(this.prefix + key);
            } catch (err) {
                logRedisError(`rate limit ${this.prefix}`, err);
            }
        }
        await this.memory.resetKey(key);
    }
}

interface LimiterConfig {
    name: string;
    windowMs: number;
    limit: number;
    /** Por defecto la IP (req.ip; detrás del ALB usa TRUST_PROXY=1). */
    key?: (req: Request) => string;
    /** Solo cuentan los intentos fallidos (status >= 400): un login correcto no gasta cupo. */
    onlyFailures?: boolean;
}

const envInt = (name: string, fallback: number) => {
    const v = parseInt(process.env[name] || '', 10);
    return Number.isInteger(v) && v > 0 ? v : fallback;
};

const MINUTE = 60_000;

export const createLimiter = ({ name, windowMs, limit, key, onlyFailures }: LimiterConfig): RequestHandler => {
    const limiter = rateLimit({
        windowMs,
        limit,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        store: new SharedRateLimitStore(name),
        passOnStoreError: true,
        skipSuccessfulRequests: Boolean(onlyFailures),
        ...(key && { keyGenerator: key }),
        handler: (_req, res, _next, options) => {
            incrementMetric(Metric.RateLimited);
            res.status(options.statusCode).json({ message: 'too many requests, please try again later' });
        },
    });
    // La bandera se lee en cada petición (sin RATE_LIMITS=on, pasa directo)
    return (req, res, next) => (rateLimitsEnabled() ? limiter(req, res, next) : next());
};

const byBusiness = (req: Request) => req.business?.id ?? `ip:${req.ip}`;

/** /auth/login, /auth/cashier-login: 10 intentos FALLIDOS / 15 min / IP. */
export const loginLimiter = createLimiter({
    name: 'login', windowMs: 15 * MINUTE, limit: envInt('RATE_LIMIT_LOGIN_MAX', 10), onlyFailures: true,
});

/** /auth/register, /auth/check-email: 10 / 15 min / IP. */
export const registerLimiter = createLimiter({
    name: 'register', windowMs: 15 * MINUTE, limit: envInt('RATE_LIMIT_REGISTER_MAX', 10),
});

/** forgot/reset password (usuarios y negocios): 10 / 15 min / IP. */
export const passwordLimiter = createLimiter({
    name: 'password', windowMs: 15 * MINUTE, limit: envInt('RATE_LIMIT_PASSWORD_MAX', 10),
});

/** PIN de administrador (verify/change): 5 intentos FALLIDOS / 15 min POR NEGOCIO (fuerza bruta del PIN). */
export const adminPinLimiter = createLimiter({
    name: 'adminpin', windowMs: 15 * MINUTE, limit: envInt('RATE_LIMIT_ADMIN_PIN_MAX', 5), key: byBusiness, onlyFailures: true,
});

/** Reset del PIN (manda un correo): 5 / 15 min por negocio. */
export const adminPinResetLimiter = createLimiter({
    name: 'adminpin-reset', windowMs: 15 * MINUTE, limit: envInt('RATE_LIMIT_ADMIN_PIN_MAX', 5), key: byBusiness,
});

/** Reportes PDF (CPU pesado): 10 / min por negocio. */
export const reportLimiter = createLimiter({
    name: 'report', windowMs: MINUTE, limit: envInt('RATE_LIMIT_REPORT_MAX', 10), key: byBusiness,
});
