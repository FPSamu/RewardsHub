import { parseJobMessage, jobRunKey } from '../src/queue/jobs';
import { processMessage, ProcessorDeps } from '../src/queue/processor';
import { AcquireResult } from '../src/queue/jobLock';

const silent = { log: () => undefined, warn: () => undefined, error: () => undefined };

const makeDeps = (lock: AcquireResult, handler = jest.fn().mockResolvedValue({ sent: 3 })) => {
    const deps: ProcessorDeps = {
        handlers: {
            'notification-batch': handler,
            'engagement-batch': jest.fn(),
            'daily-stats': jest.fn().mockResolvedValue({ rows: 2 }),
            'reconcile-balances': jest.fn().mockResolvedValue({ mismatchCount: 0 }),
            'replicate-dynamo': jest.fn().mockResolvedValue({ lagSeconds: 0 }),
        },
        workerId: 'w1',
        leaseMs: 1000,
        acquire: jest.fn().mockResolvedValue(lock),
        complete: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        log: silent,
    };
    return { deps, handler };
};

const body = JSON.stringify({ type: 'notification-batch', scheduledAt: '2026-11-19T10:00:07Z' });

describe('parseJobMessage', () => {
    it('acepta un trabajo válido y normaliza la fecha', () => {
        expect(parseJobMessage(body)).toEqual({ type: 'notification-batch', scheduledAt: '2026-11-19T10:00:07.000Z' });
    });

    it.each([undefined, '', 'no-json', '{"type":"otro","scheduledAt":"2026-11-19T10:00:00Z"}',
        '{"type":"engagement-batch"}', '{"type":"engagement-batch","scheduledAt":"ayer"}'])(
        'rechaza %p', (b) => {
            expect(parseJobMessage(b as any)).toBeNull();
        });
});

describe('jobRunKey', () => {
    it('agrupa por tipo y minuto, para que los reintentos de EventBridge cuenten como el mismo trabajo', () => {
        const a = parseJobMessage(body)!;
        const b = parseJobMessage(JSON.stringify({ type: 'notification-batch', scheduledAt: '2026-11-19T10:00:59Z' }))!;
        expect(jobRunKey(a)).toBe('notification-batch:2026-11-19T10:00');
        expect(jobRunKey(a)).toBe(jobRunKey(b));
    });
});

describe('processMessage', () => {
    it('ejecuta el handler, marca el trabajo como hecho y borra el mensaje', async () => {
        const { deps, handler } = makeDeps('acquired');
        const out = await processMessage(body, deps);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(deps.complete).toHaveBeenCalledWith('notification-batch:2026-11-19T10:00', 'w1', { sent: 3 });
        expect(out.action).toBe('delete');
    });

    it('descarta duplicados sin volver a ejecutar', async () => {
        const { deps, handler } = makeDeps('done');
        const out = await processMessage(body, deps);
        expect(handler).not.toHaveBeenCalled();
        expect(out).toMatchObject({ action: 'delete', reason: 'duplicate' });
    });

    it('si otro worker lo tiene, no lo borra para que reaparezca', async () => {
        const { deps, handler } = makeDeps('busy');
        const out = await processMessage(body, deps);
        expect(handler).not.toHaveBeenCalled();
        expect(out).toMatchObject({ action: 'retry', reason: 'busy' });
    });

    it('si el handler falla, libera el candado y deja el mensaje para reintento', async () => {
        const { deps } = makeDeps('acquired', jest.fn().mockRejectedValue(new Error('boom')));
        const out = await processMessage(body, deps);
        expect(deps.release).toHaveBeenCalledWith('notification-batch:2026-11-19T10:00', 'w1');
        expect(deps.complete).not.toHaveBeenCalled();
        expect(out).toMatchObject({ action: 'retry', reason: 'failed' });
    });

    it('borra mensajes inválidos sin tocar el candado', async () => {
        const { deps } = makeDeps('acquired');
        const out = await processMessage('basura', deps);
        expect(deps.acquire).not.toHaveBeenCalled();
        expect(out).toMatchObject({ action: 'delete', reason: 'invalid' });
    });
});

