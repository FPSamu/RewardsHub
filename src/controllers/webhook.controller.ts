import { Request, Response } from 'express';
import Stripe from 'stripe';
import * as stripeService from '../services/stripe.service';
import * as subscriptionService from '../services/subscription.service';
import * as businessService from '../services/business.service';
import { PlanType } from '../models/subscription.model';
import { SubscriptionModel } from '../models/subscription.model';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-02-25.clover',
});

export const handleStripeWebhook = async (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event: Stripe.Event;

    try {
        if (!sig || !endpointSecret) {
            throw new Error('Missing Stripe signature or webhook secret');
        }
        
        // Verify the event came from Stripe
        // Note: req.body needs to be the raw buffer for signature verification
        // In Express, we usually need to configure the body parser to keep the raw body for this route
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err: any) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    try {
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
                break;
            case 'customer.subscription.updated':
                await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
                break;
            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
                break;
            case 'invoice.payment_succeeded':
                // Optional: Handle successful payment logic if needed beyond subscription update
                break;
            case 'invoice.payment_failed':
                // Optional: Handle failed payment logic (e.g., notify user)
                break;
            default:
                console.log(`Unhandled event type ${event.type}`);
        }

        res.json({ received: true });
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
};

const handleCheckoutSessionCompleted = async (session: Stripe.Checkout.Session) => {
    const businessId = session.metadata?.businessId;
    const planType = session.metadata?.planType as PlanType;

    if (!businessId || !planType) {
        console.error('Missing metadata in checkout session');
        return;
    }

    // If it's a subscription
    if (session.subscription) {
        const subscriptionId = session.subscription as string;
        // Retrieve subscription details to get period
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);

        // current_period_start/end moved to items.data[0] in newer Stripe API versions
        const item = subscription.items?.data?.[0] as any;
        const rawStart = (subscription as any).current_period_start ?? item?.current_period_start;
        const rawEnd   = (subscription as any).current_period_end   ?? item?.current_period_end;

        await subscriptionService.activateSubscription(
            businessId,
            planType,
            subscriptionId,
            rawStart ? new Date(rawStart * 1000) : undefined,
            rawEnd   ? new Date(rawEnd   * 1000) : undefined,
        );
    } 
    // If it's a one-time payment (Lifetime Access)
    else if (session.payment_status === 'paid' && planType === 'lifetime_access') {
        await subscriptionService.activateSubscription(
            businessId,
            'lifetime_access'
        );
    }
};

const handleSubscriptionUpdated = async (subscription: Stripe.Subscription) => {
    const status = subscription.status === 'active' ? 'active' :
                   subscription.status === 'past_due' ? 'past_due' :
                   subscription.status === 'canceled' ? 'canceled' : 'none';

    // current_period_start/end moved to items.data[0] in newer Stripe API versions
    const item = subscription.items?.data?.[0] as any;
    const rawStart = (subscription as any).current_period_start ?? item?.current_period_start;
    const rawEnd   = (subscription as any).current_period_end   ?? item?.current_period_end;

    await subscriptionService.updateSubscriptionStatus(
        subscription.id,
        status,
        rawStart ? new Date(rawStart * 1000) : undefined,
        rawEnd   ? new Date(rawEnd   * 1000) : undefined,
        subscription.cancel_at_period_end
    );
};

const handleSubscriptionDeleted = async (subscription: Stripe.Subscription) => {
    // Actualizar el estado de la suscripción en MongoDB
    const updated = await subscriptionService.updateSubscriptionStatus(
        subscription.id,
        'canceled',
        undefined,
        undefined,
        false
    );

    // Marcar el negocio como inactivo ahora que la suscripción expiró realmente
    if (updated?.businessId) {
        await businessService.updateBusiness(updated.businessId.toString(), { status: 'inactive' });
        console.log(`[webhook] Business ${updated.businessId} marked inactive after subscription deletion`);
    }
};
