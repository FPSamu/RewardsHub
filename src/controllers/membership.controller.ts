import { NextFunction, Request, Response } from 'express';
import { MembershipPlanModel } from '../models/membershipPlan.model';
import { ClientMembershipModel } from '../models/clientMembership.model';
import { BusinessModel } from '../models/business.model';
import { UserModel } from '../models/user.model';
import { withTransaction } from '../db/withTransaction';

// ---------------------------------------------------------------------------
// Plan management (business authenticated)
// ---------------------------------------------------------------------------

export const createPlan = async (req: Request, res: Response): Promise<void> => {
    const business = req.business!;
    const { name, description, benefit, durationDays, price } = req.body;

    if (!name || !description || !benefit || !durationDays || price === undefined) {
        res.status(400).json({ message: 'name, description, benefit, durationDays y price son requeridos' });
        return;
    }

    const plan = await MembershipPlanModel.create({
        businessId: business.id,
        name, description, benefit,
        durationDays: Number(durationDays),
        price: Number(price),
    });

    res.status(201).json(plan);
};

export const getPlans = async (req: Request, res: Response): Promise<void> => {
    const business = req.business!;
    const plans = await MembershipPlanModel.find({ businessId: business.id }).sort({ createdAt: -1 });
    res.json(plans);
};

export const getPublicPlans = async (req: Request, res: Response): Promise<void> => {
    const { businessId } = req.params;
    const plans = await MembershipPlanModel.find({ businessId, isActive: true }).sort({ price: 1 });
    res.json(plans);
};

export const updatePlan = async (req: Request, res: Response): Promise<void> => {
    const business = req.business!;
    const { id } = req.params;
    const { name, description, benefit, durationDays, price, isActive } = req.body;

    const plan = await MembershipPlanModel.findOne({ _id: id, businessId: business.id });
    if (!plan) { res.status(404).json({ message: 'Plan no encontrado' }); return; }

    if (name !== undefined)        plan.name = name;
    if (description !== undefined) plan.description = description;
    if (benefit !== undefined)     plan.benefit = benefit;
    if (durationDays !== undefined) plan.durationDays = Number(durationDays);
    if (price !== undefined)       plan.price = Number(price);
    if (isActive !== undefined)    plan.isActive = isActive;

    await plan.save();
    res.json(plan);
};

export const deletePlan = async (req: Request, res: Response): Promise<void> => {
    const business = req.business!;
    const { id } = req.params;

    const plan = await MembershipPlanModel.findOneAndDelete({ _id: id, businessId: business.id });
    if (!plan) { res.status(404).json({ message: 'Plan no encontrado' }); return; }

    res.json({ message: 'Plan eliminado' });
};

// ---------------------------------------------------------------------------
// Cashier actions (business authenticated)
// ---------------------------------------------------------------------------

/** GET /memberships/client/:userId — membresías activas del cliente en este negocio */
export const getClientMembership = async (req: Request, res: Response): Promise<void> => {
    const business = req.business!;
    const { userId } = req.params;

    // Auto-expire if needed
    await ClientMembershipModel.updateMany(
        { userId, businessId: business.id, status: 'active', endDate: { $lt: new Date() } },
        { $set: { status: 'expired' } }
    );

    const memberships = await ClientMembershipModel.find({
        userId,
        businessId: business.id,
        status: 'active',
    }).sort({ endDate: 1 }).lean();

    const todayUTC = todayUTCString();

    const result = memberships.map(m => ({
        ...m,
        redeemedToday: m.lastRedeemedDate
            ? toUTCString(m.lastRedeemedDate) === todayUTC
            : false,
    }));

    res.json(result);
};

