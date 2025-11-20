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

const router = Router();

// Public route: Get rewards by business ID (for clients)
router.get('/business/:businessId', rewardCtrl.getRewardsByBusinessId);

// All routes below require business authentication
router.use(authenticateBusiness);

// Create reward
router.post('/', rewardCtrl.createReward);

// Get rewards
router.get('/', rewardCtrl.getRewards);
router.get('/system/:systemId', rewardCtrl.getRewardsBySystemId);
router.get('/:id', rewardCtrl.getRewardById);

// Update reward
router.put('/:id', rewardCtrl.updateReward);

// Delete reward
router.delete('/:id', rewardCtrl.deleteReward);

export default router;

