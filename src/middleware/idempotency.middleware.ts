/**
 * Idempotency-Key en las escrituras que mueven saldo.
 *
 * El cliente (web, apps) genera un UUID por acción (un escaneo, un canje) y lo
 * reenvía igual en cada reintento. Con un timeout del lado del celular o del
 * ALB, el reintento ya no suma puntos dos veces: recibe la respuesta guardada.
 *
 * - Sin header → pasa como siempre (compatibilidad con las apps ya instaladas).
 *   Con IDEMPOTENCY_REQUIRED=true responde 400.
 * - Misma llave + mismo body:
 *     ya terminó        → se repite la respuesta guardada (Idempotent-Replayed: true)
 *     sigue en curso    → 409 + Retry-After: 1
 * - Misma llave + otro body → 422.
 * - Respuestas < 500 se guardan (también los 4xx: "Insufficient points" es la
 *   respuesta correcta a esa petición). Un 5xx borra el registro para que el
 *   cliente pueda reintentar.
 *
 * Límite conocido: si el proceso muere después de confirmar la transacción del
 * negocio y antes de guardar la respuesta, el registro queda "in_progress"; un
 * reintento pasado IDEMPOTENCY_LOCK_SECONDS (60 s) lo retoma y la operación se
 * vuelve a ejecutar.
 */
import crypto from 'crypto';
import { RequestHandler } from 'express';
import { IdempotencyKeyModel } from '../models/idempotencyKey.model';
import { incrementMetric, Metric } from '../observability/metrics';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const REPLAYED_HEADER = 'Idempotent-Replayed';

/** Contadores en memoria (para tests); también se publican en CloudWatch (observability/metrics). */
export const idempotencyCounters = { missing: 0, replayed: 0, conflicts: 0, mismatched: 0 };

const MAX_KEY_LENGTH = 255;

const lockMs = () => {
    const seconds = parseInt(process.env.IDEMPOTENCY_LOCK_SECONDS || '', 10);
    return (Number.isInteger(seconds) && seconds > 0 ? seconds : 60) * 1000;
};

/** JSON con las llaves ordenadas en todos los niveles: el mismo body da el mismo hash. */
const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
        return Object.keys(value as Record<string, unknown>).sort()
            .reduce((acc, k) => ({ ...acc, [k]: canonical((value as Record<string, unknown>)[k]) }), {});
    }
    return value;
};

export const hashRequestBody = (body: unknown): string =>
    crypto.createHash('sha256').update(JSON.stringify(canonical(body ?? {}))).digest('hex');

const isDuplicateKey = (err: any) => err?.code === 11000;

/**
 * Debe montarse DESPUÉS del middleware de auth (usa req.business / req.user
 * para el scope).
 */
export const idempotent = (): RequestHandler => async (req, res, next) => {
    const key = req.get(IDEMPOTENCY_HEADER);

    if (key === undefined) {
        idempotencyCounters.missing++;
        incrementMetric(Metric.IdempotencyMissingKey);
        if (process.env.IDEMPOTENCY_REQUIRED === 'true') {
            return res.status(400).json({ message: 'Idempotency-Key header is required' });
        }
        return next();
    }

    if (key.trim() === '' || key.length > MAX_KEY_LENGTH) {
        return res.status(400).json({ message: 'invalid Idempotency-Key' });
    }

    const actorId = req.business?.id ?? (req as any).user?.id ?? 'anonymous';
    const scope = `${actorId}:${req.method}:${req.baseUrl}${req.route?.path ?? req.path}`;
    const requestHash = hashRequestBody(req.body);

    try {
        let claimed = false;
        try {
            await IdempotencyKeyModel.create({ scope, key, requestHash, status: 'in_progress', lockedAt: new Date() });
            claimed = true;
        } catch (err) {
            if (!isDuplicateKey(err)) throw err;
        }

        if (!claimed) {
            const existing = await IdempotencyKeyModel.findOne({ scope, key }).lean();
            if (!existing) {
                // Se borró entre el insert y la lectura (un 5xx de la otra petición): que el cliente reintente
                idempotencyCounters.conflicts++;
                incrementMetric(Metric.IdempotencyConflicts);
                res.set('Retry-After', '1');
                return res.status(409).json({ message: 'request with this Idempotency-Key is still in progress' });
            }
            if (existing.requestHash !== requestHash) {
                idempotencyCounters.mismatched++;
                return res.status(422).json({ message: 'Idempotency-Key already used with a different request' });
            }
            if (existing.status === 'completed') {
                idempotencyCounters.replayed++;
                incrementMetric(Metric.IdempotentReplays);
                res.set(REPLAYED_HEADER, 'true');
                return res.status(existing.responseStatus ?? 200).json(existing.responseBody);
            }

            // En curso. Si el lock es viejo, la petición original murió: se retoma.
            const stale = new Date(Date.now() - lockMs());
            const takenOver = await IdempotencyKeyModel.findOneAndUpdate(
                { scope, key, status: 'in_progress', lockedAt: { $lt: stale } },
                { $set: { lockedAt: new Date() } },
                { new: true }
            );
            if (!takenOver) {
                idempotencyCounters.conflicts++;
                incrementMetric(Metric.IdempotencyConflicts);
                res.set('Retry-After', '1');
                return res.status(409).json({ message: 'request with this Idempotency-Key is still in progress' });
            }
        }
    } catch (err) {
        return next(err);
    }

    // Guardar la respuesta ANTES de enviarla: un reintento que llegue justo
    // después ya encuentra "completed" y recibe la misma respuesta.
    let settled = false;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
        if (settled) return originalJson(body);
        settled = true;
        const status = res.statusCode;
        // Se guarda tal cual sale por la red: JSON omite los undefined, pero
        // Mongo los guardaría como null y el replay tendría llaves de más.
        const sent = body === undefined ? null : JSON.parse(JSON.stringify(body));
        const persist = status < 500
            ? IdempotencyKeyModel.updateOne(
                { scope, key },
                { $set: { status: 'completed', responseStatus: status, responseBody: sent } }
            )
            : IdempotencyKeyModel.deleteOne({ scope, key });
        persist
            .catch((err) => console.error('⚠️  [Idempotency] No se pudo guardar el resultado:', err?.message ?? err))
            .finally(() => originalJson(body));
        return res;
    }) as typeof res.json;

    // La respuesta salió sin res.json (cliente que cortó, res.send): liberar la llave
    res.on('close', () => {
        if (settled) return;
        settled = true;
        IdempotencyKeyModel.deleteOne({ scope, key, status: 'in_progress' })
            .catch((err) => console.error('⚠️  [Idempotency] No se pudo liberar la llave:', err?.message ?? err));
    });

    return next();
};
