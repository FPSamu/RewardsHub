import { Request, Response } from 'express';
import {
    getBusinessStats,
    getRecentClients,
    getStatsByBranch,
    getShiftStatsByBranch,
    getTimeSeriesStats,
    getAtRiskClients,
    getTopRewards,
    getBranchComparison,
    getKpiSummary,
} from '../services/businessStats.service';

/**
 * GET /business/stats
 * Devuelve métricas globales del negocio autenticado.
 */
export const getStats = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    try {
        const stats = await getBusinessStats(biz.id);
        return res.json(stats);
    } catch (err) {
        console.error('[businessStats] Error fetching stats:', err);
        return res.status(500).json({ message: 'failed to get business stats' });
    }
};

/**
 * GET /business/stats/shifts-by-branch
 * Devuelve transacciones agrupadas por sucursal y turno del negocio autenticado.
 */
export const getShiftStatsByBranchHandler = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    try {
        const stats = await getShiftStatsByBranch(biz.id);
        return res.json(stats);
    } catch (err) {
        console.error('[businessStats] Error fetching shift stats by branch:', err);
        return res.status(500).json({ message: 'failed to get shift stats' });
    }
};

/**
 * GET /business/stats/by-branch
 * Devuelve transacciones agrupadas por sucursal del negocio autenticado.
 */
export const getStatsByBranchHandler = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    try {
        const stats = await getStatsByBranch(biz.id);
        return res.json(stats);
    } catch (err) {
        console.error('[businessStats] Error fetching stats by branch:', err);
        return res.status(500).json({ message: 'failed to get branch stats' });
    }
};

/**
 * GET /business/recent-clients?limit=5
 * Devuelve los clientes más recientes del negocio autenticado.
 */
export const getRecentClientsHandler = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    const limit = Math.min(parseInt(req.query.limit as string) || 5, 50);

    try {
        const clients = await getRecentClients(biz.id, limit);
        return res.json(clients);
    } catch (err) {
        console.error('[businessStats] Error fetching recent clients:', err);
        return res.status(500).json({ message: 'failed to get recent clients' });
    }
};

/**
 * GET /business/stats/timeseries?days=30
 * Devuelve la serie diaria de actividad de los últimos N días.
 */
export const getTimeSeriesStatsHandler = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 7), 90);

    try {
        const stats = await getTimeSeriesStats(biz.id, days);
        return res.json(stats);
    } catch (err) {
        console.error('[businessStats] Error fetching time series stats:', err);
        return res.status(500).json({ message: 'failed to get time series stats' });
    }
};

/**
 * GET /business/stats/at-risk-clients?days=30&limit=20
 * Devuelve clientes que no han vuelto en al menos `days` días.
 */
export const getAtRiskClientsHandler = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    const days = Math.max(parseInt(req.query.days as string) || 30, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);

    try {
        const clients = await getAtRiskClients(biz.id, days, limit);
        return res.json(clients);
    } catch (err) {
        console.error('[businessStats] Error fetching at-risk clients:', err);
        return res.status(500).json({ message: 'failed to get at-risk clients' });
    }
};

/**
 * GET /business/stats/top-rewards?limit=5
 * Devuelve las recompensas más canjeadas del negocio autenticado.
 */
export const getTopRewardsHandler = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);
    const days = req.query.days ? Math.min(Math.max(parseInt(req.query.days as string), 7), 90) : undefined;

    try {
        const rewards = await getTopRewards(biz.id, limit, days);
        return res.json(rewards);
    } catch (err) {
        console.error('[businessStats] Error fetching top rewards:', err);
        return res.status(500).json({ message: 'failed to get top rewards' });
    }
};

/**
 * GET /business/stats/kpi-summary?days=30
 * Resumen para la franja de KPIs: métricas con tendencia (periodo actual vs
 * el anterior) más las que son una foto del momento.
 */
export const getKpiSummaryHandler = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 7), 90);

    try {
        const summary = await getKpiSummary(biz.id, days);
        return res.json(summary);
    } catch (err) {
        console.error('[businessStats] Error fetching KPI summary:', err);
        return res.status(500).json({ message: 'failed to get KPI summary' });
    }
};

/**
 * GET /business/stats/branch-comparison?days=30
 * Compara la actividad por sucursal del periodo actual contra el anterior.
 */
export const getBranchComparisonHandler = async (req: Request, res: Response) => {
    const biz = req.business;
    if (!biz) return res.status(401).json({ message: 'not authenticated' });

    const days = Math.min(Math.max(parseInt(req.query.days as string) || 30, 7), 90);

    try {
        const comparison = await getBranchComparison(biz.id, days);
        return res.json(comparison);
    } catch (err) {
        console.error('[businessStats] Error fetching branch comparison:', err);
        return res.status(500).json({ message: 'failed to get branch comparison' });
    }
};
