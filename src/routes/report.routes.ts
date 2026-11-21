/**
 * Report routes
 * 
 * Defines routes for report generation.
 */

import { Router } from 'express';
import * as reportCtrl from '../controllers/report.controller';
import { authenticateBusiness } from '../middleware/business.middleware';
import { reportLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

// All routes require business authentication
router.use(authenticateBusiness);

// Generate PDF report
router.post('/generate', reportLimiter, reportCtrl.generateReport);

// Get report preview (JSON data without PDF)
router.post('/preview', reportLimiter, reportCtrl.getReportPreview);

export default router;
