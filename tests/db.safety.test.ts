/**
 * P0.3 — assertNonProductionDb: los scripts que escriben solo corren en bases de lab/test.
 */
import { assertNonProductionDb, ProductionDbError } from '../src/db/safety';

const ENV_KEYS = ['ALLOW_DB_WRITES', 'DB_NAME'] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    jest.restoreAllMocks();
});

describe('assertNonProductionDb', () => {
    it.each(['rewardshub_lab', 'rewardshub_test', 'nearby-test', 'seedtest'])('acepta %p', (name) => {
        expect(() => assertNonProductionDb(name)).not.toThrow();
    });

    it.each(['rewardshub', 'production', 'rewardshub_lab_backup', 'test_rewardshub'])('rechaza %p', (name) => {
        expect(() => assertNonProductionDb(name)).toThrow(ProductionDbError);
    });

    it('rechaza cuando no hay base (sin conexión)', () => {
        expect(() => assertNonProductionDb(undefined)).toThrow(ProductionDbError);
    });

    it('"test" (default del driver) solo pasa si viene explícita en DB_NAME', () => {
        expect(() => assertNonProductionDb('test')).toThrow(/por defecto/);
        process.env.DB_NAME = 'test';
        expect(() => assertNonProductionDb('test')).not.toThrow();
    });

    it('ALLOW_DB_WRITES=I_KNOW permite cualquier base, con aviso', () => {
        process.env.ALLOW_DB_WRITES = 'I_KNOW';
        expect(() => assertNonProductionDb('rewardshub')).not.toThrow();
        expect(console.warn).toHaveBeenCalled();
    });

    it('otro valor de ALLOW_DB_WRITES no cuenta', () => {
        process.env.ALLOW_DB_WRITES = 'true';
        expect(() => assertNonProductionDb('rewardshub')).toThrow(ProductionDbError);
    });
});
