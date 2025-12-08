import { Router } from 'express';
import express from 'express';
import * as webhookController from '../controllers/webhook.controller';

const router = Router();

// Stripe requires the raw body to verify the signature
router.post(
    '/stripe', 
    express.raw({ type: 'application/json' }), 
    webhookController.handleStripeWebhook
);

export default router;