describe('params (P3.1, compatible con mensajes viejos)', () => {
    const msg = (o: Record<string, unknown>) => JSON.stringify({ scheduledAt: '2026-11-19T06:15:00Z', ...o });

    it('un mensaje sin params se lee y tiene la misma llave que siempre', () => {
        const job = parseJobMessage(msg({ type: 'daily-stats' }))!;
        expect(job).toEqual({ type: 'daily-stats', scheduledAt: '2026-11-19T06:15:00.000Z' });
        expect(jobRunKey(job)).toBe('daily-stats:2026-11-19T06:15');
        // params vacíos o null cuentan como "sin params"
        expect(parseJobMessage(msg({ type: 'daily-stats', params: {} }))).toEqual(job);
        expect(parseJobMessage(msg({ type: 'daily-stats', params: null }))).toEqual(job);
    });

    it.each([
        [{ day: '2026-11-18' }],
        [{ from: '2026-08-01', to: '2026-11-18' }],
        [{ day: '2026-11-18', businessId: '6b01a2ac1999360c7a461a2b' }],
    ])('daily-stats acepta %p', (params) => {
        expect(parseJobMessage(msg({ type: 'daily-stats', params }))!.params).toEqual(params);
    });

    it.each([
        [{ day: '2026-02-30' }],                                   // día inexistente
        [{ day: '18/11/2026' }],
        [{ from: '2026-11-18', to: '2026-11-01' }],                // al revés
        [{ from: '2026-11-18' }],                                  // rango incompleto
        [{ day: '2026-11-18', from: '2026-11-01', to: '2026-11-18' }], // day y rango a la vez
        [{ from: '2024-01-01', to: '2026-01-01' }],                // demasiado largo
        [{ businessId: 'no-es-un-id' }],
        [{ dias: 3 }],                                             // llave desconocida
        ['texto'],
        [[1, 2]],
    ])('daily-stats rechaza %p (el worker descarta el mensaje)', (params) => {
        expect(parseJobMessage(msg({ type: 'daily-stats', params }))).toBeNull();
    });

    it('reconcile-balances acepta businessId; los batches de avisos no aceptan params', () => {
        expect(parseJobMessage(msg({ type: 'reconcile-balances', params: { businessId: '6B01A2AC1999360C7A461A2B' } }))!.params)
            .toEqual({ businessId: '6b01a2ac1999360c7a461a2b' });
        expect(parseJobMessage(msg({ type: 'reconcile-balances', params: { day: '2026-11-18' } }))).toBeNull();
        expect(parseJobMessage(msg({ type: 'notification-batch', params: { day: '2026-11-18' } }))).toBeNull();
    });

    it('la llave agrega un hash de los params: otro rango es otro trabajo; el orden de las llaves no importa', () => {
        const a = parseJobMessage(msg({ type: 'daily-stats', params: { from: '2026-08-01', to: '2026-08-07' } }))!;
        const b = parseJobMessage(msg({ type: 'daily-stats', params: { to: '2026-08-07', from: '2026-08-01' } }))!;
        const c = parseJobMessage(msg({ type: 'daily-stats', params: { from: '2026-08-08', to: '2026-08-14' } }))!;
        expect(jobRunKey(a)).toMatch(/^daily-stats:2026-11-19T06:15:[0-9a-f]{10}$/);
        expect(jobRunKey(a)).toBe(jobRunKey(b));
        expect(jobRunKey(a)).not.toBe(jobRunKey(c));
        expect(jobRunKey(a)).not.toBe('daily-stats:2026-11-19T06:15');
    });

    it('el processor pasa params y contexto (llave, scheduledAt) al handler', async () => {
        const { deps } = makeDeps('acquired');
        const job = msg({ type: 'daily-stats', params: { day: '2026-11-18' } });
        const out = await processMessage(job, deps);
        const key = jobRunKey(parseJobMessage(job)!);
        expect(deps.handlers['daily-stats']).toHaveBeenCalledWith({ day: '2026-11-18' }, { key, scheduledAt: '2026-11-19T06:15:00.000Z' });
        expect(deps.complete).toHaveBeenCalledWith(key, 'w1', { rows: 2 });
        expect(out.action).toBe('delete');
    });

    it('los handlers viejos reciben params undefined', async () => {
        const { deps, handler } = makeDeps('acquired');
        await processMessage(body, deps);
        expect(handler).toHaveBeenCalledWith(undefined, expect.objectContaining({ key: 'notification-batch:2026-11-19T10:00' }));
    });
});
