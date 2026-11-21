/**
 * Réplica de lectura en DynamoDB (P5): estadísticas diarias y transacciones.
 *
 * Se activa con DDB_DAILY_STATS_TABLE y DDB_TRANSACTIONS_TABLE (en el lab las
 * pone user_data cuando enable_dynamo = true). Sin ellas, nada cambia.
 *
 * Credenciales (igual que src/queue/sqs.ts): el .env trae llaves de OTRA
 * cuenta para S3, así que NO se usa la cadena por defecto:
 *  - DDB_AWS_PROFILE → perfil de ~/.aws (local con credenciales del lab)
 *  - si no          → rol de la instancia EC2 (LabInstanceProfile)
 *
 * Tablas (infra/aws/dynamodb.tf):
 *  - daily-stats:  pk = BIZ#<businessId>, sk = DAY#<yyyy-mm-dd>#BR#<branchId|ALL|NONE>
 *                  (ALL = fila de todo el negocio; NONE = transacciones sin sucursal)
 *  - transactions: pk = BIZ#<businessId>, sk = <createdAt ISO>#<txId>
 *                  GSI byShift: gsi1pk = BIZ#<businessId>#SHIFT#<workShiftId>, sk createdAt
 *  - En daily-stats, pk = META#replication guarda cuándo terminó cada sincronización
 *    (lo lee `./lab.sh status` para mostrar el retraso).
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { fromIni, fromInstanceMetadata } from '@aws-sdk/credential-providers';

type Sender = Pick<DynamoDBDocumentClient, 'send'>;
let client: Sender | null = null;

export const dynamoTables = () => ({
    dailyStats: process.env.DDB_DAILY_STATS_TABLE || '',
    transactions: process.env.DDB_TRANSACTIONS_TABLE || '',
});

export const isDynamoEnabled = (): boolean => {
    const t = dynamoTables();
    return Boolean(t.dailyStats && t.transactions);
};

export const getDynamo = (): Sender => {
    if (client) return client;
    const profile = process.env.DDB_AWS_PROFILE;
    const base = new DynamoDBClient({
        region: process.env.DDB_REGION || process.env.AWS_REGION || 'us-east-1',
        credentials: profile ? fromIni({ profile }) : fromInstanceMetadata({ maxRetries: 3, timeout: 2000 }),
        maxAttempts: 3,
    });
    client = DynamoDBDocumentClient.from(base, { marshallOptions: { removeUndefinedValues: true } });
    return client;
};

/** Para tests: inyectar un cliente falso (o null para volver al real). */
export const setDynamoClient = (c: Sender | null) => {
    client = c;
};

// ── Llaves ───────────────────────────────────────────────────────────────────

export const bizPk = (businessId: string) => `BIZ#${businessId}`;
export const branchKey = (kind: 'business' | 'branch', branchId: string | null) =>
    kind === 'business' ? 'ALL' : branchId ?? 'NONE';
export const dailySk = (day: string, kind: 'business' | 'branch', branchId: string | null) =>
    `DAY#${day}#BR#${branchKey(kind, branchId)}`;
export const txSk = (createdAt: Date | string, txId: string) =>
    `${typeof createdAt === 'string' ? createdAt : createdAt.toISOString()}#${txId}`;
export const shiftPk = (businessId: string, workShiftId: string) => `BIZ#${businessId}#SHIFT#${workShiftId}`;
export const META_PK = 'META#replication';

const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v));

// ── Documento de Mongo → item de DynamoDB ────────────────────────────────────

export const dailyStatItem = (row: any) => {
    const businessId = String(row.businessId);
    const branchId = row.branchId ? String(row.branchId) : null;
    return {
        pk: bizPk(businessId),
        sk: dailySk(row.day, row.kind, branchId),
        businessId,
        kind: row.kind,
        branchId,
        day: row.day,
        txCount: row.txCount ?? 0,
        addCount: row.addCount ?? 0,
        subtractCount: row.subtractCount ?? 0,
        redeemCount: row.redeemCount ?? 0,
        pointsAdded: row.pointsAdded ?? 0,
        stampsAdded: row.stampsAdded ?? 0,
        pointsRedeemed: row.pointsRedeemed ?? 0,
        stampsRedeemed: row.stampsRedeemed ?? 0,
        revenueWithPoints: row.revenueWithPoints ?? 0,
        revenueAllAdds: row.revenueAllAdds ?? 0,
        newClients: row.newClients ?? 0,
        ...(row.uniqueClients !== undefined && row.uniqueClients !== null && { uniqueClients: row.uniqueClients }),
        computedAt: new Date(row.computedAt).toISOString(),
    };
};

export const transactionItem = (tx: any) => {
    const businessId = String(tx.businessId);
    const txId = String(tx._id);
    const createdAt = new Date(tx.createdAt).toISOString();
    return {
        pk: bizPk(businessId),
        sk: txSk(createdAt, txId),
        ...(tx.workShiftId && { gsi1pk: shiftPk(businessId, String(tx.workShiftId)) }),
        txId,
        businessId,
        userId: str(tx.userId),
        branchId: str(tx.branchId),
        businessName: tx.businessName,
        type: tx.type,
        purchaseAmount: tx.purchaseAmount,
        items: (tx.items ?? []).map((it: any) => ({
            rewardSystemId: String(it.rewardSystemId),
            rewardSystemName: it.rewardSystemName,
            pointsChange: it.pointsChange ?? 0,
            stampsChange: it.stampsChange ?? 0,
        })),
        totalPointsChange: tx.totalPointsChange ?? 0,
        totalStampsChange: tx.totalStampsChange ?? 0,
        rewardId: str(tx.rewardId),
        rewardName: tx.rewardName,
        notes: tx.notes,
        workShiftId: str(tx.workShiftId),
        workShiftName: tx.workShiftName,
        timezone: tx.timezone,
        createdAt,
        updatedAt: tx.updatedAt ? new Date(tx.updatedAt).toISOString() : createdAt,
    };
};

/** Item de daily-stats → la forma de las filas de daily_stats (la que leen los lectores). */
export const dailyRowFromItem = (item: any) => ({
    businessId: item.businessId,
    kind: item.kind as 'business' | 'branch',
    branchId: item.branchId ?? null,
    day: item.day,
    txCount: item.txCount,
    addCount: item.addCount,
    subtractCount: item.subtractCount,
    redeemCount: item.redeemCount,
    pointsAdded: item.pointsAdded,
    stampsAdded: item.stampsAdded,
    pointsRedeemed: item.pointsRedeemed,
    stampsRedeemed: item.stampsRedeemed,
    revenueWithPoints: item.revenueWithPoints,
    revenueAllAdds: item.revenueAllAdds,
    newClients: item.newClients,
    uniqueClients: item.uniqueClients,
});
