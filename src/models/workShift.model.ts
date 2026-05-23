/**
 * Mongoose WorkShift model
 * 
 * This module defines the schema for work shifts (turnos de trabajo).
 * Each business can configure multiple shifts to organize their operations
 * and generate reports by shift.
 */
import { Schema, model, Document, Types } from 'mongoose';

/**
 * Work shift document interface
 */
export interface IWorkShift extends Document {
    _id: any;
    businessId: Types.ObjectId;        // Reference to the business
    branchId: Types.ObjectId;           // Required: reference to the specific branch (location) this shift belongs to.
    name: string;                       // Shift name (e.g., "Turno Matutino")
    startTime: string;                  // Start time in "HH:mm" format (e.g., "08:00")
    endTime: string;                    // End time in "HH:mm" format (e.g., "16:00")
    description?: string;               // Optional description
    isActive: boolean;                  // Whether the shift is active
    days: number[];                     // Days of the week this shift applies to (0=Sun, 1=Mon, ..., 6=Sat). Empty = all days.
    createdAt: Date;
    updatedAt: Date;
}

const workShiftSchema = new Schema<IWorkShift>(
    {
        businessId: {
            type: Schema.Types.ObjectId,
            required: true,
            ref: 'Business',
            index: true
        },
        branchId: {
            type: Schema.Types.ObjectId,
            required: true,
            ref: 'Business',
            index: true,
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        startTime: {
            type: String,
            required: true,
            validate: {
                validator: function (v: string) {
                    // Validate HH:mm format (00:00 to 23:59)
                    return /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
                },
                message: 'startTime must be in HH:mm format (e.g., "08:00")'
            }
        },
        endTime: {
            type: String,
            required: true,
            validate: {
                validator: function (v: string) {
                    // Validate HH:mm format (00:00 to 23:59)
                    return /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
                },
                message: 'endTime must be in HH:mm format (e.g., "16:00")'
            }
        },
        description: {
            type: String,
            trim: true
        },
        isActive: {
            type: Boolean,
            default: true
        },
        days: {
            type: [Number],
            default: [],
            validate: {
                validator: function (v: number[]) {
                    return v.every(d => Number.isInteger(d) && d >= 0 && d <= 6);
                },
                message: 'days must contain values between 0 (Sunday) and 6 (Saturday)'
            }
        }
    },
    { timestamps: true }
);

/**
 * Virtual `id` for convenience
 */
workShiftSchema.virtual('id').get(function (this: IWorkShift) {
    return this._id.toString();
});

/**
 * Index for efficient queries
 */
workShiftSchema.index({ businessId: 1, isActive: 1 });
workShiftSchema.index({ businessId: 1, startTime: 1 });
workShiftSchema.index({ businessId: 1, branchId: 1, isActive: 1 });

/**
 * toJSON transform
 */
workShiftSchema.set('toJSON', {
    virtuals: true,
    transform: (_doc: any, ret: any) => {
        delete ret._id;
        delete ret.__v;
    },
});

/**
 * Collection name from environment variable
 */
const rawCollection = process.env.WORK_SHIFTS_COLLECTION;
const collectionName = rawCollection ? rawCollection.replace(/^['"]+|['"]+$/g, '') : undefined;

export const WorkShiftModel = model<IWorkShift>('WorkShift', workShiftSchema, collectionName);
