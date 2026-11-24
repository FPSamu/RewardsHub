#!/usr/bin/env node
/**
 * Pruebas guiadas del lab de AWS Academy: cada escenario FUERZA un
 * comportamiento de la arquitectura, lo registra en la terminal (y en
 * logs/lab-demo-*.log) y dice qué panel de Grafana debe moverse.
 *
 *   ./lab.sh demo                 lista de escenarios
 *   ./lab.sh demo rapidos         balanceo, cache, idempotencia, atomico, ratelimit, cola (~5 min)
 *   ./lab.sh demo <escenario> [--opcion valor]
 *
 * Requisitos: el lab arriba (./lab.sh status healthy), ./lab.sh seed hecho,
 * Node ≥ 18 y AWS CLI con el perfil del lab. Solo habla con el ALB del lab y
 * con recursos de este estado de Terraform; escribe solo en rewardshub_lab.
 *
 * Grafana va 1–5 min atrás de este log: las métricas de AWS se publican por
 * minuto y las de la app (namespace RewardsHub) cada 60 s.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const INFRA = join(ROOT, 'infra/aws');
const PROFILE = process.env.AWS_PROFILE || 'academy';
const REGION = process.env.AWS_REGION || 'us-east-1';
const PASSWORD = 'lab12345'; // contraseña de las cuentas del seed (src/cli/seed.ts)
const GDL = { lat: 20.6597, lng: -103.3496 };

// ── Opciones ────────────────────────────────────────────────────────────────
const [, , SCENARIO = '', ...rest] = process.argv;
const OPTS = {};
for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
        const k = rest[i].slice(2);
        const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true';
        OPTS[k] = v;
    }
}
const opt = (k, def) => (OPTS[k] === undefined ? def : typeof def === 'number' ? Number(OPTS[k]) : OPTS[k]);

// ── Log ─────────────────────────────────────────────────────────────────────
mkdirSync(join(ROOT, 'logs'), { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const LOG_FILE = join(ROOT, 'logs', `lab-demo-${stamp}.log`);
let current = 'demo';
const C = { dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m' };
const hhmmss = () => new Date().toLocaleTimeString('es-MX', { hour12: false });
const write = (line, color = '') => {
    const out = `${C.dim}${hhmmss()}${C.reset} ${C.cyan}[${current}]${C.reset} ${color}${line}${color ? C.reset : ''}`;
    console.log(out);
    appendFileSync(LOG_FILE, `${new Date().toISOString()} [${current}] ${line}\n`);
};
const log = (msg) => write(msg);
const ok = (msg) => write(`✅ ${msg}`, C.green);
const bad = (msg) => write(`❌ ${msg}`, C.red);
const warn = (msg) => write(`⚠️  ${msg}`, C.yellow);
const grafana = (panel, expect) => write(`👀 Grafana › ${panel}: ${expect}`, C.bold);
const header = (name, what) => {
    current = name;
    console.log('');
    write(`══════ ${name.toUpperCase()} ══════`, C.bold);
    write(what);
};
const results = [];
const verdict = (pass, msg) => {
    results.push({ scenario: current, pass, msg });
    (pass ? ok : bad)(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── AWS / Terraform ─────────────────────────────────────────────────────────
const tfCache = {};
const tf = (name) => {
    if (!(name in tfCache)) {
        tfCache[name] = execFileSync('terraform', ['output', '-raw', name], { cwd: INFRA, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    }
    return tfCache[name];
};
const aws = (...args) => {
    const out = execFileSync('aws', ['--profile', PROFILE, '--region', REGION, '--output', 'json', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return out.trim() ? JSON.parse(out) : null;
};
const asgInfo = (name) => {
    const g = aws('autoscaling', 'describe-auto-scaling-groups', '--auto-scaling-group-names', name).AutoScalingGroups[0];
    const inService = g.Instances.filter((i) => i.LifecycleState === 'InService');
    return { desired: g.DesiredCapacity, inService: inService.length, ids: inService.map((i) => i.InstanceId), all: g.Instances };
};
const targetHealth = () => {
    const t = aws('elbv2', 'describe-target-health', '--target-group-arn', tf('target_group_arn')).TargetHealthDescriptions;
    return t.map((d) => `${d.Target.Id.slice(-6)}:${d.TargetHealth.State}`);
};
const queueDepth = (urlOutput = 'queue_url') => {
    const a = aws('sqs', 'get-queue-attributes', '--queue-url', tf(urlOutput), '--attribute-names',
        'ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible').Attributes;
    return { visible: Number(a.ApproximateNumberOfMessages), inFlight: Number(a.ApproximateNumberOfMessagesNotVisible) };
};
const enqueue = (body) => aws('sqs', 'send-message', '--queue-url', tf('queue_url'), '--message-body', JSON.stringify(body)).MessageId;
/** Corre un comando en una instancia por SSM (sin plugin) y devuelve stdout. */
const ssm = async (instanceId, command, timeoutS = 60) => {
    const id = aws('ssm', 'send-command', '--instance-ids', instanceId, '--document-name', 'AWS-RunShellScript',
        '--parameters', JSON.stringify({ commands: [command] }), '--query', 'Command.CommandId').toString();
    for (let i = 0; i < timeoutS; i += 2) {
        await sleep(2000);
        try {
            const inv = aws('ssm', 'get-command-invocation', '--command-id', id, '--instance-id', instanceId);
            if (!['Pending', 'InProgress', 'Delayed'].includes(inv.Status)) return inv.StandardOutputContent || '';
        } catch { /* la invocación tarda un momento en existir */ }
    }
    return '';
};
const cpuNow = (asgName) => {
    const end = new Date();
    const start = new Date(end.getTime() - 6 * 60_000);
    const pts = aws('cloudwatch', 'get-metric-statistics', '--namespace', 'AWS/EC2', '--metric-name', 'CPUUtilization',
        '--dimensions', `Name=AutoScalingGroupName,Value=${asgName}`, '--start-time', start.toISOString(), '--end-time', end.toISOString(),
        '--period', '60', '--statistics', 'Average').Datapoints;
    if (!pts.length) return null;
    pts.sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp));
    return pts[0].Average;
};

