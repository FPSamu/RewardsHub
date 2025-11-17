import { Router } from 'express';
import * as businessCtrl from '../controllers/business.controller';
import { authenticateBusiness } from '../middleware/business.middleware';

const router = Router();

router.post('/register', businessCtrl.register);
router.post('/login', businessCtrl.login);
router.get('/me', authenticateBusiness, businessCtrl.me);
router.post('/refresh', businessCtrl.refresh);
router.post('/logout', businessCtrl.logout);
router.get('/:id', businessCtrl.getBusinessById);

export default router;
