/**
 * Ejecuta varias escrituras como una sola transacción de MongoDB.
 *
 *   const out = await withTransaction(async (session) => {
 *       await A.updateOne(..., { session });
 *       await B.create([...], { session });
 *       return algo;
 *   });
 *
 * - Usa mongoose.connection.transaction(), que llama a session.withTransaction()
 *   del driver: reintenta solo ante TransientTransactionError y
 *   UnknownTransactionCommitResult. Si `fn` lanza, se aborta y nada se escribe.
 *   `fn` puede correr más de una vez: no debe tener efectos fuera de Mongo
 *   (correos, push) — esos van después de la transacción.
 * - Atlas (producción y lab) es replica set, así que ahí siempre hay transacción.
 *   Un mongod standalone (algunos entornos locales, MongoMemoryServer) no
 *   soporta transacciones: entonces `fn` corre una vez con session = undefined.
 *   Las escrituras siguen siendo atómicas por documento ($inc condicional),
 *   solo se pierde la atomicidad entre documentos.
 */
import mongoose, { ClientSession } from 'mongoose';

let support: Promise<boolean> | null = null;
let warned = false;

/** ¿El servidor conectado soporta transacciones? (replica set o mongos). Se cachea por conexión. */
export const supportsTransactions = (): Promise<boolean> => {
    if (!support) {
        const db = mongoose.connection.db;
        if (!db) return Promise.resolve(false);
        support = db.admin().command({ hello: 1 })
            .then((hello: any) => Boolean(hello.setName) || hello.msg === 'isdbgrid')
            .catch(() => false);
        // Si la conexión se cierra (tests, reconexión a otro servidor), volver a preguntar
        mongoose.connection.once('disconnected', () => { support = null; });
    }
    return support;
};

export const withTransaction = async <T>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> => {
    if (!(await supportsTransactions())) {
        if (!warned) {
            console.warn('⚠️  [withTransaction] El servidor de MongoDB no es replica set: se escribe sin transacción.');
            warned = true;
        }
        return fn(undefined);
    }
    let result!: T;
    await mongoose.connection.transaction(async (session) => {
        result = await fn(session);
    });
    return result;
};
