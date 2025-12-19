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
    profilePicture: doc.profilePicture,
    isVerified: doc.isVerified,
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

    console.log('🔵 [CREATE USER] Creando usuario:', {
        email: email.toLowerCase(),
        timestamp: new Date().toISOString()
    });

    const doc = await UserModel.create({ username, email: email.toLowerCase(), passHash });

    console.log('🟢 [CREATE USER] Usuario creado:', {
        email: doc.email,
        id: doc._id,
        isVerified: doc.isVerified,
        verificationToken: doc.verificationToken,
        timestamp: new Date().toISOString()
    });

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

/**
 * Update user information.
 * @param userId - user document id
 * @param updates - fields to update (username, email, password)
 * @returns updated public user object
 */
export const updateUser = async (
    userId: string,
    updates: { username?: string; email?: string; password?: string }
) => {
    const updateData: any = {};

    if (updates.username) {
        updateData.username = updates.username;
    }

    if (updates.email) {
        updateData.email = updates.email.toLowerCase();
    }

    if (updates.password) {
        updateData.passHash = await bcrypt.hash(updates.password, 10);
    }

    const doc = await UserModel.findByIdAndUpdate(userId, updateData, { new: true }).exec();
    if (!doc) throw new Error('user not found');
    return toPublic(doc as IUser);
};

/**
 * Update user profile picture URL.
 * @param userId - user document id
 * @param profilePictureUrl - S3 URL of the profile picture
 * @returns updated public user object
 */
export const updateUserProfilePicture = async (userId: string, profilePictureUrl: string) => {
    const doc = await UserModel.findByIdAndUpdate(
        userId,
        { profilePicture: profilePictureUrl },
        { new: true }
    ).exec();
    if (!doc) throw new Error('user not found');
    return toPublic(doc as IUser);
};

/**
 * Generate email verification token and save to user
 * @param userId - user document id
 * @returns verification token
 */
export const generateVerificationToken = async (userId: string): Promise<string> => {
    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');

    console.log('🔵 [GENERATE TOKEN] Generando token de verificación:', {
        userId,
        timestamp: new Date().toISOString()
    });

    await UserModel.findByIdAndUpdate(userId, { verificationToken: token }).exec();

    // Verificar que se guardó correctamente
    const updatedUser = await UserModel.findById(userId).select('email isVerified verificationToken').exec();
    console.log('🟢 [GENERATE TOKEN] Token guardado:', {
        userId,
        email: updatedUser?.email,
        isVerified: updatedUser?.isVerified,
        hasToken: !!updatedUser?.verificationToken,
        timestamp: new Date().toISOString()
    });

    return token;
};

/**
 * Verify user email with token
 * @param token - verification token
 * @returns user object if successful, undefined otherwise
 */
export const verifyUserEmail = async (token: string) => {
    const doc = await UserModel.findOne({ verificationToken: token }).exec();
    if (!doc) return undefined;

    doc.isVerified = true;
    doc.verificationToken = undefined;
    await doc.save();
    return toPublic(doc as IUser);
};

/**
 * Generate password reset token
 * @param email - user email
 * @returns reset token if user exists, undefined otherwise
 */
export const generatePasswordResetToken = async (email: string): Promise<string | undefined> => {
    const doc = await UserModel.findOne({ email: email.toLowerCase() }).exec();
    if (!doc) return undefined;

    const crypto = await import('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 3600000); // 1 hour

    doc.resetPasswordToken = token;
    doc.resetPasswordExpires = expires;
    await doc.save();
    return token;
};

/**
 * Reset password using token
 * @param token - reset token
 * @param newPassword - new plain password
 * @returns user object if successful, undefined otherwise
 */
export const resetPassword = async (token: string, newPassword: string) => {
    const doc = await UserModel.findOne({
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: new Date() },
    }).exec();

    if (!doc) return undefined;

    doc.passHash = await bcrypt.hash(newPassword, 10);
    doc.resetPasswordToken = undefined;
    doc.resetPasswordExpires = undefined;
    await doc.save();
    return toPublic(doc as IUser);
};
