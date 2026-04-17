/**
 * System routes
 *
 * This module defines routes for reward system management.
 */
import express from 'express';
import * as systemController from '../controllers/system.controller';
import { authenticateBusiness } from '../middleware/business.middleware';
import { requireAdminPin } from '../middleware/adminPin.middleware';

const router = express.Router();

// All routes require business authentication
router.use(authenticateBusiness);

// Read-only: no PIN required
router.get('/', systemController.getSystemsForBusiness);
router.get('/:systemId', systemController.getSystemById);

// Write operations: require admin PIN
router.post('/points', requireAdminPin, systemController.createPointsSystem);
router.post('/stamps', requireAdminPin, systemController.createStampsSystem);
router.put('/points/:systemId', requireAdminPin, systemController.updatePointsSystem);
router.put('/stamps/:systemId', requireAdminPin, systemController.updateStampsSystem);
router.delete('/:systemId', requireAdminPin, systemController.deleteSystem);

export default router;
