import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { RedemptionCodeModel } from '../models/redemptionCode.model';
import { TransactionModel } from '../models/transaction.model';
import * as systemService from '../services/system.service';
import * as userPointsService from '../services/userPoints.service';
import { calculatePoints } from '../services/userPoints.service';
import { BusinessModel } from '../models/business.model';
import { Types } from 'mongoose';

const generateUniqueCode = (): string => {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
};

// POST /api/delivery/generate
export const generateCode = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const businessId = req.business!.id;
        const { amount, stamps } = req.body; 

        const purchaseAmount = amount ? parseFloat(amount) : 0;
        const stampsData = Array.isArray(stamps) ? stamps : [];

        if (purchaseAmount <= 0 && stampsData.length === 0) {
            return res.status(400).json({ message: 'Must provide purchase amount or stamps' });
        }

        const systems = await systemService.findSystemsByBusinessId(businessId);
        
        let points = 0;

        if (purchaseAmount > 0) {
            const pointsSystem = systems.find(s => s.type === 'points' && s.isActive);
            if (pointsSystem && pointsSystem.pointsConversion) {
                points = calculatePoints(purchaseAmount, pointsSystem.pointsConversion);
            }
        }

        const validStamps = [];
        if (stampsData.length > 0) {
            for (const s of stampsData) {
                const system = systems.find(sys => sys.id === s.systemId && sys.type === 'stamps' && sys.isActive);
                if (system && s.count > 0) {
                    validStamps.push({
                        systemId: new Types.ObjectId(s.systemId),
                        count: parseInt(s.count)
                    });
                }
            }
        }

        let code = '';
        let exists = true;
        let attempts = 0;
        while (exists && attempts < 3) {
            code = generateUniqueCode();
            const existing = await RedemptionCodeModel.findOne({ code });
            if (!existing) exists = false;
            attempts++;
        }
        if (exists) throw new Error('Failed to generate unique code');

        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + 7);

        const redemption = await RedemptionCodeModel.create({
            code,
            businessId,
            amount: purchaseAmount,
            pointsEstimate: points,
            stamps: validStamps, 
            expiresAt: expirationDate
        });

        res.status(201).json({
            code: redemption.code,
            points: redemption.pointsEstimate,
            amount: redemption.amount,
            stamps: redemption.stamps,
            expiresAt: redemption.expiresAt
        });

    } catch (error) {
        next(error);
    }
};

// POST /api/delivery/claim
export const claimCode = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userId = (req as any).user.id;
        const { code } = req.body;

        if (!code) return res.status(400).json({ message: 'Code is required' });

        const redemption = await RedemptionCodeModel.findOne({ code: code.toUpperCase() });

        if (!redemption) return res.status(404).json({ message: 'Invalid code' });
        if (redemption.isRedeemed) return res.status(409).json({ message: 'Code already redeemed' });
        if (new Date() > redemption.expiresAt) return res.status(400).json({ message: 'Code expired' });

        const systems = await systemService.findSystemsByBusinessId(redemption.businessId.toString());
        
        const pointsSystem = systems.find(s => s.type === 'points' && s.isActive);
        const stampSystemsToAdd: { system: any, count: number }[] = [];
        const transactionItems = [];

        let pointsAdded = 0;
        if (redemption.amount > 0 && pointsSystem) {
            pointsAdded = calculatePoints(redemption.amount, pointsSystem.pointsConversion!);
            
            if (pointsAdded > 0) {
                transactionItems.push({
                    rewardSystemId: new Types.ObjectId(pointsSystem.id),
                    rewardSystemName: pointsSystem.name,
                    pointsChange: pointsAdded,
                    stampsChange: 0
                });
            }
        }

        if (redemption.stamps && redemption.stamps.length > 0) {
            for (const s of redemption.stamps) {
                const system = systems.find(sys => sys.id === s.systemId.toString());
                if (system && system.isActive) {
                    stampSystemsToAdd.push({
                        system: system,
                        count: s.count
                    });

                    transactionItems.push({
                        rewardSystemId: new Types.ObjectId(system.id),
                        rewardSystemName: system.name,
                        pointsChange: 0,
                        stampsChange: s.count
                    });
                }
            }
        }

        if (pointsAdded === 0 && stampSystemsToAdd.length === 0) {
             return res.status(400).json({ message: 'No active reward systems found for this code' });
        }

        await userPointsService.addPointsAndStamps(
            userId,
            redemption.businessId.toString(),
            pointsAdded > 0 ? pointsSystem || null : null,
            redemption.amount,
            stampSystemsToAdd
        );

        const business = await BusinessModel.findById(redemption.businessId);
        
        await TransactionModel.create({
            userId: userId,
            businessId: redemption.businessId,
            businessName: business ? business.name : 'Unknown Business',
            type: 'add',
            purchaseAmount: redemption.amount,
            items: transactionItems,
            totalPointsChange: pointsAdded,
            totalStampsChange: stampSystemsToAdd.reduce((sum, s) => sum + s.count, 0),
            notes: `Pedido a domicilio (Código: ${redemption.code})`
        });

        redemption.isRedeemed = true;
        redemption.redeemedBy = userId;
        redemption.redeemedAt = new Date();
        await redemption.save();

        res.status(200).json({ 
            message: 'Rewards claimed successfully',
            pointsAdded,
            stampsAdded: stampSystemsToAdd.length,
            businessId: redemption.businessId
        });

    } catch (error) {
        next(error);
    }
};