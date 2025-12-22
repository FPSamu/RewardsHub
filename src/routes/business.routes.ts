import { Router } from 'express';
import multer from 'multer';
import * as businessCtrl from '../controllers/business.controller';
import { authenticateBusiness } from '../middleware/business.middleware';
import workShiftRoutes from './workShift.routes';
import reportRoutes from './report.routes';

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

// Email verification and password reset
router.get('/verify-email', businessCtrl.verifyEmail);
router.post('/forgot-password', businessCtrl.forgotPassword);
router.post('/reset-password', businessCtrl.resetPassword);

// Marketing emails
router.post('/send-reminder', authenticateBusiness, businessCtrl.sendRewardReminder);

// Location endpoints
router.put('/locations/:locationId', authenticateBusiness, businessCtrl.updateLocation);
router.get('/nearby', businessCtrl.getNearbyBusinesses);
router.get('/in-bounds', businessCtrl.getBusinessesInBounds);
router.get('/all', businessCtrl.getAllBusinesses);
router.post('/locations', authenticateBusiness, businessCtrl.addLocation);
router.delete('/locations/:locationId', authenticateBusiness, businessCtrl.removeLocation);

router.use('/work-shifts', workShiftRoutes);
router.use('/reports', reportRoutes);

// Get business by ID (must be last to avoid route conflicts)
router.get('/:id', businessCtrl.getBusinessById);

export default router;
