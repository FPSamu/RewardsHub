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
        // Allow 'plan' from frontend to map to 'planType'
        let { planType, plan } = req.body as { planType?: PlanType, plan?: PlanType };
        
        if (!planType && plan) {
            planType = plan;
        }

        if (!planType || !['monthly', 'yearly', 'lifetime_access'].includes(planType)) {
            return res.status(400).json({ message: 'Invalid plan type' });
        }

        let subscription = await subscriptionService.getSubscriptionByBusinessId(businessId);

        // Auto-create subscription record for legacy users if missing
        if (!subscription) {
            console.log(`Creating missing subscription record for business: ${businessId}`);
            try {
                subscription = await subscriptionService.createSubscription(
                    businessId,
                    req.business!.email,
                    req.business!.name
                );
            } catch (err) {
                console.error('Failed to auto-create subscription:', err);
                return res.status(500).json({ message: 'Failed to initialize subscription account' });
            }
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

/**
 * Get subscription plans
 * GET /api/subscriptions/plans
 */
export const getPlans = async (req: Request, res: Response) => {
    try {
        // Return configured plans
        res.json({
            monthly: {
                id: process.env.STRIPE_MONTHLY_PRICE_ID,
                name: 'Monthly Plan',
                price: 29.99, // Example price, ideally fetch from Stripe or config
                currency: 'usd'
            },
            yearly: {
                id: process.env.STRIPE_YEARLY_PRICE_ID,
                name: 'Yearly Plan',
                price: 299.99,
                currency: 'usd'
            },
            lifetime: {
                id: process.env.STRIPE_LIFETIME_PRICE_ID,
                name: 'Lifetime Access',
                price: 499.99,
                currency: 'usd'
            }
        });
    } catch (error) {
        console.error('Get plans error:', error);
        res.status(500).json({ message: 'Failed to get plans' });
    }
};

/**
 * Verify subscription
 * GET /api/subscriptions/verify
 */
export const verifySubscription = async (req: Request, res: Response) => {
    try {
        const businessId = req.business!.id;
        const hasActive = await subscriptionService.hasActiveSubscription(businessId);
        const subscription = await subscriptionService.getSubscriptionByBusinessId(businessId);

        res.json({ 
            valid: hasActive,
            subscription
        });
    } catch (error) {
        console.error('Verify subscription error:', error);
        res.status(500).json({ message: 'Failed to verify subscription' });
    }
};

/**
 * Activate lifetime subscription with code
 * POST /api/subscriptions/activate-lifetime
 */
export const activateLifetime = async (req: Request, res: Response) => {
    try {
        const businessId = req.business!.id;
        const { code } = req.body;

        // Simple hardcoded check for now, or implement a Code model
        const validCode = process.env.LIFETIME_ACCESS_CODE || 'LIFETIME2025';

        if (code !== validCode) {
            return res.status(400).json({ message: 'Invalid activation code' });
        }

        const subscription = await subscriptionService.activateSubscription(
            businessId,
            'lifetime_access'
        );

        res.json({ 
            message: 'Lifetime access activated successfully',
            subscription
        });
    } catch (error) {
        console.error('Activate lifetime error:', error);
        res.status(500).json({ message: 'Failed to activate lifetime subscription' });
    }
};
