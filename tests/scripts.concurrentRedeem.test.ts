/**
 * P1.7 — la lógica pura del script de carga (no se corre contra ningún servidor).
 */
import { parseArgs, expectedOutcome } from '../scripts/load/concurrent-redeem';

describe('concurrent-redeem: parseArgs', () => {
    it('usa los defaults del seed y exige --url', () => {
        expect(parseArgs(['--url', 'http://alb.example/'])).toEqual({
            url: 'http://alb.example', email: 'negocio01@seed.rewardshub.test', password: 'lab12345',
            n: 20, amount: 10, topup: 0, sameKey: false,
        });
        expect(() => parseArgs([])).toThrow(/--url es obligatoria/);
    });

    it('lee las opciones', () => {
        const o = parseArgs(['--url', 'http://x', '--n', '30', '--amount', '5', '--topup', '200', '--same-key', '--user', 'u1']);
        expect(o).toMatchObject({ n: 30, amount: 5, topup: 200, sameKey: true, user: 'u1' });
    });

    it.each([[['--url', 'x', '--n', '0']], [['--url', 'x', '--n']], [['--url', 'x', '--bogus']]])('rechaza %p', (argv) => {
        expect(() => parseArgs(argv)).toThrow();
    });
});

describe('concurrent-redeem: expectedOutcome', () => {
    it('pasan solo las restas que caben en el saldo', () => {
        expect(expectedOutcome(100, 20, 10, false)).toEqual({ successes: 10, final: 0 });
        expect(expectedOutcome(95, 20, 10, false)).toEqual({ successes: 9, final: 5 });
        expect(expectedOutcome(500, 20, 10, false)).toEqual({ successes: 20, final: 300 });
    });

    it('con la misma Idempotency-Key solo una resta', () => {
        expect(expectedOutcome(100, 20, 10, true)).toEqual({ successes: 1, final: 90 });
        expect(expectedOutcome(5, 20, 10, true)).toEqual({ successes: 0, final: 5 });
    });
});
