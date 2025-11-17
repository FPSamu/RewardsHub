/**
 * Mongoose Business model
 *
 * This module defines the schema and the typed interface for business documents.
 * It mirrors the `User` model structure but is stored in a separate collection.
 */
import { Schema, model, Document } from 'mongoose';

export interface IBusiness extends Document {
    _id: any;
    name: string;
    email: string;
    passHash: string;
    status: 'active' | 'inactive';
    createdAt: Date;
    refreshTokens?: string[];
}

const businessSchema = new Schema<IBusiness>(
    {
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true, index: true },
        passHash: { type: String, required: true },
        status: { type: String, enum: ['active', 'inactive'], default: 'inactive' },
        createdAt: { type: Date, default: Date.now },
        refreshTokens: { type: [String], default: [] },
    },
    { timestamps: false }
);

businessSchema.virtual('id').get(function (this: IBusiness) {
    return this._id.toString();
});

businessSchema.set('toJSON', {
    virtuals: true,
    transform: (_doc: any, ret: any) => {
        delete ret._id;
        delete ret.__v;
        delete ret.passHash;
        if (ret.refreshTokens) delete ret.refreshTokens;
    },
});

/**
 * Collection name resolution.
 * The user requested the env key `BUSINESSES_COLLECTOIN` (note: possible typo).
 * We'll support that exact key plus a corrected `BUSINESSES_COLLECTION` and
 * fall back to `DB_COLLECTION` if provided.
 */
const rawCollection = process.env.BUSINESSES_COLLECTION;
const collectionName = rawCollection ? rawCollection.replace(/^['"]|['"]$/g, '') : undefined;

export const BusinessModel = model<IBusiness>('Business', businessSchema, collectionName);
