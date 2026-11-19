import { parseJobMessage, jobRunKey } from '../src/queue/jobs';
import { processMessage, ProcessorDeps } from '../src/queue/processor';
import { AcquireResult } from '../src/queue/jobLock';

const silent = { log: () => undefined, warn: () => undefined, error: () => undefined };

const makeDeps = (lock: AcquireResult, handler = jest.fn().mockResolvedValue({ sent: 3 })) => {
    const deps: ProcessorDeps = {
        handlers: { 'notification-batch': handler, 'engagement-batch': jest.fn() },
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
