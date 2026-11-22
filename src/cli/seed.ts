/**
 * Llena la base del lab con datos sintéticos (sin PII real).
 *
 *   ./lab.sh seed [--reset]                            # en el lab, desde una instancia de la API (dentro de la VPC)
 *   DB_NAME=rewardshub_lab npm run seed:lab            # local, contra tu propia base de lab/test
 *   DB_NAME=rewardshub_lab npm run seed:lab -- --reset # vacía las colecciones y regenera
 *
 * Opciones: --businesses N  --users N  --transactions N  --days N  --seed N
 *
 * Se niega a correr si la base no es de lab/test (assertNonProductionDb).
 * Todas las cuentas tienen la contraseña "lab12345" (passHash): sin Firebase,
 * los negocios entran con /auth/cashier-login (también desde el frontend).
 * Los negocios tienen el PIN de administrador "123456" (sin correo no hay otra
 * forma de obtenerlo).
 */
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { buildConnectOptions } from '../db/mongoose';
import { assertNonProductionDb } from '../db/safety';
import { DEFAULT_LAB_OPTIONS, generateLabDataset, LabDatasetOptions } from '../db/seed/labDataset';
import { writeLabDataset } from '../db/seed/writeLabDataset';
import { ReplicationCheckpointModel } from '../models/replicationCheckpoint.model';

export const parseArgs = (argv: string[]): { reset: boolean; options: LabDatasetOptions } => {
    const options: LabDatasetOptions = {};
    let reset = false;
    const numeric: Record<string, keyof typeof DEFAULT_LAB_OPTIONS> = {
        '--businesses': 'businesses',
        '--users': 'users',
        '--transactions': 'transactions',
        '--days': 'days',
        '--seed': 'seed',
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--reset') {
            reset = true;
        } else if (numeric[arg]) {
            const value = Number(argv[++i]);
            if (!Number.isInteger(value) || value < 1) throw new Error(`${arg} necesita un entero positivo`);
            options[numeric[arg]] = value;
        } else {
            throw new Error(`Opción desconocida: ${arg}`);
        }
    }
    return { reset, options };
};

export const main = async (argv: string[]): Promise<number> => {
    const { reset, options } = parseArgs(argv);
    const uri = process.env.MONGO_URI;
    if (!uri) throw new Error('MONGO_URI no está configurada');

    await mongoose.connect(uri, buildConnectOptions());
    try {
        // Antes de generar nada: si la base no es de lab, ni siquiera se calcula el dataset
        assertNonProductionDb();
        console.log(`🌱 Seed en la base "${mongoose.connection.db?.databaseName}"`, { ...DEFAULT_LAB_OPTIONS, ...options });

        const passHash = await bcrypt.hash('lab12345', 10);
        const adminPinHash = await bcrypt.hash('123456', 10);
        const dataset = generateLabDataset({ ...options, passHash, adminPinHash });
        const result = await writeLabDataset(dataset, { reset });
        // Las transacciones del seed traen updatedAt del pasado: si replicate-dynamo
        // ya había avanzado su checkpoint, nunca las copiaría. Sin checkpoint, la
        // próxima corrida copia todo desde el principio.
        const cleared = await ReplicationCheckpointModel.deleteMany({});
        if (cleared.deletedCount) console.log(`🔁 Checkpoints de la réplica borrados (${cleared.deletedCount}): el próximo replicate-dynamo copia todo`);
        console.log('🎉 Listo:', result);
        return 0;
    } finally {
        await mongoose.disconnect();
    }
};
