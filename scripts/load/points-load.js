/**
 * Prueba de carga (k6) del flujo crítico de caja: escanear al cliente (leer su
 * saldo) y sumarle puntos. Sube los usuarios virtuales por etapas hasta
 * saturar la API y disparar el autoescalado del ASG (CPU > api_cpu_target).
 * Es la carga de la aceptación 6 (docs/LAB-RUNBOOK.md → D.6).
 *
 *   k6 run -e API_URL=http://<alb> scripts/load/points-load.js
 *   k6 run -e API_URL=http://<alb> -e PEAK_VUS=300 -e HOLD=12m scripts/load/points-load.js
 *
 * Variables (-e NOMBRE=valor):
 *   API_URL     URL de la API (obligatoria; en el lab: terraform -chdir=infra/aws output -raw api_url)
 *   PEAK_VUS    usuarios virtuales en el pico (default 200)
 *   RAMP        duración de cada una de las 3 rampas de subida (default 3m)
 *   HOLD        tiempo sostenido en el pico (default 10m: el ASG tarda ~10 min en
 *               decidir, arrancar y compilar una instancia nueva)
 *   BUSINESSES  cuántos negocios del seed reparten la carga (default 10 → negocio01..negocio10)
 *   PASSWORD    contraseña de sucursal del seed (default lab12345, ver src/cli/seed.ts)
 *
 * Cuentas: usa los negocios del seed (./lab.sh seed) con el login de cajero,
 * que no pasa por Firebase. No crea cuentas ni toca Firebase ni producción.
 * Cada iteración crea una transacción real en la base del LAB: correrlo solo
 * contra el ALB del lab, nunca contra producción.
 *
 * NFR: p95 < 500 ms y < 1 % de errores (umbrales abajo; k6 sale con código
 * 99 si alguno no se cumple). Ojo: la latencia que mide k6 incluye tu
 * conexión a us-east-1; la del ALB (panel "Tiempo de respuesta" en Grafana)
 * no la incluye.
 *
 * WAF: con el límite por defecto (1000 peticiones / 5 min por IP) el ALB
 * bloquea a esta prueba en segundos (403). Súbelo antes (LAB-RUNBOOK D.6).
 * Los 403/429 se cuentan aparte en la métrica `blocked_requests`.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

const API_URL = (__ENV.API_URL || '').replace(/\/+$/, '');
const PEAK_VUS = parseInt(__ENV.PEAK_VUS || '200', 10);
const RAMP = __ENV.RAMP || '3m';
const HOLD = __ENV.HOLD || '10m';
const BUSINESSES = parseInt(__ENV.BUSINESSES || '10', 10);
const PASSWORD = __ENV.PASSWORD || 'lab12345';
const USERS_PER_BUSINESS = 100;

const blocked = new Counter('blocked_requests'); // 403 (WAF) y 429 (rate limit)

export const options = {
    scenarios: {
        caja: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: RAMP, target: Math.ceil(PEAK_VUS * 0.25) },
                { duration: RAMP, target: Math.ceil(PEAK_VUS * 0.5) },
                { duration: RAMP, target: PEAK_VUS },
                { duration: HOLD, target: PEAK_VUS },
                { duration: '2m', target: 0 },
            ],
            gracefulRampDown: '30s',
        },
    },
    // Solo cuentan las peticiones del escenario (no las del setup)
    thresholds: {
        'http_req_failed{scenario:caja}': ['rate<0.01'],
        'http_req_duration{scenario:caja}': ['p(95)<500'],
        'http_req_duration{name:GET /user-points/:userId}': ['p(95)<500', 'p(99)<1500'],
        'http_req_duration{name:POST /user-points/add}': ['p(95)<500', 'p(99)<1500'],
        checks: ['rate>0.99'],
    },
    summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const pad2 = (n) => (n < 10 ? `0${n}` : String(n));

// UUID v4 para Idempotency-Key (una llave por suma, como el front)
const uuidv4 = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
});

const jsonHeaders = (token, extra = {}) => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
});

const cashierLogin = (email) => {
    const res = http.post(`${API_URL}/auth/cashier-login`, JSON.stringify({ email, password: PASSWORD }), {
        headers: jsonHeaders(),
        tags: { name: 'POST /auth/cashier-login' },
    });
    if (res.status !== 200) {
        throw new Error(`login de ${email} falló: ${res.status} ${res.body}`);
    }
    return res.json('token');
};

const getJson = (path, token) => {
    const res = http.get(`${API_URL}${path}`, { headers: jsonHeaders(token), tags: { name: `setup ${path}` } });
    if (res.status !== 200) throw new Error(`GET ${path} falló: ${res.status} ${res.body}`);
    return res.json();
};

/**
 * Una vez antes de la prueba: login de cajero en N negocios del seed y, por
 * cada uno, su sistema de puntos, su sucursal principal y hasta 100 clientes.
 */
