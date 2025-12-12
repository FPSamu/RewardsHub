import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { RedemptionCodeModel } from '../models/redemptionCode.model';
import { TransactionModel } from '../models/transaction.model';
import * as systemService from '../services/system.service';
import * as userPointsService from '../services/userPoints.service';
import { calculatePoints } from '../services/userPoints.service';
import { BusinessModel } from '../models/business.model';

/**
 * Genera un código único alfanumérico (Ej: A7X-9YP)
 */
const generateUniqueCode = (): string => {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
};

/**
 * [NEGOCIO] Generar un nuevo código para un pedido
 * POST /api/delivery/generate
 * Body: { amount: number }
 */
export const generateCode = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const businessId = req.business!.id;
        const { amount } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Valid amount is required' });
        }

        const systems = await systemService.findSystemsByBusinessId(businessId);
        const pointsSystem = systems.find(s => s.type === 'points' && s.isActive);

        if (!pointsSystem || !pointsSystem.pointsConversion) {
            return res.status(400).json({ message: 'Business does not have an active points system' });
        }

        const points = calculatePoints(amount, pointsSystem.pointsConversion);

        let code = '';
        let exists = true;
        let attempts = 0;
        
        while (exists && attempts < 3) {
            code = generateUniqueCode();
            const existing = await RedemptionCodeModel.findOne({ code });
            if (!existing) exists = false;
            attempts++;
        }

        if (exists) throw new Error('Failed to generate unique code, please try again');

        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 7);

        const redemption = await RedemptionCodeModel.create({
            code,
            businessId,
            amount,
            pointsEstimate: points,
            expiresAt: expirationDate
        });

        res.status(201).json({
            code: redemption.code,
            points: redemption.pointsEstimate,
            amount: redemption.amount,
            expiresAt: redemption.expiresAt
        });

    } catch (error) {
        next(error);
    }
};

/**
 * [CLIENTE] Canjear un código
 * POST /api/delivery/claim
 * Body: { code: string }
 */
export const claimCode = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        const { code } = req.body;

        if (!code) return res.status(400).json({ message: 'Code is required' });

        const redemption = await RedemptionCodeModel.findOne({ 
            code: code.toUpperCase() 
        });

        if (!redemption) {
            return res.status(404).json({ message: 'Invalid code' });
        }

        if (redemption.isRedeemed) {
            return res.status(409).json({ message: 'Code already redeemed' });
        }

        if (new Date() > redemption.expiresAt) {
            return res.status(400).json({ message: 'Code expired' });
        }

        const systems = await systemService.findSystemsByBusinessId(redemption.businessId.toString());
        const pointsSystem = systems.find(s => s.type === 'points' && s.isActive);

        if (!pointsSystem) {
            return res.status(400).json({ message: 'Points system is no longer active for this business' });
        }

        await userPointsService.addPointsAndStamps(
            userId,
            redemption.businessId.toString(),
            pointsSystem,
            redemption.amount,
            undefined
        );

       const pointsAdded = calculatePoints(redemption.amount, pointsSystem.pointsConversion!);

       const business = await BusinessModel.findById(redemption.businessId);
        const businessName = business ? business.name : 'Unknown Business';

        await TransactionModel.create({
            userId: userId,
            businessId: redemption.businessId,
            businessName: businessName,
            type: 'add', 
            purchaseAmount: redemption.amount,
            items: [{ 
                rewardSystemId: pointsSystem.id,
                rewardSystemName: pointsSystem.name,
                pointsChange: pointsAdded,
                stampsChange: 0
            }],
            totalPointsChange: pointsAdded,
            totalStampsChange: 0,
            notes: `Pedido a domicilio (Código: ${redemption.code})`
        });

        redemption.isRedeemed = true;
        redemption.redeemedBy = userId;
        redemption.redeemedAt = new Date();
        await redemption.save();

        res.status(200).json({ 
            message: 'Points claimed successfully',
            pointsAdded: calculatePoints(redemption.amount, pointsSystem.pointsConversion!),
            businessId: redemption.businessId
        });

    } catch (error) {
        next(error);
    }
};