// ── HTTP contra el ALB ──────────────────────────────────────────────────────
let API;
const http = async (method, path, { token, body, headers = {} } = {}) => {
    const t0 = Date.now();
    try {
        const res = await fetch(API + path, {
            method,
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(20_000),
        });
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* no es JSON */ }
        return { status: res.status, headers: res.headers, json, ms: Date.now() - t0 };
    } catch (err) {
        return { status: 0, headers: new Headers(), json: null, ms: Date.now() - t0, error: err.name === 'TimeoutError' ? 'timeout' : err.message };
    }
};
const pad2 = (n) => String(n).padStart(2, '0');
const bizEmail = (n) => `negocio${pad2(n)}@seed.rewardshub.test`;
const setupCache = {};
/** Login de cajero en un negocio del seed + su sistema de puntos, sucursal y clientes. */
const bizSetup = async (n) => {
    if (setupCache[n]) return setupCache[n];
    const login = await http('POST', '/auth/cashier-login', { body: { email: bizEmail(n), password: PASSWORD } });
    if (login.status !== 200) throw new Error(`login de ${bizEmail(n)} → ${login.status} ${JSON.stringify(login.json)}. ¿Corriste ./lab.sh seed?`);
    const token = login.json.token;
    const systems = (await http('GET', '/systems', { token })).json || [];
    const points = systems.find((s) => s.type === 'points' && s.isActive);
    const me = (await http('GET', '/business/me', { token })).json || {};
    const branch = (me.locations || []).find((l) => l.isMain) || (me.locations || [])[0];
    const users = ((await http('GET', '/user-points/business-users', { token })).json?.users || []).map((u) => u.userId);
    setupCache[n] = { n, email: bizEmail(n), token, systemId: points?.id ?? points?._id, branchId: branch?._id, users };
    return setupCache[n];
};
const balance = async (biz, userId) => (await http('GET', `/user-points/${userId}`, { token: biz.token })).json?.points ?? 0;
const addPoints = (biz, userId, purchaseAmount, key) => http('POST', '/user-points/add', {
    token: biz.token,
    body: { userId, purchaseAmount, ...(biz.branchId ? { branchId: biz.branchId } : {}) },
    headers: key ? { 'Idempotency-Key': key } : {},
});
const replayed = (r) => r.headers.get('idempotent-replayed') === 'true';
const countBy = (arr) => arr.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
const fmtCounts = (m) => Object.entries(m).map(([k, v]) => `${k}×${v}`).join('  ');
/** Corre `fn` con `concurrency` promesas a la vez hasta que `until()` sea true. */
const pool = async (concurrency, until, fn) => {
    await Promise.all(Array.from({ length: concurrency }, async (_, w) => { while (!until()) await fn(w); }));
};

