/**
 * Tipos de trabajos que viajan por la cola (SQS).
 *
 * El mensaje es JSON: { "type": "<JobType>", "scheduledAt": "<ISO>" }.
 * - EventBridge lo publica a las 10:00 y 19:00 (ver infra/aws/scheduler.tf).
 * - Los endpoints /notifications/run-* lo publican cuando la cola está activa.
 */
export const JOB_TYPES = ['notification-batch', 'engagement-batch'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export interface JobMessage {
    type: JobType;
    /** Momento para el que se programó el trabajo. Forma parte de la llave de idempotencia. */
    scheduledAt: string;
}

export const isJobType = (value: unknown): value is JobType =>
    typeof value === 'string' && (JOB_TYPES as readonly string[]).includes(value);

/**
 * Valida el cuerpo de un mensaje SQS. Devuelve null si no es un trabajo válido
 * (el worker lo descarta en vez de reintentarlo eternamente).
 */
export const parseJobMessage = (body: string | undefined): JobMessage | null => {
    if (!body) return null;
    let data: any;
    try {
        data = JSON.parse(body);
    } catch {
        return null;
    }
    if (!data || !isJobType(data.type)) return null;
    const scheduledAt = typeof data.scheduledAt === 'string' && !Number.isNaN(Date.parse(data.scheduledAt))
        ? new Date(data.scheduledAt).toISOString()
        : null;
    if (!scheduledAt) return null;
    return { type: data.type, scheduledAt };
};

/**
 * Llave de idempotencia: SQS entrega "al menos una vez", y EventBridge puede
 * reintentar. Dos mensajes del mismo tipo para el mismo minuto son el mismo trabajo.
 */
export const jobRunKey = (job: JobMessage): string =>
    `${job.type}:${job.scheduledAt.slice(0, 16)}`;
