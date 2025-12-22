/**
 * Report routes
 * 
 * Defines routes for report generation.
 */

import { Router } from 'express';
import * as reportCtrl from '../controllers/report.controller';
import { authenticateBusiness } from '../middleware/business.middleware';

const router = Router();

// All routes require business authentication
router.use(authenticateBusiness);

// Generate PDF report
router.post('/generate', reportCtrl.generateReport);

// Get report preview (JSON data without PDF)
router.post('/preview', reportCtrl.getReportPreview);

export default router;