// ═════════════════════════ ESCENARIOS ═══════════════════════════════════════

const balanceo = async () => {
    const n = opt('peticiones', 120);
    header('balanceo', `ALB → ${n} peticiones a /business/nearby; después cuento en el log de cada instancia cuántas atendió.`);
    const runId = randomUUID().slice(0, 8);
    let sent = 0;
    const statuses = [];
    await pool(4, () => sent >= n, async () => {
        const i = ++sent;
        const r = await http('GET', `/business/nearby?latitude=${GDL.lat}&longitude=${GDL.lng}&maxDistanceKm=5&demo=${runId}`);
        statuses.push(r.status);
        if (i % 20 === 0) log(`   ${i}/${n} enviadas · ${fmtCounts(countBy(statuses))}`);
    });
    log('Contando en cada instancia de la API las líneas con demo=' + runId + ' (SSM)…');
    await sleep(3000);
    const { ids } = asgInfo(tf('api_asg'));
    const perInstance = {};
    for (const id of ids) {
        const out = await ssm(id, `journalctl -u rewardshub --since '-15 min' -o cat | grep -c 'demo=${runId}' || true`);
        perInstance[id] = Number(out.trim() || 0);
        log(`   ${id} atendió ${perInstance[id]} peticiones`);
    }
    const served = Object.values(perInstance);
    verdict(served.filter((c) => c > 0).length >= Math.min(2, ids.length), `el ALB repartió el tráfico entre ${served.filter((c) => c > 0).length} instancias (${served.join(' / ')})`);
    grafana('Entrada › Peticiones al ALB', `un pico de ~${n} peticiones`);
    grafana('Entrada › Instancias sanas en el target group', `${ids.length}`);
};

const cache = async () => {
    header('cache', 'Redis → la misma consulta del mapa 12 veces: la 1.ª va a Mongo (MISS) y las demás salen de Redis (HIT).');
    // Coordenadas al azar cerca de Guadalajara: llave de caché nueva → el primer intento es MISS
    const lat = (GDL.lat + (Math.random() - 0.5) * 0.02).toFixed(4);
    const lng = (GDL.lng + (Math.random() - 0.5) * 0.02).toFixed(4);
    const seen = [];
    for (let i = 1; i <= 12; i++) {
        const r = await http('GET', `/business/nearby?latitude=${lat}&longitude=${lng}&maxDistanceKm=3`);
        const xc = r.headers.get('x-cache') || '(sin X-Cache)';
        seen.push(xc);
        log(`   #${pad2(i)} → ${r.status} X-Cache: ${xc} · ${r.ms} ms`);
    }
    const hits = seen.filter((s) => s === 'HIT').length;
    if (seen.includes('BYPASS')) warn('BYPASS = Redis no disponible; la API consultó Mongo directo (falla abierta)');
    verdict(seen[0] === 'MISS' && hits >= 10, `1.ª consulta ${seen[0]}, después ${hits}/11 HIT`);
    grafana('App › Caché del mapa: % de aciertos', 'sube (las métricas de la app tardan ~1–2 min)');
};

