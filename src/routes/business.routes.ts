import { Router } from 'express';
import multer from 'multer';
import * as businessCtrl from '../controllers/business.controller';
import { getStats, getRecentClientsHandler } from '../controllers/businessStats.controller';
import { authenticateBusiness } from '../middleware/business.middleware';
import { requireAdminPin } from '../middleware/adminPin.middleware';
import adminPinRoutes from './adminPin.routes';
import workShiftRoutes from './workShift.routes';
import reportRoutes from './report.routes';

const router = Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
});

router.get('/me', authenticateBusiness, businessCtrl.me);
router.put('/me', authenticateBusiness, requireAdminPin, businessCtrl.updateBusiness);
router.delete('/me', authenticateBusiness, requireAdminPin, businessCtrl.deleteAccount);
router.post('/logo', authenticateBusiness, requireAdminPin, upload.single('logo'), businessCtrl.uploadLogo);

// Email verification and password reset
router.get('/verify-email', businessCtrl.verifyEmail);
router.post('/forgot-password', businessCtrl.forgotPassword);
router.post('/reset-password', businessCtrl.resetPassword);

// Contraseña de sucursal para cajeros
router.post('/branch-password', authenticateBusiness, businessCtrl.createBranchPassword);
router.put('/branch-password', authenticateBusiness, requireAdminPin, businessCtrl.updateBranchPassword);

// Marketing emails
router.post('/send-reminder', authenticateBusiness, businessCtrl.sendRewardReminder);

// Location endpoints
router.put('/locations/:locationId', authenticateBusiness, businessCtrl.updateLocation);
router.get('/nearby', businessCtrl.getNearbyBusinesses);
router.get('/in-bounds', businessCtrl.getBusinessesInBounds);
router.get('/all', businessCtrl.getAllBusinesses);
router.post('/locations', authenticateBusiness, businessCtrl.addLocation);
router.delete('/locations/:locationId', authenticateBusiness, businessCtrl.removeLocation);

router.use('/admin-pin', adminPinRoutes);
router.use('/work-shifts', workShiftRoutes);
router.use('/reports', reportRoutes);

// Stats & dashboard
router.get('/stats', authenticateBusiness, getStats);
router.get('/recent-clients', authenticateBusiness, getRecentClientsHandler);

// Get business by ID (must be last to avoid route conflicts)
router.get('/:id', businessCtrl.getBusinessById);

export default router;
