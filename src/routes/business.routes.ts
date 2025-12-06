import { Router } from 'express';
import * as businessCtrl from '../controllers/business.controller';
import { authenticateBusiness } from '../middleware/business.middleware';

const router = Router();

router.post('/register', businessCtrl.register);
router.post('/login', businessCtrl.login);
router.get('/me', authenticateBusiness, businessCtrl.me);
router.put('/me', authenticateBusiness, businessCtrl.updateBusiness);
router.post('/refresh', businessCtrl.refresh);
router.post('/logout', businessCtrl.logout);

// Location endpoints
router.put('/location', authenticateBusiness, businessCtrl.updateLocation);
router.put('/coordinates', authenticateBusiness, businessCtrl.updateCoordinates);
router.get('/nearby', businessCtrl.getNearbyBusinesses);

// Get business by ID (must be last to avoid route conflicts)
router.get('/:id', businessCtrl.getBusinessById);

export default router;
