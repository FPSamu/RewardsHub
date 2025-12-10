/**
 * Authentication controllers
 *
 * Exposes register, login and me endpoints. These controllers are thin and
 * delegate persistence to the user service. They issue JWTs on successful
 * authentication.
 */
import { Request, Response } from 'express';
import * as userService from '../services/user.service';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || `${JWT_SECRET}_refresh`;
const ACCESS_EXPIRES = process.env.ACCESS_EXPIRES || '15m';
const REFRESH_EXPIRES = process.env.REFRESH_EXPIRES || '7d';

/**
 * Register a new user.
 * Expects { username, email, password } in the request body.
 * On success returns 201 with a token and the newly created user (without passHash).
 */
export const register = async (req: Request, res: Response) => {
    const { username, email, password } = req.body as { username: string, email: string, password: string };
    if (!username || !email || !password) {
        return res.status(400).json({ message: 'username, email and password are required' });
    }

    const existing = await userService.findUserByEmail(email);
    if (existing) return res.status(409).json({ message: 'email already used' });

    const user = await userService.createUser(username, email, password);
    
    // Send verification email
    const verificationToken = await userService.generateVerificationToken(user.id);
    
    try {
        const emailService = await import('../services/email.service');
        await emailService.sendVerificationEmail(email, verificationToken, false);
    } catch (error) {
        console.error('Failed to send verification email:', error);
    }
    
    const accessToken = (jwt as any).sign({ sub: user.id }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
    const refreshToken = (jwt as any).sign({ sub: user.id }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
    // store refresh token
    await userService.addRefreshToken(user.id, refreshToken);
    return res.status(201).json({ 
        user: { 
            id: user.id, 
            username: user.username, 
            email: user.email, 
            profilePicture: user.profilePicture, 
            isVerified: user.isVerified,
            createdAt: user.createdAt 
        }, 
        token: accessToken, refreshToken });
};

/**
 * Authenticate a user using email/password and return a JWT.
 * Expects { email, password } in the request body.
 */
export const login = async (req: Request, res: Response) => {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) return res.status(400).json({ message: 'email and password required' });

    const user = await userService.findUserByEmail(email);
    if (!user) return res.status(401).json({ message: 'invalid credentials' });

    const ok = await userService.verifyPassword(password, user.passHash);
    if (!ok) return res.status(401).json({ message: 'invalid credentials' });

    const accessToken = (jwt as any).sign({ sub: user.id }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
    const refreshToken = (jwt as any).sign({ sub: user.id }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
    await userService.addRefreshToken(user.id, refreshToken);
    return res.json({ 
        user: { 
            id: user.id, 
            username: user.username, 
            email: user.email, 
            profilePicture: user.profilePicture, 
            isVerified: user.isVerified,
            createdAt: user.createdAt 
        }, 
        token: accessToken, refreshToken 
    });
};

/**
 * Exchange a refresh token for a new access token (and rotate refresh token).
 * Expects { refreshToken } in body.
 */
export const refresh = async (req: Request, res: Response) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) return res.status(400).json({ message: 'refreshToken required' });
    try {
        const payload = jwt.verify(refreshToken, REFRESH_SECRET) as any;
        const userId = payload.sub as string;
        const ok = await userService.hasRefreshToken(userId, refreshToken);
        if (!ok) return res.status(401).json({ message: 'invalid refresh token' });

        // rotate: remove old, create new
        await userService.removeRefreshToken(userId, refreshToken);
    const newAccess = (jwt as any).sign({ sub: userId }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
    const newRefresh = (jwt as any).sign({ sub: userId }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
        await userService.addRefreshToken(userId, newRefresh);
        return res.json({ token: newAccess, refreshToken: newRefresh });
    } catch (err) {
        return res.status(401).json({ message: 'invalid refresh token' });
    }
};

/**
 * Logout by revoking a refresh token.
 * Expects { refreshToken } in body.
 */
export const logout = async (req: Request, res: Response) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) return res.status(400).json({ message: 'refreshToken required' });
    try {
        const payload = jwt.verify(refreshToken, REFRESH_SECRET) as any;
        const userId = payload.sub as string;
        await userService.removeRefreshToken(userId, refreshToken);
        return res.json({ ok: true });
    } catch (err) {
        // token invalid -> still respond success to avoid token fishing
        return res.json({ ok: true });
    }
};

/**
 * Return the current authenticated user.
 * The `authenticate` middleware injects `req.user` (public user object).
 */
export const me = (req: Request, res: Response) => {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'not authenticated' });
    return res.json({ 
        id: user.id, 
        username: user.username, 
        email: user.email, 
        profilePicture: user.profilePicture, 
        createdAt: user.createdAt, 
        isVerified: user.isVerified 
    });
};

