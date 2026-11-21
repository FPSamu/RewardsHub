import { Router } from 'express';
import { generatePin, verifyPin, changePin, resetPin } from '../controllers/adminPin.controller';
import { authenticateBusiness } from '../middleware/business.middleware';
import { adminPinLimiter, adminPinResetLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

// Platform admin generates a temp PIN and emails it to the business
router.post('/generate', generatePin);

// Business verifies their PIN → returns adminToken (30 min)
router.post('/verify', authenticateBusiness, adminPinLimiter, verifyPin);

// Business changes their PIN (required when isTemporary: true)
router.post('/change', authenticateBusiness, adminPinLimiter, changePin);

// Business resets their PIN by verifying their account password → new temp PIN emailed
router.post('/reset', authenticateBusiness, adminPinResetLimiter, resetPin);

export default router;
