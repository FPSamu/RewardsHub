import bcrypt from 'bcryptjs';
import { BusinessModel, IBusiness } from '../models/business.model';

const toPublic = (doc: IBusiness) => ({
    id: doc._id.toString(),
    name: doc.name,
    email: doc.email,
    passHash: doc.passHash,
    createdAt: doc.createdAt.toISOString(),
});

export const createBusiness = async (name: string, email: string, password: string) => {
    const passHash = await bcrypt.hash(password, 10);
    const doc = await BusinessModel.create({ name, email: email.toLowerCase(), passHash });
    return toPublic(doc as IBusiness);
};

export const findBusinessByEmail = async (email: string) => {
    const doc = await BusinessModel.findOne({ email: email.toLowerCase() }).exec();
    return doc ? toPublic(doc as IBusiness) : undefined;
};

export const findBusinessById = async (id: string) => {
    const doc = await BusinessModel.findById(id).exec();
    return doc ? toPublic(doc as IBusiness) : undefined;
};

export const verifyPassword = async (password: string, passHash: string): Promise<boolean> => {
    return bcrypt.compare(password, passHash);
};

export const addRefreshToken = async (businessId: string, token: string): Promise<void> => {
    await BusinessModel.findByIdAndUpdate(businessId, { $push: { refreshTokens: token } }).exec();
};

export const removeRefreshToken = async (businessId: string, token: string): Promise<void> => {
    await BusinessModel.findByIdAndUpdate(businessId, { $pull: { refreshTokens: token } }).exec();
};

export const hasRefreshToken = async (businessId: string, token: string): Promise<boolean> => {
    const doc = await BusinessModel.findOne({ _id: businessId, refreshTokens: token }).exec();
    return !!doc;
};