const idempotencia = async () => {
    header('idempotencia', 'Idempotency-Key → reintentos, doble clic y llave reutilizada en POST /user-points/add.');
    const biz = await bizSetup(1);
    const userId = biz.users[0];
    log(`Negocio ${biz.email} · cliente ${userId}`);
    const b0 = await balance(biz, userId);
    log(`Saldo inicial: ${b0}`);

    log('1) Suma con llave K1 y luego el MISMO reintento (como si se hubiera caído la red)');
    const k1 = randomUUID();
    const a = await addPoints(biz, userId, 100, k1);
    const b1 = await balance(biz, userId);
    log(`   intento 1 → ${a.status} · saldo ${b1} (+${b1 - b0})`);
    const a2 = await addPoints(biz, userId, 100, k1);
    const b2 = await balance(biz, userId);
    log(`   intento 2 → ${a2.status} · Idempotent-Replayed: ${replayed(a2)} · saldo ${b2}`);
    verdict(a.status === 200 && replayed(a2) && b2 === b1, 'el reintento devolvió la respuesta guardada y NO sumó otra vez');

    log('2) Misma llave K1 con OTRO monto (bug del cliente)');
    const a3 = await addPoints(biz, userId, 999, k1);
    log(`   → ${a3.status} ${a3.json?.message ?? ''}`);
    verdict(a3.status === 422, 'llave reutilizada con otro body → 422 y no se aplica');

    log('3) Doble clic: 6 peticiones SIMULTÁNEAS con la misma llave K2');
    const k2 = randomUUID();
    const before = await balance(biz, userId);
    const burst = await Promise.all(Array.from({ length: 6 }, () => addPoints(biz, userId, 100, k2)));
    const labels = burst.map((r) => (replayed(r) ? `${r.status}-replay` : String(r.status)));
    const after = await balance(biz, userId);
    log(`   respuestas: ${fmtCounts(countBy(labels))} · saldo ${before} → ${after}`);
    verdict(after - before === b1 - b0, `6 clics simultáneos sumaron UNA sola vez (+${after - before})`);

    log('4) Sin llave (cliente viejo): funciona igual que antes y se cuenta como "sin llave"');
    const a4 = await addPoints(biz, userId, 100);
    log(`   → ${a4.status}`);
    grafana('App › Idempotency-Key', 'replays ≥ 1, conflictos ≥ 1 (409/422) y sin llave ≥ 1');
};

const atomico = async () => {
    header('atomico', 'Escrituras atómicas → 10 canjes SIMULTÁNEOS que juntos piden más puntos de los que hay.');
    // No todos los negocios del seed tienen sistema de puntos (algunos solo sellos)
    let biz = null;
    for (let n = 2; n <= 20 && !biz; n++) {
        const b = await bizSetup(n);
        if (b.systemId && b.users.length) biz = b;
    }
    if (!biz) { verdict(false, 'ningún negocio del seed (02–20) tiene sistema de puntos activo'); return; }
    const userId = biz.users[0];
    log(`Negocio ${biz.email} · cliente ${userId}`);
    let b = await balance(biz, userId);
    if (b < 30) {
        await addPoints(biz, userId, 500, randomUUID());
        b = await balance(biz, userId);
    }
    const amount = Math.ceil(b / 3);
    const expected = Math.floor(b / amount);
    log(`Saldo ${b}: 10 canjes de ${amount} a la vez → solo deberían pasar ${expected}`);
    const reqs = await Promise.all(Array.from({ length: 10 }, () => http('POST', '/user-points/subtract', {
        token: biz.token,
        body: { userId, pointsToSubtract: amount, rewardSystemId: biz.systemId, ...(biz.branchId ? { branchId: biz.branchId } : {}) },
        headers: { 'Idempotency-Key': randomUUID() },
    })));
    const labels = reqs.map((r) => (r.status === 200 ? '200' : `${r.status} ${r.json?.message ?? ''}`.trim()));
    for (const [k, v] of Object.entries(countBy(labels))) log(`   ${v} × ${k}`);
    const passed = reqs.filter((r) => r.status === 200).length;
    const final = await balance(biz, userId);
    log(`Saldo final: ${final} (esperado ${b - passed * amount})`);
    verdict(passed === expected && final === b - passed * amount && final >= 0, `pasaron ${passed}/${expected} canjes y el saldo nunca quedó negativo`);
    log('Comprueba también que Mongo hizo transacciones de verdad: ./lab.sh logs api 200 | grep withTransaction  (no debe mostrar nada)');
};

