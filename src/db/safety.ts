/**
 * Candado contra escribir en la base de producción.
 *
 * Todo script que modifique datos (seeds, migraciones, backfills,
 * reconcile-fix) llama a assertNonProductionDb() después de conectar y antes
 * de escribir. Solo deja pasar bases cuyo nombre termina en _lab, _test o
 * test, o si ALLOW_DB_WRITES=I_KNOW está puesto a mano en la terminal.
 */
import mongoose from 'mongoose';

export const NON_PRODUCTION_DB = /(_lab|_test|test)$/;

/** Nombre de la base a la que está conectado mongoose (undefined si no hay conexión). */
export const activeDbName = (): string | undefined => mongoose.connection.db?.databaseName;

export class ProductionDbError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ProductionDbError';
    }
}

/**
 * Lanza ProductionDbError si la base activa podría ser la de producción.
 *
 * Caso especial: un MONGO_URI sin base en la ruta hace que el driver use
 * "test". Ese nombre pasaría la regla, pero también podría ser justo la base
 * de producción, así que "test" solo se acepta si viene explícito en DB_NAME.
 */
export const assertNonProductionDb = (dbName: string | undefined = activeDbName()): void => {
    if (process.env.ALLOW_DB_WRITES === 'I_KNOW') {
        console.warn(`⚠️  [safety] ALLOW_DB_WRITES=I_KNOW: se permite escribir en "${dbName}"`);
        return;
    }
    if (!dbName) {
        throw new ProductionDbError('No hay conexión a MongoDB: no se puede comprobar la base activa.');
    }
    if (!NON_PRODUCTION_DB.test(dbName)) {
        throw new ProductionDbError(
            `La base "${dbName}" no parece de lab/test (debe terminar en _lab, _test o test). ` +
            'Usa DB_NAME=rewardshub_lab, o ALLOW_DB_WRITES=I_KNOW si de verdad sabes lo que haces.'
        );
    }
    if (dbName === 'test' && process.env.DB_NAME !== 'test') {
        throw new ProductionDbError(
            'La base "test" es la que el driver usa por defecto cuando el MONGO_URI no trae base; ' +
            'podría ser producción. Pon DB_NAME explícito (p. ej. rewardshub_lab).'
        );
    }
};
