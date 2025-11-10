/**
 * Reward routes
 *
 * Exposes routes for managing reward systems:
 * - POST   /rewards/points      -> create a points-based reward system (protected)
 * - POST   /rewards/stamps      -> create a stamps-based reward system (protected)
 * - GET    /rewards              -> get all reward systems for the business (protected)
 * - GET    /rewards/:id          -> get a specific reward system (protected)
 * - PUT    /rewards/points/:id   -> update a points-based reward system (protected)
 * - PUT    /rewards/stamps/:id   -> update a stamps-based reward system (protected)
 * - DELETE /rewards/:id          -> delete a reward system (protected)
 */
import { Router } from 'express';
import * as rewardCtrl from '../controllers/reward.controller';
import { authenticateBusiness } from '../middleware/business.middleware';

const router = Router();

// All routes require business authentication
router.use(authenticateBusiness);

// Create reward systems
router.post('/points', rewardCtrl.createPointsReward);
router.post('/stamps', rewardCtrl.createStampsReward);

// Get reward systems
router.get('/', rewardCtrl.getRewards);
router.get('/:id', rewardCtrl.getRewardById);

// Update reward systems
router.put('/points/:id', rewardCtrl.updatePointsReward);
router.put('/stamps/:id', rewardCtrl.updateStampsReward);

// Delete reward systems
router.delete('/:id', rewardCtrl.deleteReward);

export default router;

