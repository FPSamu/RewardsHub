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

dotenv.config();

const app = express();

app.use(helmet());
app.use(cors());
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

export default app;
