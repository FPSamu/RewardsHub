/**
 * Lecturas desde la réplica de DynamoDB (P5.3), con STATS_SOURCE=dynamo.
 *
 * - dynamoDailyRows: filas de daily-stats (para los lectores de estadísticas).
 * - reportTransactionsFromDynamo: transacciones de un reporte. Lo que la
 *   réplica todavía no tiene (después del checkpoint) se lee de Mongo, así
 *   que el reporte sale completo aunque la réplica vaya 10 min atrás.
 * - replicaFreshness: hasta cuándo está al día la réplica (X-Data-Freshness).
 *
 * Si DynamoDB falla, quien llama vuelve a leer de Mongo (ver dailyStats.service
 * y report.service): DynamoDB nunca tumba una petición.
 */
import { Types } from 'mongoose';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamo, dynamoTables, bizPk, shiftPk, dailyRowFromItem } from './dynamo';
import { ReplicationCheckpointModel, CheckpointId } from '../models/replicationCheckpoint.model';
import { TransactionModel } from '../models/transaction.model';
import { UserModel } from '../models/user.model';
import { OVERLAP_MS } from '../jobs/replicateDynamo.job';
import type { DailyRow } from '../services/dailyStats.service';

/** Query paginada (sigue LastEvaluatedKey). */
const queryAll = async (input: ConstructorParameters<typeof QueryCommand>[0]): Promise<any[]> => {
    const items: any[] = [];
    let ExclusiveStartKey: Record<string, any> | undefined;
    do {
        const out: any = await getDynamo().send(new QueryCommand({ ...input, ExclusiveStartKey }));
        items.push(...(out.Items ?? []));
        ExclusiveStartKey = out.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
};

/** Filas de daily-stats de esos días (una sola Query por rango; se filtra a los días pedidos). */
export const dynamoDailyRows = async (businessId: string, days: string[]): Promise<DailyRow[]> => {
    if (days.length === 0) return [];
    const sorted = [...days].sort();
    const wanted = new Set(days);
    const items = await queryAll({
        TableName: dynamoTables().dailyStats,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: { ':pk': bizPk(businessId), ':from': `DAY#${sorted[0]}`, ':to': `DAY#${sorted[sorted.length - 1]}#~` },
    });
    return items.map(dailyRowFromItem).filter((r) => wanted.has(r.day));
};

/** Hasta cuándo está al día la réplica (última pasada completa del job). */
export const replicaFreshness = async (id: CheckpointId): Promise<Date | undefined> =>
    (await ReplicationCheckpointModel.findById(id, { syncedAt: 1 }).lean())?.syncedAt ?? undefined;

interface ReportQuery {
    businessId: string;
    startDate: Date;
    endDate: Date;
    shiftIds?: string[];
    types?: string[];
}

/** Item de transactions → el mismo objeto que da Mongo con populate('userId', 'username email'). */
const toReportTransaction = (item: any, users: Map<string, any>) => ({
    _id: item.txId,
    businessId: item.businessId,
    userId: item.userId ? users.get(item.userId) ?? null : null,
    branchId: item.branchId,
    businessName: item.businessName,
    type: item.type,
    purchaseAmount: item.purchaseAmount,
    items: item.items ?? [],
    totalPointsChange: item.totalPointsChange ?? 0,
    totalStampsChange: item.totalStampsChange ?? 0,
    rewardId: item.rewardId,
    rewardName: item.rewardName,
    notes: item.notes,
    workShiftId: item.workShiftId,
    workShiftName: item.workShiftName,
    timezone: item.timezone,
    createdAt: new Date(item.createdAt),
    updatedAt: new Date(item.updatedAt ?? item.createdAt),
});

/**
 * Transacciones de un reporte: DynamoDB hasta el corte de la réplica y Mongo
 * después. El corte es el checkpoint menos el traslape del job, para no
 * depender de relojes exactos. Las transacciones no se editan después de
 * creadas, así que partir por createdAt es exacto.
 */
export const reportTransactionsFromDynamo = async (q: ReportQuery): Promise<any[]> => {
    const cp = await ReplicationCheckpointModel.findById('transactions', { lastSeenAt: 1 }).lean();
    const cut = cp?.lastSeenAt ? new Date(Math.min(q.endDate.getTime(), cp.lastSeenAt.getTime() - OVERLAP_MS)) : null;

    let fromDynamo: any[] = [];
    if (cut && cut >= q.startDate) {
        const startIso = q.startDate.toISOString();
        const cutIso = cut.toISOString();
        if (q.shiftIds && q.shiftIds.length > 0) {
            // Reporte por turnos: el GSI byShift trae solo esos turnos
            const perShift = await Promise.all(q.shiftIds.map((shift) => queryAll({
                TableName: dynamoTables().transactions,
                IndexName: 'byShift',
                KeyConditionExpression: 'gsi1pk = :pk AND createdAt BETWEEN :from AND :to',
                ExpressionAttributeValues: { ':pk': shiftPk(q.businessId, shift), ':from': startIso, ':to': cutIso },
            })));
            fromDynamo = perShift.flat().sort((a, b) => (a.sk < b.sk ? -1 : a.sk > b.sk ? 1 : 0));
        } else {
            fromDynamo = await queryAll({
                TableName: dynamoTables().transactions,
                KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
                ExpressionAttributeValues: { ':pk': bizPk(q.businessId), ':from': startIso, ':to': `${cutIso}#~` },
            });
        }
        if (q.types && q.types.length > 0) fromDynamo = fromDynamo.filter((it) => q.types!.includes(it.type));
    }

    // Lo que la réplica aún no tiene, de Mongo (igual que la consulta de siempre)
    const mongoQuery: Record<string, unknown> = {
        businessId: new Types.ObjectId(q.businessId),
        createdAt: cut && cut >= q.startDate ? { $gt: cut, $lte: q.endDate } : { $gte: q.startDate, $lte: q.endDate },
    };
    if (q.shiftIds && q.shiftIds.length > 0) mongoQuery.workShiftId = { $in: q.shiftIds.map((id) => new Types.ObjectId(id)) };
    if (q.types && q.types.length > 0) mongoQuery.type = { $in: q.types };
    const fromMongo = await TransactionModel.find(mongoQuery).sort({ createdAt: 1 }).populate('userId', 'username email').exec();

    // populate('userId', 'username email') para lo que viene de DynamoDB
    const userIds = [...new Set(fromDynamo.map((it) => it.userId).filter(Boolean))];
    const users = new Map(
        (await UserModel.find({ _id: { $in: userIds } }, { username: 1, email: 1 }).lean())
            .map((u: any) => [String(u._id), { _id: u._id, username: u.username, email: u.email }])
    );

    return [...fromDynamo.map((it) => toReportTransaction(it, users)), ...fromMongo];
};
