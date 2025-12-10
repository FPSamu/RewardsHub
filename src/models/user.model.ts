import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
    /** underlying MongoDB _id field */
    _id: any;
    username: string;
    email: string;
    passHash: string; // hashed password (never returned in JSON)
    profilePicture?: string; // S3 URL of profile picture
    createdAt: Date;
    /** list of active refresh tokens (JWT strings) for this user */
    refreshTokens?: string[];
    isVerified: boolean;
    verificationToken?: string;
    resetPasswordToken?: string;
    resetPasswordExpires?: Date;
}

const userSchema = new Schema<IUser>(
    {
        username: { type: String, required: true },
        email: { type: String, required: true, unique: true, index: true },
        passHash: { type: String, required: true },
        profilePicture: { type: String },
        createdAt: { type: Date, default: Date.now },
        refreshTokens: { type: [String], default: [] },
        isVerified: { type: Boolean, default: false },
        verificationToken: { type: String },
        resetPasswordToken: { type: String },
        resetPasswordExpires: { type: Date },
    },
    { timestamps: false }
);

/**
 * Virtual `id` for convenience that returns the string form of _id.
 */
userSchema.virtual('id').get(function (this: IUser) {
    return this._id.toString();
});

/**
 * toJSON transform hides internal fields and the password hash when
 * documents are serialized to JSON (e.g. when returned from controllers).
 */
userSchema.set('toJSON', {
    virtuals: true,
    transform: (_doc: any, ret: any) => {
        delete ret._id;
        delete ret.__v;
        delete ret.passHash;
        // do not expose refresh tokens in serialized output
        if (ret.refreshTokens) delete ret.refreshTokens;
    },
});

/**
 * Determine the collection name from environment. Support both
 * DB_COLLECTION (existing) and USER_COLLECTION as possible env keys.
 * Trim surrounding quotes if present.
 */
const rawCollection = process.env.USER_COLLECTION;
const collectionName = rawCollection ? rawCollection.replace(/^['"]|['"]$/g, '') : undefined;

export const UserModel = model<IUser>('User', userSchema, collectionName);
