import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import * as userService from '../services/user.service';
import * as businessService from '../services/business.service';
import * as authService from '../services/auth.service';
import * as firebaseService from '../services/firebase.service';
import { UserModel } from '../models/user.model';
import { BusinessModel } from '../models/business.model';

// ── LOGIN ─────────────────────────────────────────────────────────────────────
//
// Flujo:
//   1. Frontend autentica con Firebase (email/password o Google) → obtiene idToken
//   2. Envía idToken al backend
//   3. Backend verifica el token → extrae email
//   4. Busca el email en MongoDB (users → businesses)
//   5. Devuelve JWT propio + rol + datos

export const login = async (req: Request, res: Response) => {
    const { idToken } = req.body as { idToken: string };
    if (!idToken) return res.status(400).json({ message: 'idToken required' });

    let firebasePayload: firebaseService.FirebaseTokenPayload;
    try {
        firebasePayload = await firebaseService.verifyIdToken(idToken);
    } catch {
        return res.status(401).json({ message: 'invalid Firebase token' });
    }

    const { email } = firebasePayload;

    // Buscar en users
    const user = await userService.findUserByEmail(email);
    if (user) {
        const { accessToken, refreshToken } = authService.issueTokenPair(user.id, 'user');
        await authService.addRefreshToken(UserModel, user.id, refreshToken);
        return res.json({
            role: 'user',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                profilePicture: user.profilePicture,
                isVerified: user.isVerified,
                createdAt: user.createdAt,
            },
            token: accessToken,
            refreshToken,
        });
    }

    // Buscar en businesses
    const biz = await businessService.findBusinessByEmail(email);
    if (biz) {
        const { accessToken, refreshToken } = authService.issueTokenPair(biz.id, 'business');
        await authService.addRefreshToken(BusinessModel, biz.id, refreshToken);
        return res.json({
            role: 'business',
            user: {
                id: biz.id,
                username: biz.username,
                email: biz.email,
                isVerified: biz.isVerified,
                createdAt: biz.createdAt,
            },
            token: accessToken,
            refreshToken,
        });
    }

    // Firebase tiene la cuenta pero MongoDB no → inconsistencia
    return res.status(409).json({
        code: 'ACCOUNT_INCONSISTENCY',
        message: 'Firebase account exists but no MongoDB record found',
    });
};

// ── CHECK EMAIL ───────────────────────────────────────────────────────────────
//
// Usado por el frontend antes de mostrar el formulario de login o registro.
// Devuelve si el email ya tiene cuenta y en qué rol.

export const checkEmail = async (req: Request, res: Response) => {
    const { email } = req.body as { email: string };
    if (!email) return res.status(400).json({ message: 'email required' });

    const existsInFirebase = await firebaseService.checkEmailExists(email);

    if (!existsInFirebase) {
        return res.json({ exists: false });
    }

    // Determinar rol en MongoDB
    const user = await userService.findUserByEmail(email);
    if (user) return res.json({ exists: true, role: 'user' });

    const biz = await businessService.findBusinessByEmail(email);
    if (biz) return res.json({ exists: true, role: 'business' });

    // Existe en Firebase pero no en MongoDB
    return res.status(409).json({
        code: 'ACCOUNT_INCONSISTENCY',
        message: 'Firebase account exists but no MongoDB record found',
    });
};

// ── REGISTRO ──────────────────────────────────────────────────────────────────
//
// Flujo:
//   1. Frontend verifica con el backend que el email no existe en Firebase
//   2. Frontend crea la cuenta en Firebase (email/password o Google)
//   3. Envía idToken + role al backend
//   4. Backend verifica el token, crea el registro en MongoDB, devuelve JWT

