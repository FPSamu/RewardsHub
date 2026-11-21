/**
 * Demo de concurrencia (P1.7): N restas simultáneas al mismo cliente a través
 * del ALB. Con escrituras atómicas el saldo final es exactamente el esperado,
 * aunque las peticiones caigan en instancias distintas de la API.
 *
 *   npx ts-node scripts/load/concurrent-redeem.ts --url http://<alb>
 *   npx ts-node scripts/load/concurrent-redeem.ts --url http://<alb> --n 30 --amount 10 --topup 200
 *   npx ts-node scripts/load/concurrent-redeem.ts --url http://<alb> --same-key   # demo de Idempotency-Key
 *
 * Opciones:
 *   --url        URL de la API (obligatoria; en el lab: terraform output -raw api_url)
 *   --email      cuenta de negocio del seed (default negocio01@seed.rewardshub.test)
 *   --password   contraseña de sucursal (default lab12345, la del seed)
 *   --user       userId a usar (default: el cliente con más puntos en ese negocio)
 *   --n          peticiones simultáneas (default 20)
 *   --amount     puntos por resta (default 10)
 *   --topup      suma estos puntos antes de empezar (una compra), para tener saldo
 *   --same-key   todas las peticiones con la MISMA Idempotency-Key → solo una debe restar
 *
 * Solo habla HTTP con la API (no usa AWS). Escribe en la base del lab a través
 * de la API: correrlo solo contra el lab, nunca contra producción.
 * Sale con código 1 si el saldo final no es el esperado.
 */
import { randomUUID } from 'crypto';

interface Options {
    url: string;
    email: string;
    password: string;
    user?: string;
    n: number;
    amount: number;
    topup: number;
    sameKey: boolean;
}

export const parseArgs = (argv: string[]): Options => {
    const opts: Options = {
        url: '', email: 'negocio01@seed.rewardshub.test', password: 'lab12345',
        n: 20, amount: 10, topup: 0, sameKey: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        const value = () => {
            const v = argv[++i];
            if (v === undefined) throw new Error(`${arg} necesita un valor`);
            return v;
        };
        const positive = () => {
            const v = Number(value());
            if (!Number.isInteger(v) || v < 1) throw new Error(`${arg} necesita un entero positivo`);
            return v;
        };
        switch (arg) {
            case '--url': opts.url = value().replace(/\/+$/, ''); break;
            case '--email': opts.email = value(); break;
            case '--password': opts.password = value(); break;
            case '--user': opts.user = value(); break;
            case '--n': opts.n = positive(); break;
            case '--amount': opts.amount = positive(); break;
            case '--topup': opts.topup = positive(); break;
            case '--same-key': opts.sameKey = true; break;
            default: throw new Error(`Opción desconocida: ${arg}`);
        }
    }
    if (!opts.url) throw new Error('--url es obligatoria (p. ej. --url $(terraform -chdir=infra/aws output -raw api_url))');
    return opts;
};

/**
 * Saldo esperado tras N restas de `amount` sobre `before`: pasan las que caben
 * (o solo una si comparten Idempotency-Key).
 */
export const expectedOutcome = (before: number, n: number, amount: number, sameKey: boolean) => {
    const successes = sameKey ? (before >= amount ? 1 : 0) : Math.min(n, Math.floor(before / amount));
    return { successes, final: before - successes * amount };
};

