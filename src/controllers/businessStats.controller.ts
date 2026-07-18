import { Request, Response } from 'express';
import { getBusinessStats, getRecentClients, getStatsByBranch, getShiftStatsByBranch } from '../services/businessStats.service';

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
