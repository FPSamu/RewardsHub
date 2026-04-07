/**
 * Notification routes
 *
 * POST /notifications/trigger   — business triggers notifications for their customers
 * POST /notifications/run-batch — internal/admin batch run
 */
import { Router } from 'express';
import { authenticateBusiness } from '../middleware/business.middleware';
import { triggerBusinessNotifications, runBatch } from '../controllers/notification.controller';

const router = Router();

router.post('/trigger', authenticateBusiness, triggerBusinessNotifications);
router.post('/run-batch', runBatch);

export default router;
