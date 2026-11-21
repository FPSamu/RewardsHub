/**
 * P6.3 — métricas propias en CloudWatch (cliente de AWS falso: nada sale a la red).
 *
 * - Sin METRICS_ENABLED=true: no-op total (ni contadores ni cliente).
 * - Contadores se suman, gauges guardan el último valor; flush manda un solo
 *   PutMetricData (namespace RewardsHub, dimensión Role) y limpia.
 * - Credenciales: METRICS_AWS_PROFILE → fromIni; si no → rol de la instancia.
 *   Nunca la cadena por defecto (el .env trae llaves de otra cuenta).
 * - Falla en silencio.
 * - La conciliación (P3.3) y la caché del mapa publican sus métricas.
 */
const constructed: any[] = [];
const send = jest.fn();

jest.mock('@aws-sdk/client-cloudwatch', () => {
    const actual = jest.requireActual('@aws-sdk/client-cloudwatch');
    return {
        ...actual,
        CloudWatchClient: jest.fn().mockImplementation((config: any) => {
            constructed.push(config);
            return { send };
        }),
    };
});
jest.mock('@aws-sdk/credential-providers', () => ({
    fromIni: jest.fn((opts: any) => ({ kind: 'ini', ...opts })),
    fromInstanceMetadata: jest.fn(() => ({ kind: 'instance-metadata' })),
}));

import { PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import {
    incrementMetric, setGauge, flushMetrics, pendingMetrics, startMetrics, stopMetrics,
    setMetricsClient, resetMetrics, Metric, METRICS_NAMESPACE,
} from '../src/observability/metrics';
import { cachedBusinessDocs } from '../src/cache/bizmapCache';
import { setRedisClient } from '../src/cache/redis';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RedisMock = require('ioredis-mock');

beforeEach(() => {
    resetMetrics();
    setMetricsClient(null);
    constructed.length = 0;
    send.mockReset().mockResolvedValue({});
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
    await stopMetrics();
    delete process.env.METRICS_ENABLED;
    delete process.env.METRICS_AWS_PROFILE;
    delete process.env.REDIS_URL;
    setRedisClient(null);
    jest.restoreAllMocks();
});

describe('sin METRICS_ENABLED', () => {
    it('no acumula, no crea cliente, no manda nada', async () => {
        incrementMetric('X');
        setGauge('Y', 3);
        expect(pendingMetrics()).toEqual([]);
        expect(await flushMetrics()).toBe(0);
        startMetrics('api');
        expect(constructed).toHaveLength(0);
        expect(send).not.toHaveBeenCalled();
    });
});

describe('con METRICS_ENABLED=true', () => {
    beforeEach(() => {
        process.env.METRICS_ENABLED = 'true';
    });

    it('suma contadores, el gauge guarda el último valor, y flush manda un PutMetricData con Role', async () => {
        startMetrics('worker');
        incrementMetric(Metric.IdempotentReplays);
        incrementMetric(Metric.IdempotentReplays, 2);
        setGauge(Metric.ReconciliationMismatches, 5);
        setGauge(Metric.ReconciliationMismatches, 1);

        expect(await flushMetrics()).toBe(2);
        expect(send).toHaveBeenCalledTimes(1);
        const cmd = send.mock.calls[0][0];
        expect(cmd).toBeInstanceOf(PutMetricDataCommand);
        expect(cmd.input.Namespace).toBe(METRICS_NAMESPACE);
        const byName = Object.fromEntries(cmd.input.MetricData.map((d: any) => [d.MetricName, d]));
        expect(byName.IdempotentReplays).toMatchObject({ Value: 3, Unit: 'Count', Dimensions: [{ Name: 'Role', Value: 'worker' }] });
        expect(byName.ReconciliationMismatches).toMatchObject({ Value: 1 });

        // flush limpia: lo siguiente no repite lo anterior
        expect(await flushMetrics()).toBe(0);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('credenciales: perfil con METRICS_AWS_PROFILE, si no el rol de la instancia (nunca la cadena por defecto)', async () => {
        incrementMetric('A');
        await flushMetrics();
        expect(constructed[0].credentials).toEqual({ kind: 'instance-metadata' });
        expect(constructed[0].region).toBe('us-east-1');

        setMetricsClient(null);
        process.env.METRICS_AWS_PROFILE = 'academy';
        incrementMetric('A');
        await flushMetrics();
        expect(constructed[1].credentials).toEqual({ kind: 'ini', profile: 'academy' });
    });

    it('si CloudWatch falla: no lanza, avisa una sola vez y descarta la ventana', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        send.mockRejectedValue(new Error('AccessDenied: cloudwatch:PutMetricData'));
        incrementMetric('A');
        await expect(flushMetrics()).resolves.toBe(0);
        incrementMetric('A');
        await expect(flushMetrics()).resolves.toBe(0);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(pendingMetrics()).toEqual([]);
    });

    it('más de 1000 datos se mandan en varias llamadas', async () => {
        for (let i = 0; i < 1500; i++) incrementMetric(`M${i}`);
        expect(await flushMetrics()).toBe(1500);
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[0][0].input.MetricData).toHaveLength(1000);
    });

    it('stopMetrics manda lo pendiente (apagado ordenado)', async () => {
        startMetrics('api');
        incrementMetric('A');
        await stopMetrics();
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('la caché del mapa cuenta HIT / MISS / BYPASS', async () => {
        process.env.REDIS_URL = 'redis://mock:6379';
        const redis = new RedisMock();
        await redis.flushall();
        setRedisClient(redis);
        const load = jest.fn().mockResolvedValue([]);

        await cachedBusinessDocs('k', load);
        await new Promise((r) => setTimeout(r, 10)); // el SET es asíncrono
        await cachedBusinessDocs('k', load);
        setRedisClient({ get: jest.fn().mockRejectedValue(new Error('down')) } as any);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        await cachedBusinessDocs('k', load);

        const counts = Object.fromEntries(pendingMetrics().map((d) => [d.MetricName, d.Value]));
        expect(counts).toMatchObject({ BizmapCacheMisses: 1, BizmapCacheHits: 1, BizmapCacheBypass: 1 });
    });
});

describe('conciliación (hook de P3.3)', () => {
    it('el hook metric recibe diferencias y canjes huérfanos, y setGauge los deja listos para CloudWatch', async () => {
        process.env.METRICS_ENABLED = 'true';
        jest.resetModules();
        const reconcileModule = require('../src/jobs/reconcile.job');
        jest.spyOn(reconcileModule, 'reconcile').mockResolvedValue({
            checked: 10, mismatchCount: 2, countsByProblem: { ledger_mismatch: 2 }, issues: [], orphanRewardCount: 1, orphanRewardSample: [],
        });
        const { ReconciliationRunModel } = require('../src/models/reconciliationRun.model');
        jest.spyOn(ReconciliationRunModel, 'updateOne').mockResolvedValue({} as any);
        const metrics = require('../src/observability/metrics');

        // igual que lo conecta src/worker.ts
        await reconcileModule.runReconcileJob(undefined, { key: 'k' }, {
            log: () => undefined, metric: (name: string, value: number) => metrics.setGauge(name, value),
        });

        const values = Object.fromEntries(metrics.pendingMetrics().map((d: any) => [d.MetricName, d.Value]));
        expect(values).toEqual({ ReconciliationMismatches: 2, ReconciliationOrphanRewards: 1 });
    });
});
