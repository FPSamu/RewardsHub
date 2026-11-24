/**
 * P6.2 — el dashboard de Grafana (infra/aws/grafana/dashboards/rewardshub-lab.json)
 * es válido y tiene los paneles del plan. Sin Grafana real: se revisa el JSON.
 */
import fs from 'fs';
import path from 'path';
import { Metric } from '../src/observability/metrics';

const DIR = path.join(__dirname, '..', 'infra', 'aws', 'grafana', 'dashboards');
const raw = fs.readFileSync(path.join(DIR, 'rewardshub-lab.json'), 'utf8');
const dashboard = JSON.parse(raw);
const template = fs.readFileSync(path.join(__dirname, '..', 'infra', 'aws', 'user_data_grafana.sh.tftpl'), 'utf8');

const allPanels = (panels: any[]): any[] => panels.flatMap((p) => [p, ...(p.panels ? allPanels(p.panels) : [])]);
const panels = allPanels(dashboard.panels).filter((p) => p.type !== 'row');
const targets = panels.flatMap((p) => p.targets ?? []);
const metric = (ns: string, name: string) => targets.some((t) => t.namespace === ns && t.metricName === name);

it('solo hay un dashboard y es JSON válido con uid estable', () => {
    expect(fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))).toEqual(['rewardshub-lab.json']);
    expect(dashboard.uid).toBe('rewardshub-lab');
    expect(dashboard.title).toBe('RewardsHub · Lab');
});

it('todos los paneles usan el datasource provisionado (uid "cloudwatch")', () => {
    expect(template).toMatch(/uid: cloudwatch/);
    for (const t of targets) expect(t.datasource).toEqual({ type: 'cloudwatch', uid: 'cloudwatch' });
});

it.each([
    ['AWS/ApplicationELB', 'RequestCount'], ['AWS/ApplicationELB', 'TargetResponseTime'],
    ['AWS/ApplicationELB', 'HTTPCode_Target_5XX_Count'], ['AWS/ApplicationELB', 'HTTPCode_ELB_5XX_Count'],
    ['AWS/ApplicationELB', 'HealthyHostCount'], ['AWS/ApplicationELB', 'UnHealthyHostCount'],
    ['AWS/WAFV2', 'BlockedRequests'],
    ['AWS/AutoScaling', 'GroupInServiceInstances'], ['AWS/EC2', 'CPUUtilization'],
    ['AWS/SQS', 'ApproximateNumberOfMessagesVisible'], ['AWS/SQS', 'ApproximateNumberOfMessagesNotVisible'],
    ['AWS/SQS', 'ApproximateAgeOfOldestMessage'],
    ['AWS/ElastiCache', 'CPUUtilization'], ['AWS/ElastiCache', 'CurrConnections'],
    ['AWS/ElastiCache', 'CacheHits'], ['AWS/ElastiCache', 'CacheMisses'],
    ['AWS/DynamoDB', 'ConsumedReadCapacityUnits'], ['AWS/DynamoDB', 'ConsumedWriteCapacityUnits'],
    ['AWS/DynamoDB', 'ThrottledRequests'],
])('panel de P6.2: %s %s', (ns, name) => {
    expect(metric(ns, name)).toBe(true);
});

it('TargetResponseTime en p50 y p95; CPU con la línea del 40 % (api_cpu_target)', () => {
    const stats = targets.filter((t) => t.metricName === 'TargetResponseTime').map((t) => t.statistic);
    expect(stats).toEqual(['p50', 'p95']);
    const cpu = panels.find((p) => p.title.startsWith('CPU promedio'));
    expect(cpu.fieldConfig.defaults.thresholds.steps.at(-1).value).toBe(40);
});

it('las métricas propias del dashboard son las que publica la app (observability/metrics.ts)', () => {
    const app = targets.filter((t) => t.namespace === 'RewardsHub').map((t) => t.metricName);
    for (const name of app) expect(Object.values(Metric)).toContain(name);
    for (const name of ['ReconciliationMismatches', 'ReplicationLagSeconds', 'IdempotentReplays', 'BizmapCacheHits']) {
        expect(app).toContain(name);
    }
    // % de aciertos de la caché calculado en Grafana
    expect(targets.some((t) => t.expression === '100 * hits / (hits + misses)')).toBe(true);
});

it('metric math: la expresión usa los `id` de las métricas (no refId) y trae statistic', () => {
    // En el lab, sin esto el plugin respondía 500: "query must have either statistic or statistics field"
    for (const p of panels) {
        const ts = p.targets ?? [];
        const ids = new Set(ts.filter((t: any) => t.metricEditorMode !== 1 && t.id).map((t: any) => t.id));
        for (const t of ts.filter((x: any) => x.metricEditorMode === 1)) {
            expect(t.statistic).toBeTruthy();
            const refs = String(t.expression).match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
            for (const r of refs) expect(ids).toContain(r);
        }
    }
});

it('cada $variable usada está definida, y cada __MARCADOR__ tiene su sed en user_data_grafana', () => {
    const defined = new Set(dashboard.templating.list.map((v: any) => v.name));
    const used = new Set([...raw.matchAll(/"\$([a-z_]+)"/g)].map((m) => m[1]));
    for (const v of used) expect(defined).toContain(v);

    const markers = new Set([...raw.matchAll(/__([A-Z_]+)__/g)].map((m) => m[0]));
    for (const m of markers) expect(template).toContain(`s|${m}|`);
});

it('Redis y DynamoDB están en una fila colapsada (si están apagados, no ensucian el dashboard)', () => {
    const datos = dashboard.panels.find((p: any) => p.type === 'row' && p.title.startsWith('Datos'));
    expect(datos.collapsed).toBe(true);
    const inside = datos.panels.flatMap((p: any) => p.targets).map((t: any) => t.namespace);
    expect(new Set(inside)).toEqual(new Set(['AWS/ElastiCache', 'AWS/DynamoDB']));
});

it('anota los cambios de estado de las alarmas jobs-backlog / jobs-empty', () => {
    const ann = dashboard.annotations.list.find((a: any) => a.datasource?.uid === 'cloudwatch');
    expect(ann).toMatchObject({ prefixMatching: true, alarmNamePrefix: '__PROJECT__-jobs-' });
});

it('los paneles no se encimen (gridPos dentro de 24 columnas)', () => {
    for (const p of panels) expect(p.gridPos.x + p.gridPos.w).toBeLessThanOrEqual(24);
});
