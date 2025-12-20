import Stripe from 'stripe';
import { PlanType } from '../models/subscription.model';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-12-15.clover'
});

// Plan price IDs from Stripe Dashboard
const PLAN_PRICES = {
    monthly: process.env.STRIPE_MONTHLY_PRICE_ID || '',
    yearly: process.env.STRIPE_YEARLY_PRICE_ID || '',
    lifetime_access: process.env.STRIPE_LIFETIME_PRICE_ID || ''
};

/**
 * Create a Stripe customer
 */
export const createCustomer = async (businessId: string, email: string, name: string) => {
    const customer = await stripe.customers.create({
        email,
        name,
        metadata: { businessId }
    });

    return customer.id;
};

/**
 * Create a checkout session for subscription or one-time payment
 */
export const createCheckoutSession = async (
    stripeCustomerId: string,
    businessId: string,
    planType: PlanType,
    successUrl: string,
    cancelUrl: string
) => {
    const priceId = PLAN_PRICES[planType];
    
    if (!priceId) {
        throw new Error(`Price ID not configured for plan: ${planType}`);
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        line_items: [
            {
                price: priceId,
                quantity: 1,
            },
        ],
        mode: planType === 'lifetime_access' ? 'payment' : 'subscription',
        allow_promotion_codes: true,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
            businessId,
            planType
        }
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    return session;
};

/**
 * Cancel a subscription at period end
 */
export const cancelSubscription = async (subscriptionId: string) => {
    return await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true
    });
};

/**
 * Immediately cancel a subscription
 */
export const cancelSubscriptionImmediately = async (subscriptionId: string) => {
    return await stripe.subscriptions.cancel(subscriptionId);
};

/**
 * Update subscription to a different plan
 */
export const updateSubscriptionPlan = async (
    subscriptionId: string, 
    newPlanType: 'monthly' | 'yearly'
) => {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    
    return await stripe.subscriptions.update(subscriptionId, {
        items: [{
            id: subscription.items.data[0].id,
            price: PLAN_PRICES[newPlanType],
        }],
        proration_behavior: 'create_prorations'
    });
};

/**
 * Retrieve subscription details from Stripe
 */
export const getSubscription = async (subscriptionId: string) => {
    return await stripe.subscriptions.retrieve(subscriptionId);
};

/**
 * Create a billing portal session
 */
export const createBillingPortalSession = async (
    stripeCustomerId: string,
    returnUrl: string
) => {
    const session = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: returnUrl,
    });

    return session;
};

export { stripe };
