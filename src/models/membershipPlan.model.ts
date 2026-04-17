import mongoose, { Schema, Document } from 'mongoose';

export interface IMembershipPlan extends Document {
    businessId: mongoose.Types.ObjectId;
    name: string;
    description: string;
    benefit: string;        // short label shown to client: "1 café gratis por día"
    durationDays: number;
    price: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const MembershipPlanSchema = new Schema<IMembershipPlan>(
    {
        businessId:  { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
        name:        { type: String, required: true, trim: true },
        description: { type: String, required: true, trim: true },
        benefit:     { type: String, required: true, trim: true },
        durationDays:{ type: Number, required: true, min: 1 },
        price:       { type: Number, required: true, min: 0 },
        isActive:    { type: Boolean, default: true },
    },
    { timestamps: true }
);

export const MembershipPlanModel = mongoose.model<IMembershipPlan>('MembershipPlan', MembershipPlanSchema);
