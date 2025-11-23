/**
 * Transaction controllers
 *
 * Exposes endpoints for viewing transaction history.
 */
import { Request, Response } from 'express';
import * as transactionService from '../services/transaction.service';

/**
 * Get all transactions for the authenticated user.
 * GET /api/transactions
 * Query params:
 * - limit: number (default: 50, max: 100)
 * - offset: number (default: 0)
 */
export const getUserTransactions = async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
        const offset = parseInt(req.query.offset as string) || 0;

        const transactions = await transactionService.getTransactionsByUserId(user.id, limit, offset);
        
        return res.status(200).json({
            transactions,
            limit,
            offset,
            count: transactions.length,
        });
    } catch (error) {
        return res.status(500).json({ message: 'failed to get transactions' });
    }
};

/**
 * Get all transactions for the authenticated business.
 * GET /api/transactions/business
 * Query params:
 * - limit: number (default: 50, max: 100)
 * - offset: number (default: 0)
 */
export const getBusinessTransactions = async (req: Request, res: Response) => {
    const business = req.business;
    if (!business) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
        const offset = parseInt(req.query.offset as string) || 0;

        const transactions = await transactionService.getTransactionsByBusinessId(business.id, limit, offset);
        
        return res.status(200).json({
            transactions,
            limit,
            offset,
            count: transactions.length,
        });
    } catch (error) {
        return res.status(500).json({ message: 'failed to get business transactions' });
    }
};

/**
 * Get transactions for a specific user at the authenticated business.
 * GET /api/transactions/business/user/:userId
 * Query params:
 * - limit: number (default: 50, max: 100)
 * - offset: number (default: 0)
 */
export const getBusinessUserTransactions = async (req: Request, res: Response) => {
    const business = req.business;
    if (!business) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    const { userId } = req.params;
    if (!userId) {
        return res.status(400).json({ message: 'userId is required' });
    }

    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
        const offset = parseInt(req.query.offset as string) || 0;

        const transactions = await transactionService.getTransactionsByUserAndBusiness(
            userId,
            business.id,
            limit,
            offset
        );
        
        return res.status(200).json({
            transactions,
            limit,
            offset,
            count: transactions.length,
        });
    } catch (error) {
        return res.status(500).json({ message: 'failed to get user transactions at business' });
    }
};

/**
 * Get transactions for the authenticated user at a specific business.
 * GET /api/transactions/business/:businessId
 * Query params:
 * - limit: number (default: 50, max: 100)
 * - offset: number (default: 0)
 */
export const getUserTransactionsAtBusiness = async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    const { businessId } = req.params;
    if (!businessId) {
        return res.status(400).json({ message: 'businessId is required' });
    }

    try {
        const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
        const offset = parseInt(req.query.offset as string) || 0;

        const transactions = await transactionService.getTransactionsByUserAndBusiness(
            user.id,
            businessId,
            limit,
            offset
        );
        
        return res.status(200).json({
            transactions,
            limit,
            offset,
            count: transactions.length,
        });
    } catch (error) {
        return res.status(500).json({ message: 'failed to get transactions at business' });
    }
};

/**
 * Get a specific transaction by ID.
 * GET /api/transactions/:id
 */
export const getTransactionById = async (req: Request, res: Response) => {
    const user = req.user;
    const business = req.business;
    
    if (!user && !business) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    const { id } = req.params;
    if (!id) {
        return res.status(400).json({ message: 'transaction id is required' });
    }

    try {
        const transaction = await transactionService.getTransactionById(id);
        
        if (!transaction) {
            return res.status(404).json({ message: 'transaction not found' });
        }

        // Verify authorization: user can only see their own transactions,
        // business can only see their own business transactions
        if (user && transaction.userId !== user.id) {
            return res.status(403).json({ message: 'unauthorized to view this transaction' });
        }
        
        if (business && transaction.businessId !== business.id) {
            return res.status(403).json({ message: 'unauthorized to view this transaction' });
        }

        return res.status(200).json(transaction);
    } catch (error) {
        return res.status(500).json({ message: 'failed to get transaction' });
    }
};

/**
 * Get transaction statistics for the authenticated user.
 * GET /api/transactions/stats
 */
export const getUserTransactionStats = async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
        return res.status(401).json({ message: 'not authenticated' });
    }

    try {
        const stats = await transactionService.getUserTransactionStats(user.id);
        return res.status(200).json(stats);
    } catch (error) {
        return res.status(500).json({ message: 'failed to get transaction stats' });
    }
};
