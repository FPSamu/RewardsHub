import mongoose, { Schema, Document } from 'mongoose';

export interface IClientMembership extends Document {
    userId:     mongoose.Types.ObjectId;
    businessId: mongoose.Types.ObjectId;
    planId:     mongoose.Types.ObjectId;
    /** Snapshot so historical data survives if plan is deleted/edited */
    planSnapshot: {
        name: string;
        benefit: string;
        durationDays: number;
        price: number;
    };
    startDate:        Date;
    endDate:          Date;
    status:           'active' | 'expired' | 'cancelled';
    lastRedeemedDate:         Date | null;
    lastRedeemedBusinessName: string | null;
    activatedAt:              Date;
    activatedByBusinessId: mongoose.Types.ObjectId;
}

const ClientMembershipSchema = new Schema<IClientMembership>(
    {
        userId:     { type: Schema.Types.ObjectId, ref: 'User',     required: true, index: true },
        businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
        planId:     { type: Schema.Types.ObjectId, ref: 'MembershipPlan', required: true },
        planSnapshot: {
            name:        { type: String, required: true },
            benefit:     { type: String, required: true },
            durationDays:{ type: Number, required: true },
            price:       { type: Number, required: true },
        },
        startDate:        { type: Date, required: true },
        endDate:          { type: Date, required: true, index: true },
        status:           { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active' },
        lastRedeemedDate:         { type: Date, default: null },
        lastRedeemedBusinessName: { type: String, default: null },
        activatedAt:              { type: Date, default: Date.now },
        activatedByBusinessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    },
    { timestamps: false }
);

// One active membership per client per business
ClientMembershipSchema.index({ userId: 1, businessId: 1, status: 1 });

export const ClientMembershipModel = mongoose.model<IClientMembership>('ClientMembership', ClientMembershipSchema);
