import './types/express';
import app from './app';
import connectDb from './db/mongoose';

const port = process.env.PORT || 3000;

const start = async () => {
    // Ensure DB connection is established before accepting requests
    await connectDb();
    app.listen(port, () => {
        console.log(`Server running on port http://localhost:${port}`);
    });
};

start().catch((err) => {
    console.error('Failed to start server', err);
});
