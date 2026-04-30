/**
 * Reward routes
 *
 * Exposes routes for managing individual rewards:
 * - POST   /rewards              -> create a reward (protected)
 * - GET    /rewards              -> get all rewards for the business (protected)
 * - GET    /rewards/system/:systemId -> get all rewards for a specific system (protected)
 * - GET    /rewards/:id          -> get a specific reward (protected)
 * - PUT    /rewards/:id          -> update a reward (protected)
 * - DELETE /rewards/:id          -> delete a reward (protected)
 * - GET    /rewards/business/:businessId -> get rewards by business ID (public)
 */
import { Router } from 'express';
import * as rewardCtrl from '../controllers/reward.controller';
import { authenticateBusiness } from '../middleware/business.middleware';
import { requireAdminPin } from '../middleware/adminPin.middleware';

const router = Router();

// Public route: Get rewards by business ID (for clients)
router.get('/business/:businessId', rewardCtrl.getRewardsByBusinessId);

// All routes below require business authentication
router.use(authenticateBusiness);

// Read-only: no PIN required
router.get('/', rewardCtrl.getRewards);
router.get('/system/:systemId', rewardCtrl.getRewardsBySystemId);
router.get('/:id', rewardCtrl.getRewardById);

// Write operations: require admin PIN
router.post('/', requireAdminPin, rewardCtrl.createReward);
router.put('/:id', requireAdminPin, rewardCtrl.updateReward);
router.delete('/:id', requireAdminPin, rewardCtrl.deleteReward);

export default router;

