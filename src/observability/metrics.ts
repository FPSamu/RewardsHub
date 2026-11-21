/**
 * Métricas propias de la app en CloudWatch (P6.3), namespace `RewardsHub`.
 *
 * Se activa con METRICS_ENABLED=true (en el lab, variable enable_app_metrics).
 * Sin la variable todo es no-op: ni contadores ni llamadas a AWS.
 *
 * - Contadores (`incrementMetric`) y valores puntuales (`setGauge`) en memoria;
 *   cada 60 s se mandan juntos con PutMetricData, con la dimensión Role=api|worker.
 * - No necesita el agente de CloudWatch.
 * - Falla en silencio: si AWS no responde, se avisa en el log (máx. 1 vez por
 *   minuto) y la app sigue; los datos de esa ventana se pierden.
 *
 * Credenciales (igual que src/queue/sqs.ts): el .env trae llaves de OTRA
 * cuenta para S3, así que NO se usa la cadena por defecto:
 *  - METRICS_AWS_PROFILE → perfil de ~/.aws (local con credenciales del lab)
 *  - si no              → rol de la instancia EC2 (LabInstanceProfile)
 */
import {
    CloudWatchClient, PutMetricDataCommand, MetricDatum, StandardUnit,
} from '@aws-sdk/client-cloudwatch';
import { fromIni, fromInstanceMetadata } from '@aws-sdk/credential-providers';

export const METRICS_NAMESPACE = 'RewardsHub';
const FLUSH_MS = 60_000;
/** PutMetricData acepta hasta 1000 datos por llamada. */
const MAX_PER_CALL = 1000;

/** Nombres que usa el dashboard de Grafana (infra/aws/grafana/dashboards). */
export const Metric = {
    ReconciliationMismatches: 'ReconciliationMismatches',
    ReconciliationOrphanRewards: 'ReconciliationOrphanRewards',
    ReplicationLagSeconds: 'ReplicationLagSeconds',
    IdempotentReplays: 'IdempotentReplays',
    IdempotencyConflicts: 'IdempotencyConflicts',
    IdempotencyMissingKey: 'IdempotencyMissingKey',
    CacheHits: 'BizmapCacheHits',
    CacheMisses: 'BizmapCacheMisses',
    CacheBypass: 'BizmapCacheBypass',
    RateLimited: 'RateLimited',
} as const;

type Sender = Pick<CloudWatchClient, 'send'>;

let client: Sender | null = null;
let role = 'api';
let timer: NodeJS.Timeout | null = null;
let lastWarn = 0;
const counters = new Map<string, number>();
const gauges = new Map<string, { value: number; unit: StandardUnit }>();

export const metricsEnabled = (): boolean => process.env.METRICS_ENABLED === 'true';

const getClient = (): Sender => {
    if (client) return client;
    const profile = process.env.METRICS_AWS_PROFILE;
    client = new CloudWatchClient({
        region: process.env.METRICS_REGION || process.env.AWS_REGION || 'us-east-1',
        credentials: profile ? fromIni({ profile }) : fromInstanceMetadata({ maxRetries: 3, timeout: 2000 }),
    });
    return client;
};

/** Para tests: inyectar un cliente falso (o null para volver al real). */
export const setMetricsClient = (c: Sender | null) => {
    client = c;
};

/** Suma `n` al contador `name` (unidad Count). No-op sin METRICS_ENABLED. */
export const incrementMetric = (name: string, n = 1): void => {
    if (!metricsEnabled()) return;
    counters.set(name, (counters.get(name) ?? 0) + n);
};

/** Valor puntual (el último gana). No-op sin METRICS_ENABLED. */
export const setGauge = (name: string, value: number, unit: StandardUnit = StandardUnit.None): void => {
    if (!metricsEnabled()) return;
    gauges.set(name, { value, unit });
};

/** Lo pendiente por mandar (para tests y para flush). */
export const pendingMetrics = (): MetricDatum[] => {
    const now = new Date();
    const dimensions = [{ Name: 'Role', Value: role }];
    return [
        ...Array.from(counters, ([MetricName, Value]) => ({ MetricName, Value, Unit: StandardUnit.Count, Timestamp: now, Dimensions: dimensions })),
        ...Array.from(gauges, ([MetricName, g]) => ({ MetricName, Value: g.value, Unit: g.unit, Timestamp: now, Dimensions: dimensions })),
    ];
};

/** Manda lo acumulado. Nunca lanza. Devuelve cuántos datos se mandaron. */
export const flushMetrics = async (): Promise<number> => {
    if (!metricsEnabled()) return 0;
    const data = pendingMetrics();
    counters.clear();
    gauges.clear();
    if (data.length === 0) return 0;

    try {
        for (let i = 0; i < data.length; i += MAX_PER_CALL) {
            await getClient().send(new PutMetricDataCommand({ Namespace: METRICS_NAMESPACE, MetricData: data.slice(i, i + MAX_PER_CALL) }));
        }
        return data.length;
    } catch (err: any) {
        const now = Date.now();
        if (now - lastWarn > 60_000) {
            lastWarn = now;
            console.warn(`⚠️  [Metrics] No se pudieron publicar ${data.length} métricas: ${err?.message ?? err}`);
        }
        return 0;
    }
};

/** Arranca el envío periódico. `procRole` va como dimensión Role. */
export const startMetrics = (procRole: 'api' | 'worker'): void => {
    role = procRole;
    if (!metricsEnabled() || timer) return;
    timer = setInterval(() => { void flushMetrics(); }, FLUSH_MS);
    timer.unref(); // no impide que el proceso termine
    console.log(`📈 [Metrics] Publicando en CloudWatch (${METRICS_NAMESPACE}, Role=${procRole}) cada ${FLUSH_MS / 1000} s`);
};

/** Detiene el envío y manda lo pendiente (al apagar). */
export const stopMetrics = async (): Promise<void> => {
    if (timer) clearInterval(timer);
    timer = null;
    await flushMetrics();
};

/** Para tests: vaciar todo. */
export const resetMetrics = () => {
    counters.clear();
    gauges.clear();
    lastWarn = 0;
};
