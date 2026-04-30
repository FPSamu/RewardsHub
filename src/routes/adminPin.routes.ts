import { Router } from 'express';
import { generatePin, verifyPin, changePin, resetPin } from '../controllers/adminPin.controller';
import { authenticateBusiness } from '../middleware/business.middleware';

const router = Router();

// Platform admin generates a temp PIN and emails it to the business
router.post('/generate', generatePin);

// Business verifies their PIN → returns adminToken (30 min)
router.post('/verify', authenticateBusiness, verifyPin);

// Business changes their PIN (required when isTemporary: true)
router.post('/change', authenticateBusiness, changePin);

// Business resets their PIN by verifying their account password → new temp PIN emailed
router.post('/reset', authenticateBusiness, resetPin);

export default router;
