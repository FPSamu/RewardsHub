/**
 * Credenciales falsas de Stripe para los tests del webhook. Importar ANTES que
 * la app: webhook.controller y stripe.service crean el cliente al cargarse.
 * Con estas llaves el SDK se construye, firma y verifica webhooks localmente,
 * y nunca llama a la red (los eventos de prueba no lo necesitan).
 */
export const TEST_WEBHOOK_SECRET = 'whsec_test_rewardshub';

process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
