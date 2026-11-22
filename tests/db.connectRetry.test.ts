/**
 * Conexión inicial a Mongo con reintentos (MONGO_CONNECT_RETRIES). En el lab
 * la API y los workers pueden arrancar antes que la instancia de Mongo.
 * Sin la variable (local, Render) es un solo intento, como siempre.
 */
import { connectRetryDelaysMs, connectWithRetry } from '../src/db/mongoose';

describe('connectRetryDelaysMs', () => {
    it.each([undefined, '', '0', '-1', 'abc'])('MONGO_CONNECT_RETRIES=%p → sin reintentos', (value) => {
        expect(connectRetryDelaysMs(value === undefined ? {} : { MONGO_CONNECT_RETRIES: value })).toEqual([]);
    });

    it('espera creciente con tope de 30 s', () => {
        expect(connectRetryDelaysMs({ MONGO_CONNECT_RETRIES: '7' })).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    });
});

describe('connectWithRetry', () => {
    const sleep = jest.fn(async () => undefined);
    const log = jest.fn();
    beforeEach(() => { sleep.mockClear(); log.mockClear(); });

    it('sin reintentos: el primer error se relanza (comportamiento de siempre)', async () => {
        const connect = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
        await expect(connectWithRetry(connect, [], { sleep, log })).rejects.toThrow('ECONNREFUSED');
        expect(connect).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });

    it('reintenta hasta que conecta', async () => {
        const connect = jest.fn()
            .mockRejectedValueOnce(new Error('down'))
            .mockRejectedValueOnce(new Error('down'))
            .mockResolvedValue('ok');
        await expect(connectWithRetry(connect, [1000, 2000, 4000], { sleep, log })).resolves.toBe('ok');
        expect(connect).toHaveBeenCalledTimes(3);
        expect(sleep.mock.calls).toEqual([[1000], [2000]]);
        expect(log).toHaveBeenCalledTimes(2);
    });

    it('tras el último reintento relanza el error (el proceso sale con 1 y systemd lo reinicia)', async () => {
        const connect = jest.fn().mockRejectedValue(new Error('down'));
        await expect(connectWithRetry(connect, [10, 20], { sleep, log })).rejects.toThrow('down');
        expect(connect).toHaveBeenCalledTimes(3);
    });
});
