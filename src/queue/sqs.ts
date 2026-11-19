/**
 * Cliente SQS compartido por la API (productor) y el worker (consumidor).
 *
 * La cola se activa con SQS_QUEUE_URL. Sin ella, todo sigue como antes
 * (scheduler en proceso), así que local y Render no cambian.
 *
 * Credenciales: el .env ya trae AWS_ACCESS_KEY_ID/SECRET para S3 (otra cuenta).
 * El SDK los tomaría primero, así que NO usamos la cadena por defecto:
 *  - SQS_AWS_PROFILE  → perfil de ~/.aws (útil en local con credenciales del lab)
 *  - si no            → rol de la instancia EC2 (LabInstanceProfile)
 */
import {
    SQSClient,
    SendMessageCommand,
    ReceiveMessageCommand,
    DeleteMessageCommand,
    ChangeMessageVisibilityCommand,
    Message,
} from '@aws-sdk/client-sqs';
import { fromIni, fromInstanceMetadata } from '@aws-sdk/credential-providers';
import { JobMessage, JobType } from './jobs';

let client: SQSClient | null = null;

export const getQueueUrl = (): string | undefined => process.env.SQS_QUEUE_URL || undefined;
export const isQueueEnabled = (): boolean => Boolean(getQueueUrl());

const getClient = (): SQSClient => {
    if (client) return client;
    const profile = process.env.SQS_AWS_PROFILE;
    client = new SQSClient({
        region: process.env.SQS_REGION || process.env.AWS_REGION || 'us-east-1',
        credentials: profile ? fromIni({ profile }) : fromInstanceMetadata({ maxRetries: 3, timeout: 2000 }),
    });
    return client;
};

const requireQueueUrl = (): string => {
    const url = getQueueUrl();
    if (!url) throw new Error('SQS_QUEUE_URL no está configurada');
    return url;
};

export const enqueueJob = async (type: JobType, scheduledAt: Date = new Date()): Promise<string | undefined> => {
    const body: JobMessage = { type, scheduledAt: scheduledAt.toISOString() };
    const out = await getClient().send(new SendMessageCommand({
        QueueUrl: requireQueueUrl(),
        MessageBody: JSON.stringify(body),
    }));
    return out.MessageId;
};

export const receiveMessages = async (visibilityTimeout: number): Promise<Message[]> => {
    const out = await getClient().send(new ReceiveMessageCommand({
        QueueUrl: requireQueueUrl(),
        MaxNumberOfMessages: 1,      // los batches son pesados: uno a la vez por worker
        WaitTimeSeconds: 20,         // long polling
        VisibilityTimeout: visibilityTimeout,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
    }));
    return out.Messages ?? [];
};

export const deleteMessage = async (receiptHandle: string): Promise<void> => {
    await getClient().send(new DeleteMessageCommand({ QueueUrl: requireQueueUrl(), ReceiptHandle: receiptHandle }));
};

export const extendVisibility = async (receiptHandle: string, seconds: number): Promise<void> => {
    await getClient().send(new ChangeMessageVisibilityCommand({
        QueueUrl: requireQueueUrl(),
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: seconds,
    }));
};
