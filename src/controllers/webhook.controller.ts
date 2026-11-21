import { Request, Response } from 'express';
import Stripe from 'stripe';
import * as subscriptionService from '../services/subscription.service';
import { getStripe } from '../services/stripe.service';
import * as businessService from '../services/business.service';
import { PlanType } from '../models/subscription.model';
import { StripeEventModel } from '../models/stripeEvent.model';


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
        // getStripe() lanza si falta STRIPE_SECRET_KEY → 400 como cualquier webhook inválido
        event = getStripe().webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err: any) {
        console.error(`Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Deduplicación por event.id (Stripe entrega "al menos una vez")
    let claim: Awaited<ReturnType<typeof claimStripeEvent>>;
    try {
        claim = await claimStripeEvent(event);
    } catch (error) {
        console.error('Error processing webhook:', error);
        return res.status(500).json({ error: 'Webhook processing failed' });
    }
    if (claim === 'processed') return res.json({ received: true, duplicate: true });
    if (claim === 'busy') return res.status(409).json({ error: 'Event is being processed' });

    // Handle the event
    try {
        const eventCreatedAt = new Date(event.created * 1000);
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
                break;
            case 'customer.subscription.updated':
                await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, eventCreatedAt);
                break;
            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, eventCreatedAt);
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

        await StripeEventModel.updateOne(
            { _id: event.id },
            { $set: { status: 'processed', processedAt: new Date() } }
        );
        res.json({ received: true });
    } catch (error) {
        console.error('Error processing webhook:', error);
        // Liberar el event.id para que el reintento de Stripe lo procese de nuevo
        await StripeEventModel.deleteOne({ _id: event.id }).catch(() => undefined);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
};

/** Un evento "processing" más viejo que esto se considera abandonado (proceso caído) y se retoma. */
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * - 'claimed':   este proceso debe procesarlo.
 * - 'processed': ya se procesó; es un duplicado.
 * - 'busy':      otro proceso lo está procesando ahora → 409, Stripe reintenta más tarde.
 */
const claimStripeEvent = async (event: Stripe.Event): Promise<'claimed' | 'processed' | 'busy'> => {
    const now = new Date();
    try {
        await StripeEventModel.create({ _id: event.id, type: event.type, status: 'processing', receivedAt: now });
        return 'claimed';
    } catch (err: any) {
        if (err?.code !== 11000) throw err;
    }

    const existing = await StripeEventModel.findById(event.id).lean();
    if (existing?.status === 'processed') return 'processed';

    const takenOver = await StripeEventModel.findOneAndUpdate(
        { _id: event.id, status: 'processing', receivedAt: { $lt: new Date(now.getTime() - PROCESSING_TIMEOUT_MS) } },
        { $set: { receivedAt: now } },
        { new: true }
    );
    if (takenOver) return 'claimed';

    // Se borró entre el insert y la lectura (falló el otro proceso): volver a intentar el insert
    if (!existing) {
        try {
            await StripeEventModel.create({ _id: event.id, type: event.type, status: 'processing', receivedAt: now });
            return 'claimed';
        } catch (err: any) {
            if (err?.code !== 11000) throw err;
        }
    }
    return 'busy';
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
        const subscription = await getStripe().subscriptions.retrieve(subscriptionId);

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

const handleSubscriptionUpdated = async (subscription: Stripe.Subscription, eventCreatedAt: Date) => {
    // 'trialing' counts as active — the business already has full access during
    // its free month. Our own MembershipStatus type has no separate 'trialing'
    // value, so it maps to 'active' like a subscription that's already being paid.
    const status = subscription.status === 'active' || subscription.status === 'trialing' ? 'active' :
                   subscription.status === 'past_due' ? 'past_due' :
                   subscription.status === 'canceled' ? 'canceled' : 'none';

    // current_period_start/end moved to items.data[0] in newer Stripe API versions
    const item = subscription.items?.data?.[0] as any;
    const rawStart = (subscription as any).current_period_start ?? item?.current_period_start;
    const rawEnd   = (subscription as any).current_period_end   ?? item?.current_period_end;

    // Un "updated" más viejo que el último evento aplicado (llegó tarde) se ignora
    const updated = await subscriptionService.updateSubscriptionStatus(
        subscription.id,
        status,
        rawStart ? new Date(rawStart * 1000) : undefined,
        rawEnd   ? new Date(rawEnd   * 1000) : undefined,
        subscription.cancel_at_period_end,
        eventCreatedAt
    );
    if (!updated) {
        console.log(`[webhook] subscription.updated ${subscription.id} ignorado: no existe o es más viejo que el último evento aplicado`);
    }
};

const handleSubscriptionDeleted = async (subscription: Stripe.Subscription, eventCreatedAt: Date) => {
    // Actualizar el estado de la suscripción en MongoDB. Siempre se aplica, y
    // registra la fecha para que un "updated" viejo que llegue después no la reviva.
    const updated = await subscriptionService.updateSubscriptionStatus(
        subscription.id,
        'canceled',
        undefined,
        undefined,
        false,
        eventCreatedAt,
        { ignoreOlder: false }
    );

    // Marcar el negocio como inactivo ahora que la suscripción expiró realmente
    if (updated?.businessId) {
        await businessService.updateBusiness(updated.businessId.toString(), { status: 'inactive' });
        console.log(`[webhook] Business ${updated.businessId} marked inactive after subscription deletion`);
    }
};
