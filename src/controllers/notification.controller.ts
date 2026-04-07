/**
 * Notification controllers
 *
 * Exposes endpoints for manually triggering reward notifications.
 * Businesses can trigger notifications for their own customers.
 */
import { Request, Response } from 'express';
import { notifyBusinessUsers, runNotificationBatch } from '../services/notification.service';

/**
 * POST /notifications/trigger
 * Triggers reward notifications for all users who have points at the authenticated business.
 * Requires business authentication.
 */
export const triggerBusinessNotifications = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const business = req.business;
        if (!business) {
            res.status(401).json({ message: 'not authenticated' });
            return;
        }

        const result = await notifyBusinessUsers(business.id);
        res.json({
            message: 'Notificaciones enviadas correctamente',
            ...result,
        });
    } catch (err: any) {
        console.error('❌ [Notifications] triggerBusinessNotifications error:', err);
        res.status(500).json({ message: 'Error al enviar notificaciones', error: err.message });
    }
};

/**
 * POST /notifications/run-batch
 * Runs the full notification batch across all users.
 * Only available in non-production or with the ADMIN_SECRET header.
 */
export const runBatch = async (req: Request, res: Response): Promise<void> => {
    try {
        const adminSecret = process.env.ADMIN_SECRET;
        if (adminSecret && req.headers['x-admin-secret'] !== adminSecret) {
            res.status(403).json({ message: 'Forbidden' });
            return;
        }

        const result = await runNotificationBatch();
        res.json({ message: 'Batch completado', ...result });
    } catch (err: any) {
        console.error('❌ [Notifications] runBatch error:', err);
        res.status(500).json({ message: 'Error en el batch', error: err.message });
    }
};
