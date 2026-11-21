import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import authRoutes from './routes/auth.routes';
import businessRoutes from './routes/business.routes';
import systemRoutes from './routes/system.routes';
import rewardRoutes from './routes/reward.routes';
import userPointsRoutes from './routes/userPoints.routes';
import transactionRoutes from './routes/transaction.routes';
import subscriptionRoutes from './routes/subscription.routes';
import webhookRoutes from './routes/webhook.routes';
import deliveryRoutes from './routes/delivery.routes';
import workShiftRoutes from './routes/workShift.routes';
import reportRoutes from './routes/report.routes';
import notificationRoutes from './routes/notification.routes';
import passRoutes from './routes/pass.routes';
import membershipRoutes from './routes/membership.routes';
import appVersionRoutes from './routes/appVersion.routes';
import { notFoundHandler, errorHandler } from './middleware/error.middleware';
// src/anna es CommonJS en JavaScript
// eslint-disable-next-line @typescript-eslint/no-var-requires
const annaRouter = require('./anna/router');

const app = express();

// Detrás de un load balancer (ALB) la IP real del cliente viene en
// X-Forwarded-For. TRUST_PROXY = número de proxies delante (1 para el ALB).
if (process.env.TRUST_PROXY) {
    const hops = parseInt(process.env.TRUST_PROXY, 10);
    app.set('trust proxy', Number.isNaN(hops) ? process.env.TRUST_PROXY : hops);
}

// Webhook routes MUST come before express.json() for raw body parsing
app.use('/webhooks', webhookRoutes);

app.use(helmet());

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()) || [];

const corsOptions = {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (like mobile apps, Postman, or curl)
        if (!origin) {
            return callback(null, true);
        }

        // In development, allow all origins
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[CORS] Allowing origin in development: ${origin}`);
            return callback(null, true);
        }

        // In production, check against allowed origins
        if (allowedOrigins.length === 0) {
            console.warn('[CORS] WARNING: No ALLOWED_ORIGINS configured in production!');
            return callback(new Error('CORS not configured'), false);
        }

        if (allowedOrigins.includes(origin)) {
            console.log(`[CORS] Allowing origin: ${origin}`);
            return callback(null, true);
        } else {
            console.warn(`[CORS] Blocking origin: ${origin}`);
            return callback(new Error('Not allowed by CORS'), false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    // Idempotency-Key: el cliente lo manda en escrituras que mueven saldo (ver idempotency.middleware.ts)
    allowedHeaders: ['Content-Type', 'Authorization', 'x-admin-token', 'Idempotency-Key'],
    exposedHeaders: ['Content-Range', 'X-Content-Range', 'Idempotent-Replayed', 'Retry-After', 'X-Cache', 'X-Data-Freshness'],
    maxAge: 600, // Cache preflight requests for 10 minutes
};

app.use(cors(corsOptions));

// El load balancer consulta /health cada pocos segundos por instancia; no
// registrarlo deja en los logs solo el tráfico real.
app.use(morgan('dev', { skip: (req) => req.url === '/health' }));
app.use(express.json());

/**
 * Health endpoint useful for readiness/liveness checks.
 */
app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});

app.get('/', (req, res) => {
    res.send('Server Working!');
})

/**
 * Mount authentication routes under /auth
 * - POST /auth/register
 * - POST /auth/login
 * - GET  /auth/me (protected)
 */
app.use('/auth', authRoutes);
app.use('/business', businessRoutes);
app.use('/systems', systemRoutes);
app.use('/rewards', rewardRoutes);
app.use('/user-points', userPointsRoutes);
app.use('/transactions', transactionRoutes);
app.use('/subscription', subscriptionRoutes);
app.use('/delivery', deliveryRoutes);
app.use('/work-shifts', workShiftRoutes);
app.use('/report', reportRoutes);
app.use('/notifications', notificationRoutes);
app.use('/passes', passRoutes);
app.use('/memberships', membershipRoutes);
app.use('/app-version', appVersionRoutes);
app.use('/anna/api', annaRouter);

// Siempre al final: 404 y errores (next(err), CORS, JSON inválido) en JSON.
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