export const register = async (req: Request, res: Response) => {
    const { idToken, role, username } = req.body as {
        idToken: string;
        role: 'user' | 'business';
        username?: string;
    };

    if (!idToken) return res.status(400).json({ message: 'idToken required' });
    if (role !== 'user' && role !== 'business') {
        return res.status(400).json({ message: 'role must be user or business' });
    }

    let firebasePayload: firebaseService.FirebaseTokenPayload;
    try {
        firebasePayload = await firebaseService.verifyIdToken(idToken);
    } catch {
        return res.status(401).json({ message: 'invalid Firebase token' });
    }

    const { uid, email, name } = firebasePayload;
    const displayName = username || name;

    // Verificar que no exista ya en MongoDB (Firebase es la fuente de verdad de existencia,
    // pero prevenimos duplicados en nuestra DB antes de intentar el insert)
    const [existingUser, existingBiz] = await Promise.all([
        userService.findUserByEmail(email),
        businessService.findBusinessByEmail(email),
    ]);
    if (existingUser || existingBiz) {
        return res.status(409).json({ code: 'EMAIL_TAKEN', message: 'Account already exists, please sign in' });
    }

    try {
        if (role === 'user') {
            const user = await userService.createUser(displayName, email, undefined, uid);
            const { accessToken, refreshToken } = authService.issueTokenPair(user.id, 'user');
            await authService.addRefreshToken(UserModel, user.id, refreshToken);
            return res.status(201).json({
                role: 'user',
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    isVerified: user.isVerified,
                    createdAt: user.createdAt,
                },
                token: accessToken,
                refreshToken,
            });
        }

        // role === 'business'
        const biz = await businessService.createBusiness(displayName, email, undefined, uid);
        const { accessToken, refreshToken } = authService.issueTokenPair(biz.id, 'business');
        await authService.addRefreshToken(BusinessModel, biz.id, refreshToken);
        return res.status(201).json({
            role: 'business',
            user: {
                id: biz.id,
                username: biz.username,
                email: biz.email,
                isVerified: biz.isVerified,
                createdAt: biz.createdAt,
            },
            token: accessToken,
            refreshToken,
        });
    } catch (err) {
        // Si MongoDB falla después de que Firebase ya creó la cuenta, la revertimos
        await firebaseService.deleteUser(uid);
        console.error('[register] MongoDB failed, Firebase user deleted:', uid, err);
        return res.status(500).json({ message: 'Registration failed, please try again' });
    }
};

// ── ME / UPDATE / UPLOAD ──────────────────────────────────────────────────────

export const me = (req: Request, res: Response) => {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'not authenticated' });
    return res.json({
        id: user.id,
        username: user.username,
        email: user.email,
        profilePicture: user.profilePicture,
        createdAt: user.createdAt,
        isVerified: user.isVerified,
    });
};

export const getUserById = async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'user id is required' });
    try {
        const user = await userService.findUserById(id);
        if (!user) return res.status(404).json({ message: 'user not found' });
        return res.json({ id: user.id, username: user.username, email: user.email, profilePicture: user.profilePicture, createdAt: user.createdAt });
    } catch {
        return res.status(500).json({ message: 'failed to get user information' });
    }
};

export const updateMe = async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'not authenticated' });

    const { username, email, password } = req.body as { username?: string; email?: string; password?: string };
    if (!username && !email && !password) {
        return res.status(400).json({ message: 'at least one field (username, email, password) is required' });
    }

    if (email) {
        const existing = await userService.findUserByEmail(email);
        if (existing && existing.id !== user.id) {
            return res.status(409).json({ message: 'email already in use' });
        }
    }

    try {
        const updated = await userService.updateUser(user.id, { username, email, password });
        return res.json({ id: updated.id, username: updated.username, email: updated.email, profilePicture: updated.profilePicture, createdAt: updated.createdAt });
    } catch {
        return res.status(500).json({ message: 'failed to update user' });
    }
};

export const uploadProfilePicture = async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'not authenticated' });
    if (!req.file) return res.status(400).json({ message: 'no file uploaded' });

    try {
        const uploadService = await import('../services/upload.service');
        const profilePictureUrl = await uploadService.uploadFile(req.file, 'profile-pictures');
        const updated = await userService.updateUserProfilePicture(user.id, profilePictureUrl);
        return res.json({
            message: 'Profile picture uploaded successfully',
            profilePicture: profilePictureUrl,
            user: { id: updated.id, username: updated.username, email: updated.email, profilePicture: updated.profilePicture, createdAt: updated.createdAt },
        });
    } catch (error: any) {
        console.error('Upload error:', error);
        return res.status(500).json({ message: 'failed to upload profile picture' });
    }
};