const ratelimit = async () => {
    const n = opt('negocio', 50);
    header('ratelimit', `Rate limit de la app → PIN de administrador equivocado 8 veces en ${bizEmail(n)} (límite: 5 fallos / 15 min por negocio).`);
    const biz = await bizSetup(n);
    const seen = [];
    for (let i = 1; i <= 8; i++) {
        const r = await http('POST', '/business/admin-pin/verify', { token: biz.token, body: { pin: '000000' } });
        seen.push(r.status);
        const ra = r.headers.get('retry-after');
        log(`   intento ${i} → ${r.status} ${r.json?.message ?? ''}${ra ? ` · Retry-After: ${ra} s` : ''}`);
    }
    verdict(seen.includes(429), seen.includes(429) ? `bloqueado al intento ${seen.indexOf(429) + 1} (429)` : 'nunca respondió 429 (¿enable_rate_limits = false?)');
    log(`Con Redis el contador es global: aunque el ALB reparta los intentos entre instancias, el límite es 5 en total.`);
    log(`${bizEmail(n)} queda con el PIN bloqueado 15 min (solo ese negocio).`);
    grafana('App › Rate limit: respuestas 429 de la app', '≥ 3');
};

const cola = async () => {
    header('cola', 'SQS + workers → trabajos reales, un duplicado y un mensaje inválido.');
    const at = new Date().toISOString().slice(0, 17) + '00.000Z';
    const msgs = [
        { label: 'reconcile-balances (1.ª vez)', body: { type: 'reconcile-balances', scheduledAt: at } },
        { label: 'reconcile-balances (DUPLICADO, misma llave)', body: { type: 'reconcile-balances', scheduledAt: at } },
        { label: 'replicate-dynamo', body: { type: 'replicate-dynamo', scheduledAt: at } },
        { label: 'daily-stats (ayer)', body: { type: 'daily-stats', scheduledAt: at } },
        { label: 'mensaje inválido', body: { type: 'no-existe', scheduledAt: at } },
    ];
    for (const m of msgs) log(`   📨 ${m.label} → ${enqueue(m.body).slice(0, 8)}`);
    log('Esperando a que los workers vacíen la cola…');
    const t0 = Date.now();
    let d;
    do {
        await sleep(5000);
        d = queueDepth();
        log(`   cola: ${d.visible} visibles · ${d.inFlight} en proceso`);
    } while ((d.visible || d.inFlight) && Date.now() - t0 < 5 * 60_000);
    const { ids } = asgInfo(tf('worker_asg'));
    log('Lo que registraron los workers:');
    const lines = [];
    for (const id of ids) {
        const out = await ssm(id, `journalctl -u rewardshub --since '-6 min' -o cat | grep '\\[Worker\\]' | tail -20`);
        for (const l of out.split('\n').filter(Boolean)) { lines.push(l); log(`   ${id.slice(-6)} │ ${l.slice(0, 160)}`); }
    }
    const all = lines.join('\n');
    verdict(/reconcile-balances.*terminado/.test(all), 'reconcile-balances se ejecutó');
    verdict(/duplicado descartado/.test(all), 'el duplicado se descartó (candado JobRun en Mongo)');
    verdict(/inválido/.test(all), 'el mensaje inválido se descartó sin reintentos');
    const dlq = queueDepth('dlq_url');
    log(`DLQ: ${dlq.visible} mensajes (solo llegan ahí los trabajos que FALLAN 5 veces)`);
    grafana('Cola › Mensajes en la cola', `un pico de ${msgs.length} y regresa a 0`);
    grafana('App › Conciliación: diferencias en saldos', '0');
    grafana('App › Retraso de la réplica (DynamoDB)', 'baja a ~1 min tras replicate-dynamo');
};

