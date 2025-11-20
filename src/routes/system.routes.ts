/**
 * System routes
 *
 * This module defines routes for reward system management.
 */
import express from 'express';
import * as systemController from '../controllers/system.controller';
import { authenticateBusiness } from '../middleware/business.middleware';

const router = express.Router();

// All routes require business authentication
router.use(authenticateBusiness);

// Create systems
router.post('/points', systemController.createPointsSystem);
router.post('/stamps', systemController.createStampsSystem);

// Get systems
router.get('/', systemController.getSystemsForBusiness);
router.get('/:systemId', systemController.getSystemById);

// Update systems
router.put('/points/:systemId', systemController.updatePointsSystem);
router.put('/stamps/:systemId', systemController.updateStampsSystem);

// Delete system
router.delete('/:systemId', systemController.deleteSystem);

export default router;
