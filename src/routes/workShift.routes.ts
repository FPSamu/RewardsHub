/**
 * WorkShift routes
 * 
 * Defines routes for work shift management.
 */

import { Router } from 'express';
import * as workShiftCtrl from '../controllers/workShift.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Create a new work shift
router.post('/', workShiftCtrl.createWorkShift);

// Get work shifts for authenticated business (must be before /:id route)
router.get('/', workShiftCtrl.getMyWorkShifts);

// Get all work shifts for a business
router.get('/business/:businessId', workShiftCtrl.getWorkShiftsByBusiness);

// Get a specific work shift
router.get('/:id', workShiftCtrl.getWorkShiftById);

// Update a work shift
router.put('/:id', workShiftCtrl.updateWorkShift);

// Delete a work shift
router.delete('/:id', workShiftCtrl.deleteWorkShift);

// Toggle work shift active status
router.patch('/:id/toggle', workShiftCtrl.toggleWorkShiftStatus);

export default router;
