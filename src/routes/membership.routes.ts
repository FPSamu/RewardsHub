import { Router } from 'express';
import * as ctrl from '../controllers/membership.controller';
import { authenticateBusiness } from '../middleware/business.middleware';
import { requireAdminPin } from '../middleware/adminPin.middleware';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// ── Client (user JWT) ──────────────────────────────────────────────────────
router.get('/my', authenticate, ctrl.getMyMemberships);

// ── Public ─────────────────────────────────────────────────────────────────
router.get('/plans/business/:businessId', ctrl.getPublicPlans);

// ── Plan management (business + adminPin) ──────────────────────────────────
router.get('/plans',     authenticateBusiness, ctrl.getPlans);
router.post('/plans',    authenticateBusiness, requireAdminPin, ctrl.createPlan);
router.put('/plans/:id', authenticateBusiness, requireAdminPin, ctrl.updatePlan);
router.delete('/plans/:id', authenticateBusiness, requireAdminPin, ctrl.deletePlan);

// ── Cashier actions (business JWT only) ────────────────────────────────────
router.get('/client/:userId',  authenticateBusiness, ctrl.getClientMembership);
router.post('/activate',       authenticateBusiness, ctrl.activateMembership);
router.post('/redeem',         authenticateBusiness, ctrl.redeemDailyBenefit);

export default router;