const workers = async () => {
    const n = opt('mensajes', 3);
    header('workers', `Escalado de workers → ${n} backfills de 120 días de daily-stats (el job los parte en ~17 mensajes semanales cada uno); si el más viejo espera > 2 min, la alarma agrega un worker.`);
    const base = Date.now();
    for (let i = 0; i < n; i++) {
        // Rangos distintos (y scheduledAt distinto) → llaves distintas: ninguno es duplicado
        const to = new Date(base - (i + 1) * 86_400_000).toISOString().slice(0, 10);
        const from = new Date(base - (i + 1 + 120) * 86_400_000).toISOString().slice(0, 10);
        const scheduledAt = new Date(base - i * 60_000).toISOString();
        enqueue({ type: 'daily-stats', scheduledAt, params: { from, to } });
    }
    log(`📨 ${n} mensajes encolados. Sigo la cola, la alarma y el ASG de workers cada 30 s (máx. ${opt('minutos', 15)} min)…`);
    const asg = tf('worker_asg');
    const start = asgInfo(asg);
    const t0 = Date.now();
    let scaled = false;
    while (Date.now() - t0 < opt('minutos', 15) * 60_000) {
        const d = queueDepth();
        const alarm = aws('cloudwatch', 'describe-alarms', '--alarm-names', 'rewardshub-jobs-backlog').MetricAlarms[0]?.StateValue ?? '?';
        const g = asgInfo(asg);
        log(`   cola ${d.visible}+${d.inFlight} · alarma jobs-backlog: ${alarm} · workers deseados ${g.desired} / en servicio ${g.inService}`);
        if (g.desired > start.desired) scaled = true;
        if (!d.visible && !d.inFlight) break;
        await sleep(30_000);
    }
    verdict(scaled, scaled ? 'el ASG de workers agregó instancias por la antigüedad de la cola'
        : 'la cola se vació antes de escalar: repite con más mensajes (--mensajes 6)');
    log('El ASG quita el worker extra solo, cuando la cola lleva un rato vacía.');
    grafana('Cola › Antigüedad del mensaje más viejo', 'pasa de 120 s');
    grafana('Cómputo › Instancias en servicio', 'worker sube de 1 a 2');
};

const carga = async () => {
    const minutes = opt('minutos', 10);
    const conc = opt('concurrencia', 60);
    header('carga', `Autoescalado de la API → tráfico de caja (leer saldo + sumar puntos + lista de clientes) con ${conc} conexiones durante ${minutes} min.`);
    warn('El WAF permite 1000 peticiones / 5 min por IP: antes súbelo con  ./lab.sh up -var waf_rate_limit=2000000  y al terminar regrésalo con  ./lab.sh up');
    const businesses = [];
    for (let i = 1; i <= 5; i++) businesses.push(await bizSetup(i));
    const asg = tf('api_asg');
    const start = asgInfo(asg);
    log(`API: ${start.desired} deseadas · objetivo de CPU 40 %`);
    const end = Date.now() + minutes * 60_000;
    let stop = false;
    const window = { n: 0, lat: [], codes: [] };
    let total = 0;
    let blocked = 0;
    const reporter = (async () => {
        while (!stop) {
            await sleep(15_000);
            const w = { ...window, lat: [...window.lat].sort((a, b) => a - b) };
            window.n = 0; window.lat = []; window.codes = [];
            const p95 = w.lat.length ? w.lat[Math.floor(w.lat.length * 0.95)] : 0;
            let cpu = null; let g = { desired: '?', inService: '?' };
            try { cpu = cpuNow(asg); g = asgInfo(asg); } catch { /* no detener la carga por un error de la CLI */ }
            log(`   ${(w.n / 15).toFixed(0)} req/s · p95 ${p95} ms · ${fmtCounts(countBy(w.codes))} · CPU API ${cpu === null ? '…' : cpu.toFixed(0) + ' %'} · API deseadas ${g.desired} / en servicio ${g.inService}`);
        }
    })();
    await pool(conc, () => Date.now() > end || stop, async (w) => {
        const biz = businesses[w % businesses.length];
        const userId = biz.users[Math.floor(Math.random() * biz.users.length)];
        const calls = [
            () => http('GET', `/user-points/${userId}`, { token: biz.token }),
            () => addPoints(biz, userId, 50 + Math.floor(Math.random() * 450), randomUUID()),
            () => http('GET', '/user-points/business-users', { token: biz.token }),
        ];
        for (const c of calls) {
            const r = await c();
            total++; window.n++; window.lat.push(r.ms); window.codes.push(r.status || r.error);
            if (r.status === 403) {
                blocked++;
                if (blocked === 20) { bad('El WAF está bloqueando tu IP (403). Sube waf_rate_limit (arriba) y vuelve a intentar en ~5 min.'); stop = true; }
            }
        }
    });
    stop = true;
    await reporter;
    const g = asgInfo(asg);
    log(`Total: ${total} peticiones`);
    verdict(g.desired > start.desired, g.desired > start.desired ? `la API escaló de ${start.desired} a ${g.desired} instancias`
        : 'no escaló todavía: la CPU tiene que pasar de 40 % varios minutos (sube --concurrencia o --minutos)');
    log('Al bajar la carga, el ASG regresa a 2 instancias solo (~15 min).');
    grafana('Cómputo › CPU promedio por ASG', 'la API pasa la línea roja del 40 %');
    grafana('Cómputo › Instancias en servicio', 'la API sube de 2');
    grafana('Entrada › Tiempo de respuesta (p50 / p95)', 'sube con la carga y baja al entrar las instancias nuevas');
};

