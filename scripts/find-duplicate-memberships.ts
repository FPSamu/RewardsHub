/**
 * SOLO LECTURA. Lista membresías activas duplicadas (mismo cliente + mismo plan
 * con status 'active').
 *
 * El índice único parcial `uniq_active_plan_per_user` (P1.3) no se puede
 * construir mientras existan: Mongoose lo intenta al arrancar y, si falla,
 * la app sigue funcionando pero sin la protección contra activaciones dobles.
 *
 *   npx ts-node scripts/find-duplicate-memberships.ts            # base del MONGO_URI / DB_NAME
 *   DB_NAME=rewardshub_lab npx ts-node scripts/find-duplicate-memberships.ts
 *   ... -- --json                                                 # salida JSON
 *
 * No modifica nada. Para resolverlos, decide a mano cuál conservar de cada
 * grupo (normalmente la de endDate más lejana) y marca las demás como
 * 'cancelled'; después reinicia la app para que se construya el índice.
 */
import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { buildConnectOptions } from '../src/db/mongoose';
import { ClientMembershipModel } from '../src/models/clientMembership.model';

export interface DuplicateGroup {
    userId: string;
    planId: string;
    count: number;
    memberships: Array<{ id: string; businessId: string; startDate: Date; endDate: Date; activatedAt: Date }>;
}

export const findDuplicateActiveMemberships = async (): Promise<DuplicateGroup[]> => {
    const groups = await ClientMembershipModel.aggregate([
        { $match: { status: 'active' } },
        { $sort: { endDate: -1 } },
        {
            $group: {
                _id: { userId: '$userId', planId: '$planId' },
                count: { $sum: 1 },
                memberships: {
                    $push: { id: '$_id', businessId: '$businessId', startDate: '$startDate', endDate: '$endDate', activatedAt: '$activatedAt' },
                },
            },
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } },
    ]);
    return groups.map((g: any) => ({
        userId: g._id.userId.toString(),
        planId: g._id.planId.toString(),
        count: g.count,
        memberships: g.memberships.map((m: any) => ({ ...m, id: m.id.toString(), businessId: m.businessId.toString() })),
    }));
};

const main = async () => {
    const asJson = process.argv.includes('--json');
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI no está configurada');

    // autoIndex: false → este script nunca intenta construir el índice (no escribe nada)
    await mongoose.connect(uri, { ...buildConnectOptions(), autoIndex: false });
    try {
        const groups = await findDuplicateActiveMemberships();
        if (asJson) {
            console.log(JSON.stringify(groups, null, 2));
            return;
        }
        console.log(`🔎 Base "${mongoose.connection.db?.databaseName}": ${groups.length} grupos de membresías activas duplicadas`);
        for (const g of groups) {
            console.log(`\n• userId ${g.userId} · planId ${g.planId} · ${g.count} activas (la primera vence más tarde)`);
            for (const m of g.memberships) {
                console.log(`   - ${m.id}  negocio ${m.businessId}  ${m.startDate.toISOString()} → ${m.endDate.toISOString()}`);
            }
        }
        if (groups.length === 0) console.log('✅ Sin duplicados: el índice uniq_active_plan_per_user se puede construir.');
    } finally {
        await mongoose.disconnect();
    }
};

if (require.main === module) {
    main().catch((err) => {
        console.error('❌ find-duplicate-memberships falló:', err);
        process.exit(1);
    });
}
