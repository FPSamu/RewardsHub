import express from 'express';
import * as deliveryController from '../controllers/delivery.controller';
import { authenticate } from '../middleware/auth.middleware'; 
import { authenticateBusiness } from '../middleware/business.middleware';

const router = express.Router();

router.post('/generate', authenticateBusiness, deliveryController.generateCode);
router.post('/claim', authenticate, deliveryController.claimCode);

export default router;