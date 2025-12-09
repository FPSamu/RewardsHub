import { Router } from 'express';
import multer from 'multer';
import * as businessCtrl from '../controllers/business.controller';
import { authenticateBusiness } from '../middleware/business.middleware';

const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
});

router.post('/register', businessCtrl.register);
router.post('/login', businessCtrl.login);
router.get('/me', authenticateBusiness, businessCtrl.me);
router.put('/me', authenticateBusiness, businessCtrl.updateBusiness);
router.delete('/me', authenticateBusiness, businessCtrl.deleteAccount);
router.post('/logo', authenticateBusiness, upload.single('logo'), businessCtrl.uploadLogo);
router.post('/refresh', businessCtrl.refresh);
router.post('/logout', businessCtrl.logout);

// Location endpoints
router.put('/location', authenticateBusiness, businessCtrl.updateLocation);
router.put('/coordinates', authenticateBusiness, businessCtrl.updateCoordinates);
router.get('/nearby', businessCtrl.getNearbyBusinesses);

// Get business by ID (must be last to avoid route conflicts)
router.get('/:id', businessCtrl.getBusinessById);

export default router;