const waf = async () => {
    header('waf', 'WAF → más de 1000 peticiones en 5 min desde tu IP hasta que el ALB responde 403.');
    if (OPTS.si !== 'true') {
        warn('Esto BLOQUEA TU IP en el ALB unos 5–10 min (también la web del lab desde esta red).');
        warn('Si estás seguro:  ./lab.sh demo waf --si');
        return;
    }
    let sent = 0;
    const codes = [];
    let firstBlock = null;
    const t0 = Date.now();
    await pool(30, () => firstBlock !== null || Date.now() - t0 > 6 * 60_000, async () => {
        const r = await http('GET', '/health');
        sent++;
        codes.push(r.status);
        if (r.status === 403 && firstBlock === null) firstBlock = sent;
        if (sent % 250 === 0) log(`   ${sent} peticiones · ${fmtCounts(countBy(codes))}`);
        if (sent > 1300) await sleep(1000); // ya pasó el límite: esperar a que el WAF lo evalúe (~30–60 s)
    });
    log(`   ${sent} peticiones · ${fmtCounts(countBy(codes))}`);
    verdict(firstBlock !== null, firstBlock !== null ? `el WAF bloqueó tu IP tras ${firstBlock} peticiones (${Math.round((Date.now() - t0) / 1000)} s)` : 'el WAF no bloqueó en 6 min (¿enable_waf = false o waf_rate_limit alto?)');
    log('El bloqueo se levanta solo cuando tu IP baja de 1000 peticiones en la ventana de 5 min.');
    grafana('Entrada › WAF: bloqueadas por rate-limit-per-ip', 'sube');
};

const falla = async () => {
    header('falla', 'Tolerancia a fallos → termino una instancia de la API mientras hago 1 petición/s; el ALB la saca y el ASG la reemplaza.');
    const asg = tf('api_asg');
    const g = asgInfo(asg);
    if (g.inService < 2) { bad('Se necesitan al menos 2 instancias de la API en servicio'); return; }
    const victim = g.ids[0];
    let stop = false;
    const codes = [];
    const pinger = (async () => {
        while (!stop) { codes.push((await http('GET', '/health')).status || 'error'); await sleep(1000); }
    })();
    await sleep(5000);
    log(`💥 Terminando ${victim} (sin bajar la capacidad deseada)`);
    aws('autoscaling', 'terminate-instance-in-auto-scaling-group', '--instance-id', victim, '--no-should-decrement-desired-capacity');
    const t0 = Date.now();
    const all = [];
    let replaced = false;
    while (Date.now() - t0 < opt('minutos', 12) * 60_000) {
        await sleep(20_000);
        const th = targetHealth();
        const healthy = th.filter((s) => s.endsWith(':healthy')).length;
        const recent = codes.splice(0);
        all.push(...recent);
        log(`   targets: ${th.join(' ')} · últimas peticiones: ${fmtCounts(countBy(recent))}`);
        const nowIds = asgInfo(asg).ids;
        if (healthy >= g.desired && !nowIds.includes(victim)) { replaced = true; break; }
    }
    stop = true;
    await pinger;
    all.push(...codes.splice(0));
    const errors = all.filter((c) => c !== 200).length;
    log(`Peticiones durante la falla: ${all.length} · errores ${errors}`);
    verdict(replaced, replaced ? `el ASG reemplazó ${victim} y volvió a ${g.desired} instancias sanas` : 'el reemplazo no terminó a tiempo (revisa ./lab.sh status)');
    verdict(errors <= 3, `el servicio siguió respondiendo: ${errors} errores de ${all.length}`);
    grafana('Entrada › Instancias sanas en el target group', `${g.desired} → ${g.desired - 1} → ${g.desired}`);
    grafana('Entrada › Errores 5xx', '~0');
};

