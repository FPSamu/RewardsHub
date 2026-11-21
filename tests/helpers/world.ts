/**
 * Mundo mínimo para los tests de escrituras de negocio (P1.3, P1.4):
 * negocio con sucursal(es), sistema de puntos y de sellos, un cliente y sus tokens.
 */
import mongoose, { Types } from 'mongoose';
import { BusinessModel } from '../../src/models/business.model';
import { UserModel } from '../../src/models/user.model';
import { SystemModel } from '../../src/models/system.model';
import { UserPointsModel } from '../../src/models/userPoints.model';
import { TransactionModel } from '../../src/models/transaction.model';
import { RedemptionCodeModel } from '../../src/models/redemptionCode.model';
import { WorkShiftModel } from '../../src/models/workShift.model';
import { MembershipPlanModel } from '../../src/models/membershipPlan.model';
import { ClientMembershipModel } from '../../src/models/clientMembership.model';
import { IdempotencyKeyModel } from '../../src/models/idempotencyKey.model';
import * as authService from '../../src/services/auth.service';

export const MODELS: mongoose.Model<any>[] = [BusinessModel, UserModel, SystemModel, UserPointsModel, TransactionModel,
    RedemptionCodeModel, WorkShiftModel, MembershipPlanModel, ClientMembershipModel, IdempotencyKeyModel];

/** Negocio con una sucursal (o varias), sistema de puntos ($10 = 1 pt) y uno de sellos. */
export const seedWorld = async ({ branches = 1 } = {}) => {
    const business = await BusinessModel.create({
        username: 'Cafetería Lab',
        email: `biz-${new Types.ObjectId()}@test.com`,
        passHash: 'x',
        isVerified: true,
        status: 'active',
        timezone: 'America/Mexico_City',
        locations: Array.from({ length: branches }, (_, i) => ({
            name: `Sucursal ${i + 1}`, address: `Calle ${i}`, latitude: 20.66, longitude: -103.35, isMain: false,
        })),
    });
    const points = await SystemModel.create({
        businessId: business._id, type: 'points', name: 'Puntos', pointsConversion: { amount: 10, points: 1, currency: 'MXN' },
    });
    const stamps = await SystemModel.create({
        businessId: business._id, type: 'stamps', name: 'Café', targetStamps: 8, productType: 'any',
    });
    const user = await UserModel.create({ username: 'cliente', email: `u-${new Types.ObjectId()}@test.com`, passHash: 'x' });
    return {
        business, points, stamps, user,
        bizAuth: `Bearer ${authService.issueAccessToken(business.id, 'business')}`,
        userAuth: `Bearer ${authService.issueAccessToken(user.id, 'user')}`,
    };
};

export type World = Awaited<ReturnType<typeof seedWorld>>;
