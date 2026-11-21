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
    /** event.created del último evento de Stripe aplicado; ignora eventos más viejos que lleguen tarde */
    lastStripeEventAt?: Date;
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
        cancelAtPeriodEnd: { type: Boolean, default: false },
        lastStripeEventAt: { type: Date }
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

// businessId y stripeCustomerId ya tienen índice por `unique: true`. Declararlos
// otra vez sin unique hacía fallar la creación de índices de Mongoose (mismo
// nombre, otras opciones), y ese error cortaba la creación de los siguientes.
// stripeSubscriptionId (lo busca cada evento del webhook) ya tiene índice:
// `sparse: true` en la definición del campo lo crea.

const rawCollection = process.env.SUBSCRIPTIONS_COLLECTION;
const collectionName = rawCollection ? rawCollection.replace(/^['"]|['"]$/g, '') : undefined;

export const SubscriptionModel = model<ISubscription>(
    'Subscription', 
    subscriptionSchema, 
    collectionName
);