/**
 * Get user information by ID.
 * Public endpoint for viewing user profiles.
 */
export const getUserById = async (req: Request, res: Response) => {
    const { id } = req.params;
    
    if (!id) {
        return res.status(400).json({ message: 'user id is required' });
    }

    try {
        const user = await userService.findUserById(id);
        
        if (!user) {
            return res.status(404).json({ message: 'user not found' });
        }

        // Return only public information (no passHash)
        return res.json({
            id: user.id,
            username: user.username,
            email: user.email,
            profilePicture: user.profilePicture,
            createdAt: user.createdAt
        });
    } catch (error) {
        return res.status(500).json({ message: 'failed to get user information' });
    }
};

/**
 * Update current authenticated user information.
 * Expects { username?, email?, password? } in body.
 * PUT /api/auth/me
 */
export const updateMe = async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'not authenticated' });

    const { username, email, password } = req.body as {
        username?: string;
        email?: string;
        password?: string;
    };

    // Validate that at least one field is provided
    if (!username && !email && !password) {
        return res.status(400).json({ message: 'at least one field (username, email, password) is required' });
    }

    // Check if email is already taken by another user
    if (email) {
        const existing = await userService.findUserByEmail(email);
        if (existing && existing.id !== user.id) {
            return res.status(409).json({ message: 'email already in use' });
        }
    }

    try {
        const updatedUser = await userService.updateUser(user.id, { username, email, password });
        return res.json({
            id: updatedUser.id,
            username: updatedUser.username,
            email: updatedUser.email,
            profilePicture: updatedUser.profilePicture,
            createdAt: updatedUser.createdAt
        });
    } catch (error) {
        return res.status(500).json({ message: 'failed to update user' });
    }
};

/**
 * Upload user profile picture
 * POST /api/auth/profile-picture
 * Expects multipart/form-data with field 'profilePicture'
 */
export const uploadProfilePicture = async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'not authenticated' });

    if (!req.file) {
        return res.status(400).json({ message: 'no file uploaded' });
    }

    try {
        // Dynamic import to avoid circular dependency
        const uploadService = await import('../services/upload.service');
        
        // Upload to S3
        const profilePictureUrl = await uploadService.uploadFile(req.file, 'profile-pictures');

        // Update user record
        const updatedUser = await userService.updateUserProfilePicture(user.id, profilePictureUrl);

        return res.json({
            message: 'Profile picture uploaded successfully',
            profilePicture: profilePictureUrl,
            user: {
                id: updatedUser.id,
                username: updatedUser.username,
                email: updatedUser.email,
                profilePicture: updatedUser.profilePicture,
                createdAt: updatedUser.createdAt
            },
        });
    } catch (error: any) {
        console.error('Upload error:', error);
        return res.status(500).json({ message: 'failed to upload profile picture' });
    }
};

/**
 * Verify user email
 * GET /api/auth/verify-email?token=xxx
 */
export const verifyEmail = async (req: Request, res: Response) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: 'Token required' });

    const user = await userService.verifyUserEmail(token as string);
    if (!user) return res.status(400).json({ message: 'Invalid or expired token' });

    return res.json({ message: 'Email verified successfully' });
};

export const resendVerification = async (req: Request, res: Response) => {
    const user = (req as any).user;
    if (user.isVerified) return res.status(400).json({ message: 'Already verified' });

    const token = await userService.generateVerificationToken(user.id);
    
    try {
        const emailService = await import('../services/email.service');
        await emailService.sendVerificationEmail(user.email, token, false); // false = user account
        return res.json({ message: 'Verification email sent' });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to send email' });
    }
};

/**
 * Request password reset
 * POST /api/auth/forgot-password
 * Expects { email } in body
 */
export const forgotPassword = async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });

    const token = await userService.generatePasswordResetToken(email);
    if (token) {
        try {
            const emailService = await import('../services/email.service');
            await emailService.sendPasswordResetEmail(email, token);
        } catch (error) {
            console.error('Failed to send reset email:', error);
            return res.status(500).json({ message: 'Failed to send email' });
        }
    }
    // Always return success to prevent email enumeration
    return res.json({ message: 'If an account exists, a reset email has been sent' });
};

/**
 * Reset password with token
 * POST /api/auth/reset-password
 * Expects { token, password } in body
 */
export const resetPassword = async (req: Request, res: Response) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Token and password required' });

    const user = await userService.resetPassword(token, password);
    if (!user) return res.status(400).json({ message: 'Invalid or expired token' });

    return res.json({ message: 'Password reset successfully' });
};
