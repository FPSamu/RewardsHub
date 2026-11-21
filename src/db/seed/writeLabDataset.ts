/**
 * Escribe el dataset sintético en la base conectada. Lo usa scripts/seed-lab.ts.
 *
 * Siempre pasa por assertNonProductionDb() antes de escribir. Usa las
 * colecciones de los modelos (respeta los *_COLLECTION del .env).
 */
import { Model } from 'mongoose';
import { BusinessModel } from '../../models/business.model';
import { SystemModel } from '../../models/system.model';
import { RewardModel } from '../../models/reward.model';
import { UserModel } from '../../models/user.model';
import { UserPointsModel } from '../../models/userPoints.model';
import { TransactionModel } from '../../models/transaction.model';
import { assertNonProductionDb } from '../safety';
import { LabDataset, SEED_EMAIL_DOMAIN } from './labDataset';

const TARGETS: Array<[keyof LabDataset, Model<any>]> = [
    ['businesses', BusinessModel],
    ['systems', SystemModel],
    ['rewards', RewardModel],
    ['users', UserModel],
    ['userPoints', UserPointsModel],
    ['transactions', TransactionModel],
];

const BATCH = 5000;

export class SeedAlreadyPresentError extends Error {
    constructor() {
        super('La base ya tiene datos del seed; usa --reset para regenerarlos.');
        this.name = 'SeedAlreadyPresentError';
    }
}

export type WriteResult = Record<keyof LabDataset, number>;

/** ¿Ya hay datos del seed? (negocios o usuarios con el dominio sintético) */
export const hasSeedData = async (): Promise<boolean> => {
    const domain = new RegExp(`@${SEED_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`);
    const [biz, user] = await Promise.all([
        BusinessModel.exists({ email: domain }),
        UserModel.exists({ email: domain }),
    ]);
    return Boolean(biz || user);
};

/**
 * - reset: vacía las colecciones del seed (en la base de lab) antes de escribir.
 * - sin reset y con datos del seed presentes → SeedAlreadyPresentError
 *   (así correrlo dos veces no duplica nada).
 */
export const writeLabDataset = async (
    dataset: LabDataset,
    { reset = false, log = console.log }: { reset?: boolean; log?: (msg: string) => void } = {}
): Promise<WriteResult> => {
    assertNonProductionDb();

    if (reset) {
        for (const [name, model] of TARGETS) {
            const { deletedCount } = await model.collection.deleteMany({});
            log(`🧹 ${name}: ${deletedCount} documentos borrados`);
        }
    } else if (await hasSeedData()) {
        throw new SeedAlreadyPresentError();
    }

    // Los índices (únicos incluidos) deben existir antes de insertar
    await Promise.all(TARGETS.map(([, model]) => model.createIndexes()));

    const result = {} as WriteResult;
    for (const [name, model] of TARGETS) {
        const docs = dataset[name];
        // insertMany directo a la colección: conserva createdAt/updatedAt del historial
        for (let i = 0; i < docs.length; i += BATCH) {
            await model.collection.insertMany(docs.slice(i, i + BATCH), { ordered: false });
        }
        result[name] = docs.length;
        log(`✅ ${name}: ${docs.length}`);
    }
    return result;
};
