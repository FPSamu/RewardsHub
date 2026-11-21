/**
 * Llena la base del lab con datos sintéticos (sin PII real).
 *
 *   DB_NAME=rewardshub_lab npm run seed:lab            # falla si ya hay datos del seed
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
import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { buildConnectOptions } from '../src/db/mongoose';
import { assertNonProductionDb, ProductionDbError } from '../src/db/safety';
import { DEFAULT_LAB_OPTIONS, generateLabDataset, LabDatasetOptions } from '../src/db/seed/labDataset';
import { SeedAlreadyPresentError, writeLabDataset } from '../src/db/seed/writeLabDataset';

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

const main = async () => {
    const { reset, options } = parseArgs(process.argv.slice(2));
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
        console.log('🎉 Listo:', result);
    } finally {
        await mongoose.disconnect();
    }
};

if (require.main === module) {
    main().catch((err) => {
        if (err instanceof ProductionDbError || err instanceof SeedAlreadyPresentError) {
            console.error(`⛔ ${err.message}`);
        } else {
            console.error('❌ seed:lab falló:', err);
        }
        process.exit(1);
    });
}