export function setup() {
    if (!API_URL) throw new Error('Falta -e API_URL=http://<alb del lab>');
    const health = http.get(`${API_URL}/health`);
    if (health.status !== 200) throw new Error(`La API no responde en ${API_URL}/health (${health.status})`);

    const businesses = [];
    for (let i = 1; i <= BUSINESSES; i++) {
        const email = `negocio${pad2(i)}@seed.rewardshub.test`;
        const token = cashierLogin(email);
        const systems = getJson('/systems', token);
        const points = (systems || []).find((s) => s.type === 'points' && s.isActive);
        if (!points) {
            console.warn(`${email} no tiene sistema de puntos activo: se omite`);
            continue;
        }
        const me = getJson('/business/me', token);
        const branch = (me.locations || []).find((l) => l.isMain) || (me.locations || [])[0];
        const { users } = getJson('/user-points/business-users', token);
        const userIds = (users || []).slice(0, USERS_PER_BUSINESS).map((u) => u.userId);
        if (userIds.length === 0) {
            console.warn(`${email} no tiene clientes: se omite`);
            continue;
        }
        businesses.push({ email, token, branchId: branch ? branch._id : undefined, userIds });
    }
    if (businesses.length === 0) {
        throw new Error('Ningún negocio del seed sirve. ¿Corriste ./lab.sh seed?');
    }
    console.log(`setup: ${businesses.length} negocios, ${businesses.reduce((n, b) => n + b.userIds.length, 0)} clientes`);
    return { businesses };
}

// Token por VU: si expira (ACCESS_EXPIRES) se vuelve a hacer login una vez.
// Los logins correctos no gastan el cupo del rate limit (solo cuentan los fallidos).
let tokens = null;

const request = (biz, idx, method, path, body, extraHeaders, name) => {
    const send = () => {
        const params = { headers: jsonHeaders(tokens[idx], extraHeaders), tags: { name } };
        return method === 'GET'
            ? http.get(`${API_URL}${path}`, params)
            : http.post(`${API_URL}${path}`, JSON.stringify(body), params);
    };
    let res = send();
    if (res.status === 401) {
        tokens[idx] = cashierLogin(biz.email);
        res = send(); // misma petición (y misma Idempotency-Key)
    }
    if (res.status === 403 || res.status === 429) blocked.add(1, { name, status: String(res.status) });
    return res;
};

export default function (data) {
    if (tokens === null) tokens = data.businesses.map((b) => b.token);

    const idx = (__VU + __ITER) % data.businesses.length;
    const biz = data.businesses[idx];
    const userId = biz.userIds[Math.floor(Math.random() * biz.userIds.length)];

    // 1. El cajero escanea el QR: lee el saldo del cliente en su negocio
    const read = request(biz, idx, 'GET', `/user-points/${userId}`, null, {}, 'GET /user-points/:userId');
    check(read, { 'leer saldo → 200': (r) => r.status === 200 });

    // 2. Registra la compra: suma puntos (una Idempotency-Key nueva por compra)
    const purchaseAmount = 50 + Math.floor(Math.random() * 450);
    const add = request(
        biz, idx, 'POST', '/user-points/add',
        { userId, purchaseAmount, ...(biz.branchId ? { branchId: biz.branchId } : {}) },
        { 'Idempotency-Key': uuidv4() },
        'POST /user-points/add',
    );
    check(add, { 'sumar puntos → 2xx': (r) => r.status >= 200 && r.status < 300 });

    // Tiempo entre clientes en caja
    sleep(0.5 + Math.random());
}
