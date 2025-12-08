import { Request, Response } from 'express';
import * as subscriptionService from '../services/subscription.service';
import * as stripeService from '../services/stripe.service';
import { PlanType } from '../models/subscription.model';

/**
 * Get current business subscription
 * GET /api/subscriptions/me
 */
export const getMySubscription = async (req: Request, res: Response) => {
    try {
        const businessId = req.business!.id;
        const subscription = await subscriptionService.getSubscriptionByBusinessId(businessId);

        if (!subscription) {
            return res.status(404).json({ message: 'No subscription found' });
        }

        res.json(subscription);
    } catch (error) {
        console.error('Get subscription error:', error);
        res.status(500).json({ message: 'Failed to get subscription' });
    }
};

/**
 * Create a checkout session for subscription
 * POST /api/subscriptions/checkout
 * Body: { planType: 'monthly' | 'yearly' | 'lifetime_access' }
 */
export const createCheckoutSession = async (req: Request, res: Response) => {
    try {
        const businessId = req.business!.id;
        const { planType } = req.body as { planType: PlanType };

        if (!['monthly', 'yearly', 'lifetime_access'].includes(planType)) {
            return res.status(400).json({ message: 'Invalid plan type' });
        }

        const subscription = await subscriptionService.getSubscriptionByBusinessId(businessId);

        if (!subscription) {
            return res.status(404).json({ message: 'No subscription record found' });
        }

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const successUrl = `${frontendUrl}/business/subscription?success=true&session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${frontendUrl}/business/subscription?canceled=true`;

        const session = await stripeService.createCheckoutSession(
            subscription.stripeCustomerId,
            businessId,
            planType,
            successUrl,
            cancelUrl
        );

        res.json({ 
            sessionId: session.id, 
            url: session.url 
        });
    } catch (error: any) {
        console.error('Create checkout session error:', error);
        res.status(500).json({ message: error.message || 'Failed to create checkout session' });
    }
};

/**
 * Cancel subscription at period end
 * POST /api/subscriptions/cancel
 */
export const cancelSubscription = async (req: Request, res: Response) => {
    try {
        const businessId = req.business!.id;
        
        const subscription = await subscriptionService.cancelSubscriptionAtPeriodEnd(businessId);

        res.json({ 
            message: 'Subscription will be canceled at period end',
            subscription
        });
    } catch (error: any) {
        console.error('Cancel subscription error:', error);
        res.status(500).json({ message: error.message || 'Failed to cancel subscription' });
    }
};

/**
 * Update subscription plan
 * PUT /api/subscriptions/plan
 * Body: { planType: 'monthly' | 'yearly' }
 */
export const updatePlan = async (req: Request, res: Response) => {
    try {
        const businessId = req.business!.id;
        const { planType } = req.body as { planType: 'monthly' | 'yearly' };

        if (!['monthly', 'yearly'].includes(planType)) {
            return res.status(400).json({ message: 'Invalid plan type. Must be monthly or yearly' });
        }

        const subscription = await subscriptionService.updateSubscriptionPlan(businessId, planType);

        res.json({
            message: 'Plan updated successfully',
            subscription
        });
    } catch (error: any) {
        console.error('Update plan error:', error);
        res.status(500).json({ message: error.message || 'Failed to update plan' });
    }
};

/**
 * Create billing portal session
 * POST /api/subscriptions/billing-portal
 */
export const createBillingPortalSession = async (req: Request, res: Response) => {
    try {
        const businessId = req.business!.id;
        const subscription = await subscriptionService.getSubscriptionByBusinessId(businessId);

        if (!subscription) {
            return res.status(404).json({ message: 'No subscription found' });
        }

        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const returnUrl = `${frontendUrl}/business/subscription`;

        const session = await stripeService.createBillingPortalSession(
            subscription.stripeCustomerId,
            returnUrl
        );

        res.json({ url: session.url });
    } catch (error: any) {
        console.error('Create billing portal error:', error);
        res.status(500).json({ message: error.message || 'Failed to create billing portal session' });
    }
};

/**
 * Check subscription status
 * GET /api/subscriptions/status
 */
export const checkSubscriptionStatus = async (req: Request, res: Response) => {
    try {
        const businessId = req.business!.id;
        const subscription = await subscriptionService.getSubscriptionByBusinessId(businessId);
        const hasActive = await subscriptionService.hasActiveSubscription(businessId);

        res.json({ 
            status: hasActive ? 'active' : 'inactive',
            subscription
        });
    } catch (error) {
        console.error('Check subscription status error:', error);
        res.status(500).json({ message: 'Failed to check subscription status' });
    }
};