// ── EMAIL VERIFICATION ────────────────────────────────────────────────────────

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

    const token = await authService.generateVerificationToken(UserModel, user.id);
    try {
        const emailService = await import('../services/email.service');
        await emailService.sendVerificationEmail(user.email, token, false);
        return res.json({ message: 'Verification email sent' });
    } catch {
        return res.status(500).json({ message: 'Failed to send email' });
    }
};

export const forgotPassword = async (req: Request, res: Response) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email required' });

    const token = await authService.generatePasswordResetToken(UserModel, email);
    if (token) {
        try {
            const emailService = await import('../services/email.service');
            await emailService.sendPasswordResetEmail(email, token);
        } catch (error) {
            console.error('Failed to send reset email:', error);
            return res.status(500).json({ message: 'Failed to send email' });
        }
    }
    return res.json({ message: 'If an account exists, a reset email has been sent' });
};

export const resetPassword = async (req: Request, res: Response) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ message: 'Token and password required' });

    const ok = await authService.resetPassword(UserModel, token, password);
    if (!ok) return res.status(400).json({ message: 'Invalid or expired token' });

    return res.json({ message: 'Password reset successfully' });
};

// ── REFRESH / LOGOUT ──────────────────────────────────────────────────────────
// Unificados: el role dentro del JWT determina qué colección usar.

export const refresh = async (req: Request, res: Response) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) return res.status(400).json({ message: 'refreshToken required' });
    try {
        const payload = authService.verifyRefreshToken(refreshToken);
        const model = payload.role === 'business' ? BusinessModel : UserModel;

        const ok = await authService.hasRefreshToken(model, payload.sub, refreshToken);
        if (!ok) return res.status(401).json({ message: 'invalid refresh token' });

        await authService.removeRefreshToken(model, payload.sub, refreshToken);
        const tokens = authService.issueTokenPair(payload.sub, payload.role);
        await authService.addRefreshToken(model, payload.sub, tokens.refreshToken);

        return res.json({ token: tokens.accessToken, refreshToken: tokens.refreshToken });
    } catch {
        return res.status(401).json({ message: 'invalid refresh token' });
    }
};

// ── CASHIER LOGIN ─────────────────────────────────────────────────────────────
//
// Login para cajeros: email + contraseña de sucursal, sin pasar por Firebase.
// El dueño del negocio no comparte su acceso a Google — los cajeros usan
// esta contraseña separada que no da acceso al correo.

export const cashierLogin = async (req: Request, res: Response) => {
    const { email, password } = req.body as { email: string; password: string };
    if (!email || !password) {
        return res.status(400).json({ message: 'email and password required' });
    }

    const biz = await businessService.findBusinessByEmail(email);
    if (!biz) return res.status(401).json({ message: 'invalid credentials' });

    // Cuentas creadas con Google requieren branchPassHash explícito.
    // Cuentas creadas con email/password usan su passHash como contraseña de sucursal.
    if (!biz.branchPassHash && biz.registeredWithGoogle) {
        return res.status(403).json({
            code: 'NO_BRANCH_PASSWORD',
            message: 'This business has not set up a branch password yet',
        });
    }

    const hashToCheck = biz.branchPassHash ?? biz.passHash;
    const ok = await bcrypt.compare(password, hashToCheck);
    if (!ok) return res.status(401).json({ message: 'invalid credentials' });

    const { accessToken, refreshToken } = authService.issueTokenPair(biz.id, 'business');
    await authService.addRefreshToken(BusinessModel, biz.id, refreshToken);

    return res.json({
        role: 'business',
        user: {
            id: biz.id,
            username: biz.username,
            email: biz.email,
            isVerified: biz.isVerified,
            createdAt: biz.createdAt,
        },
        token: accessToken,
        refreshToken,
    });
};

export const logout = async (req: Request, res: Response) => {
    const { refreshToken } = req.body as { refreshToken?: string };
    if (!refreshToken) return res.status(400).json({ message: 'refreshToken required' });
    try {
        const payload = authService.verifyRefreshToken(refreshToken);
        const model = payload.role === 'business' ? BusinessModel : UserModel;
        await authService.removeRefreshToken(model, payload.sub, refreshToken);
    } catch {
        // token inválido → responder éxito de todas formas
    }
    return res.json({ ok: true });
};
