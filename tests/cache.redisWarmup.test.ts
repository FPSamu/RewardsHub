/**
 * warmUpRedis: al arrancar la API se espera la conexión a Redis (máx. 2 s),
 * para que la primera petición no caiga en BYPASS. Nunca lanza.
 */
import { EventEmitter } from 'events';
import { warmUpRedis, setRedisClient } from '../src/cache/redis';

class FakeClient extends EventEmitter { status = 'connecting'; }

afterEach(() => {
    setRedisClient(null);
    delete process.env.REDIS_URL;
    jest.restoreAllMocks();
});

it('sin REDIS_URL no hace nada', async () => {
    await expect(warmUpRedis()).resolves.toBe(false);
});

it('espera al evento ready', async () => {
    process.env.REDIS_URL = 'redis://x:6379';
    const c = new FakeClient();
    setRedisClient(c as any);
    const p = warmUpRedis(1000);
    setTimeout(() => { c.status = 'ready'; c.emit('ready'); }, 20);
    await expect(p).resolves.toBe(true);
    expect(c.listenerCount('ready')).toBe(0);
});

it('ya conectado: vuelve al instante', async () => {
    process.env.REDIS_URL = 'redis://x:6379';
    const c = new FakeClient();
    c.status = 'ready';
    setRedisClient(c as any);
    await expect(warmUpRedis(1000)).resolves.toBe(true);
});

it('Redis caído: se rinde al tiempo límite sin lanzar (la API arranca igual)', async () => {
    process.env.REDIS_URL = 'redis://x:6379';
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const c = new FakeClient();
    setRedisClient(c as any);
    await expect(warmUpRedis(30)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(c.listenerCount('ready')).toBe(0);
});
