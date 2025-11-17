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
    const { username, email, password } = req.body as { username: string; email: string; password: string };
    if (!username || !email || !password) {
        return res.status(400).json({ message: 'username, email and password are required' });
    }

    const existing = await userService.findUserByEmail(email);
    if (existing) return res.status(409).json({ message: 'email already used' });

    const user = await userService.createUser(username, email, password);
    const accessToken = (jwt as any).sign({ sub: user.id }, JWT_SECRET, { expiresIn: ACCESS_EXPIRES });
    const refreshToken = (jwt as any).sign({ sub: user.id }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES });
    // store refresh token
    await userService.addRefreshToken(user.id, refreshToken);
    return res.status(201).json({ user: { id: user.id, username: user.username, email: user.email, createdAt: user.createdAt }, token: accessToken, refreshToken });
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
    return res.json({ user: { id: user.id, username: user.username, email: user.email, createdAt: user.createdAt }, token: accessToken, refreshToken });
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
    return res.json({ id: user.id, username: user.username, email: user.email, createdAt: user.createdAt });
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
            createdAt: user.createdAt
        });
    } catch (error) {
        return res.status(500).json({ message: 'failed to get user information' });
    }
};
