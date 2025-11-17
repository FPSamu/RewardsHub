/**
 * UserPoints routes
 *
 * Exposes routes for managing user points and stamps:
 * - POST   /user-points/add                  -> add points/stamps to a user (protected - business)
 * - GET    /user-points                      -> get user's points (protected - user)
 * - GET    /user-points/business/:businessId -> get user's points for a specific business (protected - user)
 * - GET    /user-points/:userId              -> get user's points for a specific business (protected - business)
 */
import { Router } from 'express';
import * as userPointsCtrl from '../controllers/userPoints.controller';
import { authenticateBusiness } from '../middleware/business.middleware';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Business endpoint: Add points/stamps to a user
router.post('/add', authenticateBusiness, userPointsCtrl.addPointsOrStamps);

// Business endpoint: Get all users with points/stamps at this business
router.get('/business-users', authenticateBusiness, userPointsCtrl.getAllUsersForBusiness);

// User endpoint: Get own points
router.get('/', authenticate, userPointsCtrl.getUserPoints);

// User endpoint: Get own points for a specific business
router.get('/business/:businessId', authenticate, userPointsCtrl.getUserPointsForBusinessByUser);

// Business endpoint: Get user points for this business
router.get('/:userId', authenticateBusiness, userPointsCtrl.getUserPointsForBusiness);

export default router;

