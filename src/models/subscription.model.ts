import { Schema, model, Document } from 'mongoose';

export type PlanType = 'monthly' | 'yearly' | 'lifetime_access';
export type MembershipStatus = 'active' | 'past_due' | 'canceled' | 'lifetime' | 'none';

export interface ISubscription extends Document {
    _id: any;
    businessId: Schema.Types.ObjectId;
    stripeCustomerId: string;
    stripeSubscriptionId?: string;
    planType: PlanType;
    membershipStatus: MembershipStatus;
    currentPeriodStart?: Date;
    currentPeriodEnd?: Date;
    cancelAtPeriodEnd: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const subscriptionSchema = new Schema<ISubscription>(
    {
        businessId: { 
            type: Schema.Types.ObjectId, 
            ref: 'Business', 
            required: true, 
            unique: true 
        },
        stripeCustomerId: { 
            type: String, 
            required: true, 
            unique: true 
        },
        stripeSubscriptionId: { 
            type: String, 
            sparse: true // For lifetime_access, there's no subscription ID
        },
        planType: { 
            type: String, 
            enum: ['monthly', 'yearly', 'lifetime_access'],
            required: true 
        },
        membershipStatus: { 
            type: String, 
            enum: ['active', 'past_due', 'canceled', 'lifetime', 'none'],
            default: 'none'
        },
        currentPeriodStart: { type: Date },
        currentPeriodEnd: { type: Date },
        cancelAtPeriodEnd: { type: Boolean, default: false }
    },
    { timestamps: true }
);

subscriptionSchema.virtual('id').get(function (this: ISubscription) {
    return this._id.toString();
});

subscriptionSchema.set('toJSON', {
    virtuals: true,
    transform: (_doc: any, ret: any) => {
        delete ret._id;
        delete ret.__v;
    },
});

subscriptionSchema.index({ businessId: 1 });
subscriptionSchema.index({ stripeCustomerId: 1 });

const rawCollection = process.env.SUBSCRIPTIONS_COLLECTION;
const collectionName = rawCollection ? rawCollection.replace(/^['"]|['"]$/g, '') : undefined;

export const SubscriptionModel = model<ISubscription>(
    'Subscription', 
    subscriptionSchema, 
    collectionName
);
