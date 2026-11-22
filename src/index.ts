import './types/express';
import app from './app';
import connectDb from './db/mongoose';
import os from 'os';
import { runNotificationBatch, runEngagementBatch } from './services/notification.service';
import { isQueueEnabled } from './queue/sqs';
import { closeRedis, warmUpRedis } from './cache/redis';
import { startMetrics, stopMetrics } from './observability/metrics';

const port = parseInt(process.env.PORT || '3000', 10);
const host = '0.0.0.0'; // Listen on all network interfaces

const start = async () => {
    // Ensure DB connection is established before accepting requests
    await connectDb();
    // Con varias instancias detrás del load balancer, el scheduler en proceso
    // dispararía el batch N veces. En AWS lo programa EventBridge → SQS → worker.
    if (isQueueEnabled()) {
        console.log('📨 [Queue] SQS activa: batches programados por EventBridge, no en proceso');
    } else {
        scheduleNotifications();
        scheduleEngagement();
    }
    startMetrics('api');
    // Conexión a Redis lista antes de recibir tráfico (sin REDIS_URL no hace nada)
    await warmUpRedis();
    const server = app.listen(port, host, () => {
        console.log(`Server running on port ${port}`);
        console.log(`Local: http://localhost:${port}`);
        
        // Display network IPs for local network access
        const networkInterfaces = os.networkInterfaces();
        Object.keys(networkInterfaces).forEach((interfaceName) => {
            const interfaces = networkInterfaces[interfaceName];
            interfaces?.forEach((iface) => {
                if (iface.family === 'IPv4' && !iface.internal) {
                    console.log(`Network: http://${iface.address}:${port}`);
                }
            });
        });
    });

    // El ASG/ALB manda SIGTERM al reemplazar instancias: dejamos de aceptar
    // conexiones y terminamos las peticiones en curso antes de salir.
    const shutdown = (signal: string) => {
        console.log(`🛑 ${signal} recibido, cerrando servidor...`);
        server.close(() => {
            Promise.allSettled([stopMetrics(), closeRedis()]).finally(() => process.exit(0));
        });
        setTimeout(() => process.exit(0), 25_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
};

/**
 * Schedules the daily notification batch to run at 10:00 AM server time.
 * After the first run it repeats every 24 hours.
 */
const scheduleNotifications = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(10, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const msUntilFirst = next.getTime() - now.getTime();
    console.log(`📅 [Notifications] First batch scheduled in ${Math.round(msUntilFirst / 60000)} minutes`);

    setTimeout(() => {
        runNotificationBatch().catch(err =>
            console.error('❌ [Notifications] Batch error:', err)
        );
        setInterval(() => {
            runNotificationBatch().catch(err =>
                console.error('❌ [Notifications] Batch error:', err)
            );
        }, 24 * 60 * 60 * 1000);
    }, msUntilFirst);
};

const scheduleEngagement = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(19, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const msUntilFirst = next.getTime() - now.getTime();
    console.log(`📅 [Engagement] First batch scheduled in ${Math.round(msUntilFirst / 60000)} minutes`);

    setTimeout(() => {
        runEngagementBatch().catch(err =>
            console.error('❌ [Engagement] Batch error:', err)
        );
        setInterval(() => {
            runEngagementBatch().catch(err =>
                console.error('❌ [Engagement] Batch error:', err)
            );
        }, 24 * 60 * 60 * 1000);
    }, msUntilFirst);
};

start().catch((err) => {
    console.error('Failed to start server', err);
    // Salir con error (p. ej. Mongo no respondió): systemd (Restart=always) o
    // la plataforma lo vuelven a arrancar, en vez de quedar vivo sin servidor.
    process.exit(1);
});
