/**
 * P5.3 — partes puras de scripts/compare-stats-sources.ts (no se corre contra ninguna base).
 */
import { parseArgs, firstDifference } from '../scripts/compare-stats-sources';

describe('compare-stats-sources', () => {
    it('opciones con defaults y validación', () => {
        expect(parseArgs([])).toEqual({ businesses: 10, days: 30 });
        expect(parseArgs(['--businesses', '3', '--days', '7'])).toEqual({ businesses: 3, days: 7 });
        expect(() => parseArgs(['--days', '120'])).toThrow(/7 a 90/);
        expect(() => parseArgs(['--x', '1'])).toThrow();
        expect(() => parseArgs(['--businesses', '0'])).toThrow();
    });

    it('firstDifference da la ruta de la primera diferencia (o null)', () => {
        const a = { series: [{ date: '2026-11-01', revenue: 10 }], kpi: { revenue: { current: 5 } } };
        expect(firstDifference(a, structuredClone(a))).toBeNull();
        const b = structuredClone(a);
        b.series[0].revenue = 11;
        expect(firstDifference(a, b)).toBe('series.0.revenue: 10 ≠ 11');
        expect(firstDifference({ x: 1 }, { x: 1, y: 2 })).toBe('y: undefined ≠ 2');
    });
});
