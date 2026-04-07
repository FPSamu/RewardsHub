import './types/express';
import app from './app';
import connectDb from './db/mongoose';
import os from 'os';
import { runNotificationBatch } from './services/notification.service';

const port = parseInt(process.env.PORT || '3000', 10);
const host = '0.0.0.0'; // Listen on all network interfaces

const start = async () => {
    // Ensure DB connection is established before accepting requests
    await connectDb();
    scheduleNotifications();
    app.listen(port, host, () => {
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

start().catch((err) => {
    console.error('Failed to start server', err);
});
