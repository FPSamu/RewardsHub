import { SubscriptionModel, PlanType, MembershipStatus } from '../models/subscription.model';
import * as stripeService from './stripe.service';

/**
 * Create a subscription record for a new business
 */
export const createSubscription = async (
    businessId: string, 
    email: string, 
    name: string
) => {
    // Create customer in Stripe
    const stripeCustomerId = await stripeService.createCustomer(businessId, email, name);

    // Create subscription record in MongoDB
    const subscription = await SubscriptionModel.create({
        businessId,
        stripeCustomerId,
        planType: 'monthly', // Default plan
        membershipStatus: 'none'
    });

    return subscription;
};

/**
 * Get subscription by business ID
 */
export const getSubscriptionByBusinessId = async (businessId: string) => {
    return await SubscriptionModel.findOne({ businessId });
};

/**
 * Get subscription by Stripe customer ID
 */
export const getSubscriptionByStripeCustomerId = async (stripeCustomerId: string) => {
    return await SubscriptionModel.findOne({ stripeCustomerId });
};

/**
 * Get subscription by Stripe subscription ID
 */
export const getSubscriptionByStripeSubscriptionId = async (stripeSubscriptionId: string) => {
    return await SubscriptionModel.findOne({ stripeSubscriptionId });
};

/**
 * Update subscription status
 */
export const updateSubscriptionStatus = async (
    stripeSubscriptionId: string,
    status: MembershipStatus,
    currentPeriodStart?: Date,
    currentPeriodEnd?: Date,
    cancelAtPeriodEnd?: boolean
) => {
    const update: any = {
        membershipStatus: status,
    };

    if (currentPeriodStart) update.currentPeriodStart = currentPeriodStart;
    if (currentPeriodEnd) update.currentPeriodEnd = currentPeriodEnd;
    if (cancelAtPeriodEnd !== undefined) update.cancelAtPeriodEnd = cancelAtPeriodEnd;

    return await SubscriptionModel.findOneAndUpdate(
        { stripeSubscriptionId },
        update,
        { new: true }
    );
};

/**
 * Activate subscription (after successful payment)
 */
export const activateSubscription = async (
    businessId: string,
    planType: PlanType,
    stripeSubscriptionId?: string,
    currentPeriodStart?: Date,
    currentPeriodEnd?: Date
) => {
    const update: any = {
        planType,
        membershipStatus: planType === 'lifetime_access' ? 'lifetime' : 'active',
    };

    if (stripeSubscriptionId) {
        update.stripeSubscriptionId = stripeSubscriptionId;
    }

    if (currentPeriodStart) {
        update.currentPeriodStart = currentPeriodStart;
    }

    if (currentPeriodEnd) {
        update.currentPeriodEnd = currentPeriodEnd;
    }

    return await SubscriptionModel.findOneAndUpdate(
        { businessId },
        update,
        { new: true }
    );
};

/**
 * Check if business has an active subscription
 */
export const hasActiveSubscription = async (businessId: string): Promise<boolean> => {
    const subscription = await SubscriptionModel.findOne({ businessId });
    
    if (!subscription) return false;

    // Lifetime access is always active
    if (subscription.membershipStatus === 'lifetime') return true;
    
    // Check active status with valid period
    if (subscription.membershipStatus === 'active') {
        if (subscription.currentPeriodEnd && subscription.currentPeriodEnd > new Date()) {
            return true;
        }
    }

    return false;
};

/**
 * Cancel subscription at period end
 */
export const cancelSubscriptionAtPeriodEnd = async (businessId: string) => {
    const subscription = await SubscriptionModel.findOne({ businessId });
    
    if (!subscription || !subscription.stripeSubscriptionId) {
        throw new Error('No active subscription found');
    }

    // Update in Stripe
    await stripeService.cancelSubscription(subscription.stripeSubscriptionId);

    // Update in database
    return await SubscriptionModel.findOneAndUpdate(
        { businessId },
        { cancelAtPeriodEnd: true },
        { new: true }
    );
};

/**
 * Update subscription plan
 */
export const updateSubscriptionPlan = async (
    businessId: string,
    newPlanType: 'monthly' | 'yearly'
) => {
    const subscription = await SubscriptionModel.findOne({ businessId });
    
    if (!subscription || !subscription.stripeSubscriptionId) {
        throw new Error('No active subscription found');
    }

    // Update in Stripe
    await stripeService.updateSubscriptionPlan(subscription.stripeSubscriptionId, newPlanType);

    // Update in database
    return await SubscriptionModel.findOneAndUpdate(
        { businessId },
        { planType: newPlanType },
        { new: true }
    );
};
