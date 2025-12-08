import { Router } from 'express';
import { authenticateBusiness } from '../middleware/business.middleware';
import * as subscriptionCtrl from '../controllers/subscription.controller';

const router = Router();

// All subscription routes require business authentication
router.use(authenticateBusiness);

// Get current subscription
router.get('/me', subscriptionCtrl.getMySubscription);

// Check subscription status
router.get('/status', subscriptionCtrl.checkSubscriptionStatus);

// Create checkout session
router.post('/checkout', subscriptionCtrl.createCheckoutSession);

// Create billing portal session
router.post('/billing-portal', subscriptionCtrl.createBillingPortalSession);

// Update subscription plan
router.put('/plan', subscriptionCtrl.updatePlan);

// Cancel subscription
router.post('/cancel', subscriptionCtrl.cancelSubscription);

export default router;
