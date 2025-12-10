/**
 * Authentication routes
 *
 * Exposes three routes used by the frontend or API clients:
 * - POST /auth/register -> register a new user
 * - POST /auth/login    -> obtain JWT token
 * - GET  /auth/me       -> get current user (requires Bearer token)
 */
import { Router } from 'express';
import multer from 'multer';
import * as authCtrl from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
});

router.post('/register', authCtrl.register);
router.post('/login', authCtrl.login);
router.get('/me', authenticate, authCtrl.me);
router.put('/me', authenticate, authCtrl.updateMe);
router.post('/profile-picture', authenticate, upload.single('profilePicture'), authCtrl.uploadProfilePicture);

// Email verification and password reset
router.get('/verify-email', authCtrl.verifyEmail);
router.post('/resend-verification', authenticate, authCtrl.resendVerification);
router.post('/forgot-password', authCtrl.forgotPassword);
router.post('/reset-password', authCtrl.resetPassword);

// Refresh and logout endpoints
router.post('/refresh', authCtrl.refresh);
router.post('/logout', authCtrl.logout);

// Get user by ID (public)
router.get('/:id', authCtrl.getUserById);

export default router;
