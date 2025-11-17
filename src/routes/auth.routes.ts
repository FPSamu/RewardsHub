/**
 * Authentication routes
 *
 * Exposes three routes used by the frontend or API clients:
 * - POST /auth/register -> register a new user
 * - POST /auth/login    -> obtain JWT token
 * - GET  /auth/me       -> get current user (requires Bearer token)
 */
import { Router } from 'express';
import * as authCtrl from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.post('/register', authCtrl.register);
router.post('/login', authCtrl.login);
router.get('/me', authenticate, authCtrl.me);

// Refresh and logout endpoints
router.post('/refresh', authCtrl.refresh);
router.post('/logout', authCtrl.logout);

// Get user by ID (public)
router.get('/:id', authCtrl.getUserById);

export default router;
