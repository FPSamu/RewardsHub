import './types/express';
import app from './app';
import connectDb from './db/mongoose';
import os from 'os';

const port = parseInt(process.env.PORT || '3000', 10);
const host = '0.0.0.0'; // Listen on all network interfaces

const start = async () => {
    // Ensure DB connection is established before accepting requests
    await connectDb();
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

start().catch((err) => {
    console.error('Failed to start server', err);
});
