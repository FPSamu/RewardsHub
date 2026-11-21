import Stripe from 'stripe';
import { PlanType } from '../models/subscription.model';

// El cliente se crea la primera vez que se usa: sin STRIPE_SECRET_KEY la app
// arranca igual (p. ej. en el lab) y solo fallan, con un error claro, las
// operaciones de pago. Con la llave puesta se comporta como siempre.
let stripeClient: Stripe | null = null;

export const isStripeConfigured = (): boolean => Boolean(process.env.STRIPE_SECRET_KEY);

export const getStripe = (): Stripe => {
    if (stripeClient) return stripeClient;
    if (!isStripeConfigured()) {
        throw new Error('Stripe no está configurado (falta STRIPE_SECRET_KEY): pagos y suscripciones deshabilitados');
    }
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!, {
        apiVersion: '2026-02-25.clover'
    });
    return stripeClient;
};

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
    const customer = await getStripe().customers.create({
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

    const isSubscription = planType !== 'lifetime_access';

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        line_items: [
            {
                price: priceId,
                quantity: 1,
            },
        ],
        mode: isSubscription ? 'subscription' : 'payment',
        allow_promotion_codes: true,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
            businessId,
            planType
        },
        // First month free — card is required at checkout but never charged
        // until the trial ends; Stripe handles the auto-charge on its own.
        ...(isSubscription && {
            subscription_data: {
                trial_period_days: 30,
            },
        }),
    };

    const session = await getStripe().checkout.sessions.create(sessionParams);
    return session;
};

/**
 * Cancel a subscription at period end
 */
export const cancelSubscription = async (subscriptionId: string) => {
    return await getStripe().subscriptions.update(subscriptionId, {
        cancel_at_period_end: true
    });
};

/**
 * Immediately cancel a subscription
 */
export const cancelSubscriptionImmediately = async (subscriptionId: string) => {
    return await getStripe().subscriptions.cancel(subscriptionId);
};

/**
 * Update subscription to a different plan
 */
export const updateSubscriptionPlan = async (
    subscriptionId: string, 
    newPlanType: 'monthly' | 'yearly'
) => {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
    
    return await getStripe().subscriptions.update(subscriptionId, {
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
    return await getStripe().subscriptions.retrieve(subscriptionId);
};

/**
 * Create a billing portal session
 */
export const createBillingPortalSession = async (
    stripeCustomerId: string,
    returnUrl: string
) => {
    const session = await getStripe().billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: returnUrl,
    });

    return session;
};

