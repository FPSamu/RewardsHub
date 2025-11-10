/**
 * User service (persistence layer).
 *
 * This module is responsible for creating users and fetching them from the
 * database. It returns simple plain objects (not Mongoose documents) so the
 * controller layer does not accidentally leak Mongoose internals.
 */
import bcrypt from 'bcryptjs';
import { UserModel, IUser } from '../models/user.model';

/**
 * Convert a Mongoose document into a plain public object used by the API.
 * Note: this helper still includes `passHash` for internal checks; callers
 * should avoid returning `passHash` to clients (controllers hide it explicitly).
 */
const toPublic = (doc: IUser) => ({
    id: doc._id.toString(),
    username: doc.username,
    email: doc.email,
    passHash: doc.passHash,
    createdAt: doc.createdAt.toISOString(),
});

/**
 * Create a new user.
 * @param username - display name
 * @param email - user email (will be stored in lowercase)
 * @param password - plain-text password (will be hashed)
 * @returns public user object (including id and createdAt)
 */
export const createUser = async (username: string, email: string, password: string) => {
    const passHash = await bcrypt.hash(password, 10);
    const doc = await UserModel.create({ username, email: email.toLowerCase(), passHash });
    return toPublic(doc as IUser);
};

/**
 * Find a user by email.
 * @param email - case-insensitive email lookup
 * @returns public user object or undefined
 */
export const findUserByEmail = async (email: string) => {
    const doc = await UserModel.findOne({ email: email.toLowerCase() }).exec();
    return doc ? toPublic(doc as IUser) : undefined;
};

/**
 * Find a user by id.
 * @param id - MongoDB document id
 * @returns public user object or undefined
 */
export const findUserById = async (id: string) => {
    const doc = await UserModel.findById(id).exec();
    return doc ? toPublic(doc as IUser) : undefined;
};

/**
 * Verify a plain password against a stored bcrypt hash.
 */
export const verifyPassword = async (password: string, passHash: string): Promise<boolean> => {
    return bcrypt.compare(password, passHash);
};

/**
 * Add a refresh token to the user's list of active refresh tokens.
 * @param userId - user document id
 * @param token - refresh token string to add
 */
export const addRefreshToken = async (userId: string, token: string): Promise<void> => {
    await UserModel.findByIdAndUpdate(userId, { $push: { refreshTokens: token } }).exec();
};

/**
 * Remove a refresh token from the user's list (logout / revoke).
 */
export const removeRefreshToken = async (userId: string, token: string): Promise<void> => {
    await UserModel.findByIdAndUpdate(userId, { $pull: { refreshTokens: token } }).exec();
};

/**
 * Check whether the provided refresh token exists for the user.
 */
export const hasRefreshToken = async (userId: string, token: string): Promise<boolean> => {
    const doc = await UserModel.findOne({ _id: userId, refreshTokens: token }).exec();
    return !!doc;
};
