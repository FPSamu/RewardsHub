/**
 * Pass routes
 *
 * GET /passes/apple  → download a signed .pkpass for Apple Wallet
 * GET /passes/google → get a Google Wallet save URL
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import * as passCtrl from '../controllers/pass.controller';

const router = Router();

router.get('/apple', authenticate, passCtrl.applePass);
router.get('/google', authenticate, passCtrl.googlePass);

export default router;
