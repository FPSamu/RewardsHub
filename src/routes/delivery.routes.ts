import express from 'express';
import * as deliveryController from '../controllers/delivery.controller';
import { authenticate } from '../middleware/auth.middleware'; 
import { authenticateBusiness } from '../middleware/business.middleware';
import { idempotent } from '../middleware/idempotency.middleware';

const router = express.Router();

router.post('/generate', authenticateBusiness, deliveryController.generateCode);
router.post('/claim', authenticate, idempotent(), deliveryController.claimCode);

export default router;