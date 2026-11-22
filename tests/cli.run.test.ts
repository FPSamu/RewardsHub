/**
 * Scripts compilados (dist/cli/run.js) que en el lab corren dentro de la VPC
 * con ./lab.sh seed / ./lab.sh run: validación de comandos, candado contra
 * producción y el seed de punta a punta sobre MongoDB en memoria.
 */
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { CliUsageError, parseCommand, runCli, SCRIPTS } from '../src/cli/run';
import { BusinessModel } from '../src/models/business.model';
import { TransactionModel } from '../src/models/transaction.model';
import { ReplicationCheckpointModel } from '../src/models/replicationCheckpoint.model';

const quiet = () => {
    const out: string[] = [];
    return { out, log: (m: string) => out.push(m), error: (m: string) => out.push(m) };
};

describe('parseCommand', () => {
    it('acepta solo los scripts conocidos', () => {
        expect(Object.keys(SCRIPTS).sort()).toEqual([
            'compare-stats-sources', 'find-duplicate-memberships', 'migrate-locations-geo', 'reconcile-fix', 'seed',
        ]);
        expect(parseCommand(['seed', '--reset'])).toEqual({ script: 'seed', args: ['--reset'] });
        expect(() => parseCommand([])).toThrow(CliUsageError);
        expect(() => parseCommand(['rm'])).toThrow(/Script desconocido: rm/);
        expect(() => parseCommand(['constructor'])).toThrow(/Script desconocido/);
    });

    it('--prod se rechaza siempre en el CLI del lab (solo el wrapper local de migrate lo permite)', () => {
        expect(() => parseCommand(['migrate-locations-geo', '--prod', '--apply'])).toThrow(/--prod no se permite/);
        expect(parseCommand(['migrate-locations-geo', '--prod'], { allowProd: true }).args).toEqual(['--prod']);
    });

    it('runCli devuelve 2 con un uso inválido y no ejecuta nada', async () => {
        const q = quiet();
        expect(await runCli(['nope'], q)).toBe(2);
        expect(await runCli(['seed', '--prod'], q)).toBe(2);
        expect(q.out.join('\n')).toMatch(/Script desconocido|--prod/);
    });
});

describe('runCli contra MongoDB en memoria', () => {
    let mongo: MongoMemoryServer;
    const saved = { uri: process.env.MONGO_URI, db: process.env.DB_NAME };

    beforeAll(async () => {
        mongo = await MongoMemoryServer.create();
        process.env.MONGO_URI = mongo.getUri();
    });

    afterEach(async () => {
        if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    });

    afterAll(async () => {
        process.env.MONGO_URI = saved.uri;
        if (saved.db === undefined) delete process.env.DB_NAME; else process.env.DB_NAME = saved.db;
        await mongo.stop();
    });

    it('seed se niega a escribir en una base que no es de lab (sale con 1)', async () => {
        process.env.DB_NAME = 'rewardshub';
        const q = quiet();
        expect(await runCli(['seed', '--businesses', '1', '--users', '2', '--transactions', '3', '--days', '7'], q)).toBe(1);
        expect(q.out.join('\n')).toMatch(/⛔ .*no parece de lab\/test/);

        await mongoose.connect(mongo.getUri(), { dbName: 'rewardshub' });
        expect(await BusinessModel.countDocuments()).toBe(0);
    });

    it('seed llena la base del lab y borra los checkpoints de la réplica', async () => {
        process.env.DB_NAME = 'cli_seed_lab';
        // Un checkpoint "adelantado" (p. ej. tras demos con transacciones nuevas)
        await mongoose.connect(mongo.getUri(), { dbName: 'cli_seed_lab' });
        await ReplicationCheckpointModel.create({ _id: 'transactions', lastSeenAt: new Date(), lastSeenId: 'x' });
        await mongoose.disconnect();

        const q = quiet();
        const code = await runCli(['seed', '--businesses', '2', '--users', '5', '--transactions', '20', '--days', '7'], q);
        expect(code).toBe(0);

        await mongoose.connect(mongo.getUri(), { dbName: 'cli_seed_lab' });
        expect(await BusinessModel.countDocuments()).toBe(2);
        expect(await TransactionModel.countDocuments()).toBe(20);
        // Sin checkpoint, la próxima replicate-dynamo copia también las transacciones con updatedAt del pasado
        expect(await ReplicationCheckpointModel.countDocuments()).toBe(0);
        await mongoose.disconnect();

        // Segunda vez sin --reset: se detiene (no duplica) y sale con 1
        expect(await runCli(['seed', '--businesses', '2', '--users', '5', '--transactions', '20', '--days', '7'], q)).toBe(1);
    });

    it('reconcile-fix sin --run da el uso y sale con 1', async () => {
        process.env.DB_NAME = 'cli_seed_lab';
        const q = quiet();
        expect(await runCli(['reconcile-fix'], q)).toBe(1);
        expect(q.out.join('\n')).toMatch(/Uso: reconcile-fix --run <runKey>/);
    });

    it('find-duplicate-memberships es de solo lectura y responde 0', async () => {
        process.env.DB_NAME = 'cli_seed_lab';
        const q = quiet();
        expect(await runCli(['find-duplicate-memberships', '--json'], q)).toBe(0);
        expect(await runCli(['find-duplicate-memberships', '--x'], q)).toBe(1);
    });
});