/** POST /memberships/activate — cajero activa membresía para un cliente */
export const activateMembership = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const business = req.business!;
        const { userId, planId } = req.body;

        if (!userId || !planId) {
            res.status(400).json({ message: 'userId y planId son requeridos' });
            return;
        }

        const user = await UserModel.findById(userId).lean();
        if (!user) { res.status(404).json({ message: 'Usuario no encontrado' }); return; }

        const plan = await MembershipPlanModel.findOne({ _id: planId, businessId: business.id, isActive: true });
        if (!plan) { res.status(404).json({ message: 'Plan no encontrado' }); return; }

        // Vencer las viejas + crear la nueva en una transacción. El índice único
        // parcial { userId, planId } con status 'active' impide que dos
        // activaciones simultáneas del mismo plan creen dos membresías.
        const membership = await withTransaction(async (session) => {
            // Auto-expire old memberships
            await ClientMembershipModel.updateMany(
                { userId, businessId: business.id, status: 'active', endDate: { $lt: new Date() } },
                { $set: { status: 'expired' } },
                { session }
            );

            // Allow multiple active memberships, but not the same plan twice
            const existing = await ClientMembershipModel.findOne(
                { userId, businessId: business.id, planId: plan._id, status: 'active' }, null, { session }
            );
            if (existing) return null;

            const startDate = new Date();
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + plan.durationDays);

            const [created] = await ClientMembershipModel.create([{
                userId,
                businessId: business.id,
                planId: plan._id,
                planSnapshot: {
                    name: plan.name,
                    benefit: plan.benefit,
                    durationDays: plan.durationDays,
                    price: plan.price,
                },
                startDate,
                endDate,
                status: 'active',
                lastRedeemedDate: null,
                activatedAt: new Date(),
                activatedByBusinessId: business.id,
            }], { session });
            return created;
        }).catch((err) => {
            // Otra activación del mismo plan ganó la carrera
            if (err?.code === 11000) return null;
            throw err;
        });

        if (!membership) {
            res.status(409).json({ message: 'El cliente ya tiene una membresía activa con este plan' });
            return;
        }

        res.status(201).json({
            membership,
            userName: (user as any).username,
            message: `Membresía "${plan.name}" activada para ${(user as any).username}`,
        });
    } catch (err) {
        next(err);
    }
};

/** POST /memberships/redeem — cajero canjea el beneficio del día */
export const redeemDailyBenefit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
        const business = req.business!;
        const { userId, membershipId } = req.body;

        if (!userId || !membershipId) {
            res.status(400).json({ message: 'userId y membershipId son requeridos' });
            return;
        }

        // Un solo update condicional: activa, sin vencer y sin canje hoy (UTC).
        // Antes era leer → revisar → save(), y dos cajeros a la vez canjeaban dos veces.
        const now = new Date();
        const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 3600 * 1000);
        const owner = { _id: membershipId, userId, businessId: business.id, status: 'active' };

        const membership = await ClientMembershipModel.findOneAndUpdate(
            {
                ...owner,
                endDate: { $gte: now },
                $or: [
                    { lastRedeemedDate: null },
                    { lastRedeemedDate: { $lt: startOfToday } },
                    { lastRedeemedDate: { $gte: startOfTomorrow } },
                ],
            },
            { $set: { lastRedeemedDate: now, lastRedeemedBusinessName: business.username ?? null } },
            { new: true }
        );

        if (!membership) {
            // Sin match: se relee para dar la misma respuesta que antes.
            const current = await ClientMembershipModel.findOne(owner);
            if (!current) {
                res.status(404).json({ message: 'Membresía no encontrada o inactiva' });
                return;
            }
            if (current.endDate < new Date()) {
                await ClientMembershipModel.updateOne({ _id: current._id, status: 'active' }, { $set: { status: 'expired' } });
                res.status(409).json({ message: 'La membresía ha vencido' });
                return;
            }
            res.status(409).json({ message: 'El beneficio de hoy ya fue canjeado', redeemedToday: true });
            return;
        }

        res.json({
            message: `Beneficio canjeado: ${membership.planSnapshot.benefit}`,
            benefit: membership.planSnapshot.benefit,
        });
    } catch (err) {
        next(err);
    }
};

// ---------------------------------------------------------------------------
// Client (user authenticated)
// ---------------------------------------------------------------------------

/** GET /memberships/my — membresías activas del cliente con info del negocio */
export const getMyMemberships = async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user?.id;
    if (!userId) { res.status(401).json({ message: 'not authenticated' }); return; }

    // Auto-expire
    await ClientMembershipModel.updateMany(
        { userId, status: 'active', endDate: { $lt: new Date() } },
        { $set: { status: 'expired' } }
    );

    const memberships = await ClientMembershipModel.find({ userId, status: 'active' })
        .sort({ endDate: 1 })
        .lean();

    if (memberships.length === 0) { res.json([]); return; }

    const businessIds = memberships.map(m => m.businessId);
    const businesses = await BusinessModel.find({ _id: { $in: businessIds } })
        .select('name logoUrl')
        .lean();

    const bizMap = new Map(businesses.map(b => [b._id.toString(), b]));
    const todayUTC = todayUTCString();

    const result = memberships.map(m => {
        const biz = bizMap.get(m.businessId.toString());
        const redeemedToday = m.lastRedeemedDate
            ? toUTCString(m.lastRedeemedDate) === todayUTC
            : false;
        const daysLeft = Math.max(0, Math.ceil((m.endDate.getTime() - Date.now()) / 86_400_000));

        return {
            ...m,
            businessName: (biz as any)?.name ?? 'Negocio',
            businessLogo: (biz as any)?.logoUrl ?? null,
            redeemedToday,
            daysLeft,
        };
    });

    res.json(result);
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayUTCString(): string {
    const d = new Date();
    return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function toUTCString(date: Date): string {
    const d = new Date(date);
    return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}
