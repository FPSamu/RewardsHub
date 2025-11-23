/**
 * Transaction routes
 *
 * Exposes routes for viewing transaction history:
 * - GET /transactions                        -> get authenticated user's transactions
 * - GET /transactions/stats                  -> get authenticated user's transaction statistics
 * - GET /transactions/business               -> get authenticated business's transactions
 * - GET /transactions/business/user/:userId  -> get specific user's transactions at authenticated business
 * - GET /transactions/business/:businessId   -> get authenticated user's transactions at specific business
 * - GET /transactions/:id                    -> get specific transaction by ID
 */
import { Router } from 'express';
import * as transactionCtrl from '../controllers/transaction.controller';
import { authenticate } from '../middleware/auth.middleware';
import { authenticateBusiness } from '../middleware/business.middleware';

const router = Router();

/**
 * Middleware to allow either user or business authentication.
 * Used for endpoints that can be accessed by both.
 */
const authenticateUserOrBusiness = (req: any, res: any, next: any) => {
    // Try user authentication first
    authenticate(req, res, (err?: any) => {
        if (!err && req.user) {
            return next();
        }
        // If user auth fails, try business authentication
        authenticateBusiness(req, res, next);
    });
};

// User endpoints
router.get('/', authenticate, transactionCtrl.getUserTransactions);
router.get('/stats', authenticate, transactionCtrl.getUserTransactionStats);
router.get('/business/:businessId', authenticate, transactionCtrl.getUserTransactionsAtBusiness);

// Business endpoints
router.get('/business', authenticateBusiness, transactionCtrl.getBusinessTransactions);
router.get('/business/user/:userId', authenticateBusiness, transactionCtrl.getBusinessUserTransactions);

// Shared endpoint (user or business can access)
router.get('/:id', authenticateUserOrBusiness, transactionCtrl.getTransactionById);

export default router;
