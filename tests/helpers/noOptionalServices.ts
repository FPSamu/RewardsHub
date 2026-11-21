/**
 * Simula un .env del lab sin servicios opcionales: sin Stripe, Firebase,
 * correo ni llaves de S3. Importar ANTES que la app (los imports corren primero).
 */
export const OPTIONAL_ENV = [
    'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_MONTHLY_PRICE_ID', 'STRIPE_YEARLY_PRICE_ID', 'STRIPE_LIFETIME_PRICE_ID',
    'FIREBASE_PROJECT_ID', 'FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL',
    'EMAIL_SERVICE', 'EMAIL_USER', 'EMAIL_PASSWORD', 'EMAIL_FROM', 'SMTP_HOST',
    'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
];
for (const k of OPTIONAL_ENV) delete process.env[k];