const api = (base: string, token?: string) =>
    async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
        const res = await fetch(`${base}${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token && { Authorization: `Bearer ${token}` }),
                ...headers,
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        let json: any;
        try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
        return { status: res.status, headers: res.headers, body: json };
    };

const must = <T extends { status: number; body: any }>(res: T, what: string): T => {
    if (res.status >= 400) throw new Error(`${what} falló: ${res.status} ${JSON.stringify(res.body)}`);
    return res;
};

const main = async () => {
    const opts = parseArgs(process.argv.slice(2));
    console.log(`🎯 ${opts.url} · ${opts.n} restas de ${opts.amount} pts${opts.sameKey ? ' · MISMA Idempotency-Key' : ''}`);

    // 1. Login de cajero con la cuenta del seed
    const login = must(await api(opts.url)('POST', '/auth/cashier-login', { email: opts.email, password: opts.password }), 'login');
    const call = api(opts.url, login.body.token);

    // 2. Sistema de puntos y sucursal principal del negocio
    const systems = must(await call('GET', '/systems'), 'GET /systems').body as any[];
    const points = systems.find((s) => s.type === 'points' && s.isActive);
    if (!points) throw new Error('El negocio no tiene un sistema de puntos activo');
    const me = must(await call('GET', '/business/me'), 'GET /business/me').body;
    const branch = (me.locations ?? []).find((l: any) => l.isMain) ?? me.locations?.[0];
    const branchId = branch?._id;

    // 3. Cliente: el indicado, o el que más puntos tenga en ese sistema
    let userId = opts.user;
    if (!userId) {
        const { users } = must(await call('GET', '/user-points/business-users'), 'GET /user-points/business-users').body;
        const balanceIn = (u: any) => u.businessPoints.rewardSystems.find((r: any) => r.rewardSystemId === points.id)?.points ?? 0;
        const best = (users as any[]).sort((a, b) => balanceIn(b) - balanceIn(a))[0];
        if (!best) throw new Error('El negocio no tiene clientes; corre antes npm run seed:lab o usa --user');
        userId = best.userId as string;
    }

    const balance = async () => {
        const res = must(await call('GET', `/user-points/${userId}`), 'leer saldo');
        return (res.body?.rewardSystems ?? []).find((r: any) => r.rewardSystemId === points.id)?.points ?? 0;
    };

    // 4. Recarga opcional
    if (opts.topup > 0) {
        const purchaseAmount = Math.ceil((opts.topup * points.pointsConversion.amount) / points.pointsConversion.points);
        must(await call('POST', '/user-points/add', { userId, purchaseAmount, branchId }, { 'Idempotency-Key': randomUUID() }), 'recarga');
    }

    const before = await balance();
    const expected = expectedOutcome(before, opts.n, opts.amount, opts.sameKey);
    console.log(`👤 cliente ${userId} · saldo inicial ${before} pts · sistema "${points.name}"`);

    // 5. N restas a la vez
    const sharedKey = randomUUID();
    const started = Date.now();
    const responses = await Promise.all(Array.from({ length: opts.n }, () =>
        call('POST', '/user-points/subtract',
            { userId, pointsToSubtract: opts.amount, rewardSystemId: points.id, branchId },
            { 'Idempotency-Key': opts.sameKey ? sharedKey : randomUUID() })));
    const ms = Date.now() - started;

    const histogram: Record<string, number> = {};
    let replayed = 0;
    for (const r of responses) {
        const label = r.headers.get('idempotent-replayed') === 'true' ? `${r.status} (replay)` : String(r.status);
        histogram[label] = (histogram[label] ?? 0) + 1;
        if (r.headers.get('idempotent-replayed') === 'true') replayed++;
    }
    const applied = responses.filter((r) => r.status === 200 && r.headers.get('idempotent-replayed') !== 'true').length;

    // 6. Resultado
    const after = await balance();
    console.log(`\n⏱  ${opts.n} peticiones en ${ms} ms`);
    console.table(histogram);
    console.log(`restas aplicadas: ${applied} (esperadas ${expected.successes}) · replays: ${replayed}`);
    console.log(`saldo final:      ${after} pts (esperado ${expected.final})`);

    const ok = after === expected.final && applied === expected.successes;
    console.log(ok ? '\n✅ Sin pérdidas ni dobles restas.' : '\n❌ El saldo NO cuadra.');
    process.exit(ok ? 0 : 1);
};

if (require.main === module) {
    main().catch((err) => {
        console.error('❌', err?.message ?? err);
        process.exit(1);
    });
}