// ═════════════════════════ MAIN ═════════════════════════════════════════════

const SCENARIOS = {
    balanceo: [balanceo, 'el ALB reparte el tráfico entre instancias (~1 min)'],
    cache: [cache, 'MISS → HIT en el mapa con Redis (~10 s)'],
    idempotencia: [idempotencia, 'reintentos y doble clic no suman dos veces (~15 s)'],
    atomico: [atomico, 'canjes simultáneos sin saldo negativo (~10 s)'],
    ratelimit: [ratelimit, '429 tras 5 PIN equivocados (~10 s)'],
    cola: [cola, 'trabajos, duplicado e inválido en SQS + workers (~1–2 min)'],
    workers: [workers, 'el ASG de workers escala por la cola (~5–15 min)'],
    carga: [carga, 'el ASG de la API escala por CPU (~10–15 min; subir antes el WAF)'],
    waf: [waf, 'el WAF bloquea tu IP con 403 (bloquea ~5–10 min; requiere --si)'],
    falla: [falla, 'se cae una instancia y el servicio sigue (~6–10 min)'],
};
const RAPIDOS = ['balanceo', 'cache', 'idempotencia', 'atomico', 'ratelimit', 'cola'];

const usage = () => {
    console.log('Uso: ./lab.sh demo <escenario> [--opcion valor]\n');
    for (const [k, [, d]] of Object.entries(SCENARIOS)) console.log(`  ${k.padEnd(13)} ${d}`);
    console.log(`  ${'rapidos'.padEnd(13)} ${RAPIDOS.join(', ')} (~5 min)`);
    console.log('\nOpciones: balanceo --peticiones N · ratelimit --negocio N · workers --mensajes N --minutos N');
    console.log('          carga --concurrencia N --minutos N · falla --minutos N · waf --si');
};

const main = async () => {
    const list = SCENARIO === 'rapidos' ? RAPIDOS : SCENARIOS[SCENARIO] ? [SCENARIO] : null;
    if (!list) { usage(); process.exit(SCENARIO ? 1 : 0); }
    try { API = tf('api_url').replace(/\/+$/, ''); } catch { console.error('❌ No hay salida api_url: ¿corriste ./lab.sh up?'); process.exit(1); }
    let grafanaUrl = '';
    try { grafanaUrl = tf('grafana_url'); } catch { /* Grafana apagado */ }
    log(`API ${API}${grafanaUrl ? ` · Grafana ${grafanaUrl} (RewardsHub · Lab, rango "Last 30 minutes", refresco 10 s)` : ''}`);
    log(`Log completo en ${LOG_FILE}`);
    const health = await http('GET', '/health');
    if (health.status === 403) { bad('El WAF está bloqueando tu IP: espera ~5 min (o sube waf_rate_limit).'); process.exit(1); }
    if (health.status !== 200) { bad(`La API no responde en ${API}/health (${health.status || health.error}). Revisa ./lab.sh status`); process.exit(1); }
    for (const name of list) {
        try { await SCENARIOS[name][0](); } catch (err) { current = name; verdict(false, `error: ${err.message}`); }
    }
    current = 'resumen';
    console.log('');
    write('══════ RESUMEN ══════', C.bold);
    for (const r of results) (r.pass ? ok : bad)(`${r.scenario}: ${r.msg}`);
    log(`Log guardado en ${LOG_FILE}`);
    process.exit(results.every((r) => r.pass) ? 0 : 1);
};

main();
