/**
 * P0.1/P0.2 — opciones de conexión a Mongo desde el entorno.
 * Sin variables nuevas el comportamiento es el de siempre (local y Render).
 */
import { buildConnectOptions } from '../src/db/mongoose';

describe('buildConnectOptions', () => {
    it('sin DB_NAME ni MONGO_MAX_POOL_SIZE: base del MONGO_URI y pool por defecto del driver', () => {
        expect(buildConnectOptions({})).toEqual({ dbName: undefined });
    });

    it('DB_NAME del lab se pasa como dbName', () => {
        expect(buildConnectOptions({ DB_NAME: 'rewardshub_lab' }).dbName).toBe('rewardshub_lab');
    });

    it('MONGO_MAX_POOL_SIZE válido limita el pool', () => {
        expect(buildConnectOptions({ MONGO_MAX_POOL_SIZE: '20' }).maxPoolSize).toBe(20);
    });

    it.each(['', 'abc', '0', '-5'])('MONGO_MAX_POOL_SIZE=%p se ignora', (value) => {
        expect(buildConnectOptions({ MONGO_MAX_POOL_SIZE: value })).not.toHaveProperty('maxPoolSize');
    });
});
