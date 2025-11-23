import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import businessRoutes from './routes/business.routes';
import systemRoutes from './routes/system.routes';
import rewardRoutes from './routes/reward.routes';
import userPointsRoutes from './routes/userPoints.routes';
import transactionRoutes from './routes/transaction.routes';

dotenv.config();

const app = express();

app.use(helmet());

// CORS configuration for local network access
const corsOptions = {
    origin: process.env.NODE_ENV === 'production' 
        ? process.env.ALLOWED_ORIGINS?.split(',') 
        : true, // Allow all origins in development
    credentials: true,
};
app.use(cors(corsOptions));

app.use(morgan('dev'));
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

export default app;
