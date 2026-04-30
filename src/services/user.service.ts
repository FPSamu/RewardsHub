import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { UserModel, IUser } from '../models/user.model';

const toPublic = (doc: IUser) => ({
    id: doc._id.toString(),
    username: doc.username,
    email: doc.email,
    passHash: doc.passHash,
    profilePicture: doc.profilePicture,
    isVerified: doc.isVerified,
    createdAt: doc.createdAt.toISOString(),
});

export const findUserByGoogleUid = async (googleUid: string) => {
    const doc = await UserModel.findOne({ googleUid }).exec();
    return doc ? toPublic(doc as IUser) : undefined;
};

export const createUser = async (username: string, email: string, password?: string, googleUid?: string) => {
    const passHash = password
        ? await bcrypt.hash(password, 10)
        : await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);

    console.log('🔵 [CREATE USER] Creando usuario:', { email: email.toLowerCase(), timestamp: new Date().toISOString() });

    const doc = await UserModel.create({
        username,
        email: email.toLowerCase(),
        passHash,
        isVerified: !!googleUid,
        ...(googleUid && { googleUid }),
    });

    console.log('🟢 [CREATE USER] Usuario creado:', {
        email: doc.email,
        id: doc._id,
        isVerified: doc.isVerified,
        timestamp: new Date().toISOString()
    });

    return toPublic(doc as IUser);
};

export const findUserByEmail = async (email: string) => {
    const doc = await UserModel.findOne({ email: email.toLowerCase() }).exec();
    return doc ? toPublic(doc as IUser) : undefined;
};

export const findUserById = async (id: string) => {
    const doc = await UserModel.findById(id).exec();
    return doc ? toPublic(doc as IUser) : undefined;
};

export const updateUser = async (
    userId: string,
    updates: { username?: string; email?: string; password?: string }
) => {
    const updateData: any = {};
    if (updates.username) updateData.username = updates.username;
    if (updates.email) updateData.email = updates.email.toLowerCase();
    if (updates.password) updateData.passHash = await bcrypt.hash(updates.password, 10);

    const doc = await UserModel.findByIdAndUpdate(userId, updateData, { new: true }).exec();
    if (!doc) throw new Error('user not found');
    return toPublic(doc as IUser);
};

export const updateUserProfilePicture = async (userId: string, profilePictureUrl: string) => {
    const doc = await UserModel.findByIdAndUpdate(
        userId,
        { profilePicture: profilePictureUrl },
        { new: true }
    ).exec();
    if (!doc) throw new Error('user not found');
    return toPublic(doc as IUser);
};

export const verifyUserEmail = async (token: string) => {
    const doc = await UserModel.findOne({ verificationToken: token }).exec();
    if (!doc) return undefined;

    doc.isVerified = true;
    doc.verificationToken = undefined;
    await doc.save();
    return toPublic(doc as IUser);
};
